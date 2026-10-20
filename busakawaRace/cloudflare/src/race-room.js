import {DurableObject} from 'cloudflare:workers';
import {ApiError,fail,validId,phaseAt,startRace,validateEntrants,snapshot,rankCounts} from './race-state.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function voterHash(raceId,id){
  if(!validId(id))fail(400,'invalid_voter','ブラウザの投票識別子を確認できなかったよ。');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raceId+':'+id));
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
async function bodyOf(request){
  const reader=request.body?.getReader();let length=0;const chunks=[];
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>8192){await reader.cancel();fail(413,'too_large','送信内容が大きすぎるよ。');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'invalid_json','JSONの形式を確認してね。');}
  if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'invalid_json','JSONオブジェクトを送ってね。');return data;
}
export class RaceRoom extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);this.sql=ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS current_race(slot INTEGER PRIMARY KEY CHECK(slot=1),payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS votes(race_id TEXT NOT NULL,voter_hash TEXT NOT NULL,entrant_id INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(race_id,voter_hash));
      CREATE TABLE IF NOT EXISTS creation_requests(request_id TEXT PRIMARY KEY,race_id TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  }
  read(){const row=this.sql.exec('SELECT payload FROM current_race WHERE slot=1').toArray()[0];return row?JSON.parse(row.payload):null;}
  save(race){this.sql.exec('INSERT INTO current_race(slot,payload) VALUES(1,?) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',JSON.stringify(race));}
  freeze(race,now){
    if(race&&race.cancelledAt===null&&race.startedAt!==null&&now>=race.deadlines.votingEndsAt&&race.counts===null){
      const totals=new Map(this.sql.exec('SELECT entrant_id,COUNT(*) AS votes FROM votes WHERE race_id=? GROUP BY entrant_id',race.raceId).toArray().map(row=>[row.entrant_id,row.votes]));
      race.counts=race.entrants.map(item=>({id:item.id,name:item.name,votes:totals.get(item.id)||0}));this.save(race);
    }
  }
  requireRace(race,id){if(!race)fail(404,'no_race','まだレースが作られていないよ。');if(race.raceId!==id)fail(409,'race_changed','レースが変わったよ。会場の新しいQRコードを読み取ってね。');}
  async alarm(){this.ctx.storage.transactionSync(()=>{const race=this.read();this.freeze(race,Date.now());});}
  async fetch(request){
    try{
      const url=new URL(request.url),path=url.pathname;
      const admin=path.startsWith('/api/admin/'); // Only the outer Worker routes authenticated admin requests here.
      const body=request.method==='POST'?await bodyOf(request):null;
      const raceId=body?.raceId??url.searchParams.get('raceId');
      const voterId=body?.voterId??request.headers.get('X-Voter-Id');
      const hash=voterId&&raceId?await voterHash(raceId,voterId):null;
      let alarmAt=null;
      // No await within the transaction: deadline check, duplicate check, insert and freeze are atomic.
      const result=this.ctx.storage.transactionSync(()=>{
        const now=Date.now();let race=this.read();this.freeze(race,now);
        if(path==='/api/admin/create'&&request.method==='POST'){
          if(!validId(body.requestId))fail(400,'invalid_request_id','作成リクエストIDが必要だよ。');
          const entrants=validateEntrants(body.entrants);
          const previous=this.sql.exec('SELECT race_id FROM creation_requests WHERE request_id=?',body.requestId).toArray()[0];
          if(previous){
            if(previous.race_id!==race?.raceId)fail(409,'stale_create','古い作成リクエストだよ。');
            if(JSON.stringify(entrants)!==JSON.stringify(race.entrants))fail(409,'request_conflict','同じ作成IDで出走者を変えることはできないよ。');
            return snapshot(race,now,{admin:true});
          }
          race={raceId:crypto.randomUUID(),requestId:body.requestId,createdAt:now,entrants,startedAt:null,deadlines:null,counts:null,publishedAt:null,cancelledAt:null};
          this.sql.exec('DELETE FROM votes');this.save(race);
          this.sql.exec('INSERT INTO creation_requests VALUES(?,?,?)',body.requestId,race.raceId,now);
          this.sql.exec('DELETE FROM creation_requests WHERE request_id NOT IN (SELECT request_id FROM creation_requests ORDER BY created_at DESC LIMIT 200)');
          return snapshot(race,now,{admin:true});
        }
        if(path==='/api/current'&&request.method==='GET')return snapshot(race,now);
        if(!['/api/state','/api/votes','/api/admin/state','/api/admin/start','/api/admin/close','/api/admin/cancel','/api/admin/publish'].includes(path))fail(404,'not_found','APIが見つからないよ。');
        this.requireRace(race,raceId);
        if((path==='/api/state'||path==='/api/admin/state')&&request.method==='GET'){
          const hasVoted=hash?this.sql.exec('SELECT 1 FROM votes WHERE race_id=? AND voter_hash=?',race.raceId,hash).toArray().length>0:false;
          return snapshot(race,now,{admin,hasVoted});
        }
        if(path==='/api/votes'&&request.method==='POST'){
          if(phaseAt(race,now)!=='voting')fail(409,'voting_closed','今は投票を受け付けていないよ。');
          if(!hash)fail(400,'invalid_voter','投票識別子が必要だよ。');
          if(!race.entrants.some(item=>item.id===body.entrantId))fail(400,'invalid_entrant','このレースの出走者を選んでね。');
          if(this.sql.exec('SELECT 1 FROM votes WHERE race_id=? AND voter_hash=?',race.raceId,hash).toArray().length)fail(409,'already_voted','このレースへの投票は受け付け済みだよ。');
          this.sql.exec('INSERT INTO votes VALUES(?,?,?,?)',race.raceId,hash,body.entrantId,now);
          return {accepted:true,raceId:race.raceId,serverNow:now,hasVoted:true};
        }
        if(!admin||request.method!=='POST')fail(405,'method_not_allowed','この操作は使えないよ。');
        if(path==='/api/admin/start'){
          if(race.cancelledAt!==null)fail(409,'cancelled','このレースは終了しているよ。');
          startRace(race,now);this.freeze(race,now);this.save(race);alarmAt=race.deadlines.votingEndsAt;
        }else if(path==='/api/admin/close'){
          if(phaseAt(race,now)==='voting'){
            race.deadlines.votingEndsAt=now;race.deadlines.closingEndsAt=now+5000;race.deadlines.raceStartsAt=now+8000;this.freeze(race,now);this.save(race);
          }else if(race.counts===null)fail(409,'not_voting','投票受付中だけ締め切れるよ。');
        }else if(path==='/api/admin/cancel'){
          race.cancelledAt=now;this.save(race);
        }else if(path==='/api/admin/publish'){
          if(race.publishedAt!==null)return snapshot(race,now,{admin:true});
          if(phaseAt(race,now)!=='racing'||!race.counts?.some(item=>item.votes>0))fail(409,'not_finished','レース終了後だけ結果を公開できるよ。');
          const times=body.finishTimes;
          if(!Array.isArray(times)||times.length!==race.entrants.length||new Set(times.map(item=>item.id)).size!==times.length||times.some(item=>!race.entrants.some(entry=>entry.id===item.id)||!Number.isFinite(item.time)||item.time<1||item.time>600))fail(400,'invalid_finishes','全員のゴール時刻が必要だよ。');
          const ranks=rankCounts(race.counts),byId=new Map(times.map(item=>[item.id,item.time]));
          for(const a of ranks)for(const b of ranks){const delta=byId.get(a.id)-byId.get(b.id);if((a.rank===b.rank&&Math.abs(delta)>1e-6)||(a.rank<b.rank&&delta>=0))fail(409,'rank_mismatch','投票順位とゴール順位が一致していないよ。');}
          if(now<race.deadlines.raceStartsAt+Math.max(...times.map(item=>item.time))*1000)fail(409,'too_early','まだ全員がゴールする時刻になっていないよ。');
          race.publishedAt=now;this.save(race);
        }
        return snapshot(race,now,{admin:true});
      });
      if(alarmAt!==null&&alarmAt>Date.now())await this.ctx.storage.setAlarm(alarmAt);
      return json(result);
    }catch(error){
      if(error instanceof ApiError)return json({error:error.code,message:error.message},error.status);
      return json({error:'internal_error',message:'サーバーでエラーが起きたよ。集計は確認できていないよ。'},500);
    }
  }
}
