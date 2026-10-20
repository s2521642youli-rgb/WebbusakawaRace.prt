import {env,exports} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {describe,it,expect,beforeEach} from 'vitest';
import {phaseAt,startRace} from '../src/race-state.js';
const entrants=[{id:12,name:'ぶさかわ012'},{id:5,name:'ぶさかわ005'},{id:3,name:'ぶさかわ003'}];
const stub=()=>env.RACE_ROOM.get(env.RACE_ROOM.idFromName('exhibition-main-v1'));
async function call(path,{admin=false,method='GET',body,headers={}}={}){
  const response=await exports.default.fetch('https://example.com'+path,{method,headers:{...headers,...(admin?{Authorization:'Bearer '+env.ADMIN_TOKEN}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json(),response};
}
const create=(requestId=crypto.randomUUID())=>call('/api/admin/create',{admin:true,method:'POST',body:{requestId,entrants}});
// The callback executes in the DO isolate, so fixtures are passed as return-free literal code.
async function makeVoting(){await runInDurableObject(stub(),async(_instance,state)=>{const race=JSON.parse(state.storage.sql.exec('SELECT payload FROM current_race').one().payload),now=Date.now();race.startedAt=now-11000;race.deadlines={preparationEndsAt:now-1000,votingEndsAt:now+15000,closingEndsAt:now+20000,raceStartsAt:now+23000};state.storage.sql.exec('UPDATE current_race SET payload=?',JSON.stringify(race));});}
async function expireVoting(){await runInDurableObject(stub(),async(_instance,state)=>{const race=JSON.parse(state.storage.sql.exec('SELECT payload FROM current_race').one().payload),now=Date.now();race.deadlines.votingEndsAt=now-1;race.deadlines.closingEndsAt=now+4999;race.deadlines.raceStartsAt=now+7999;state.storage.sql.exec('UPDATE current_race SET payload=?',JSON.stringify(race));});}
beforeEach(async()=>{await runInDurableObject(stub(),async(_instance,state)=>{state.storage.sql.exec('DELETE FROM current_race; DELETE FROM votes; DELETE FROM creation_requests');await state.storage.deleteAlarm();});});
describe('SQLite Durable Object / HTTP voting',()=>{
 it('requires real admin authentication, including result reads and mutations',async()=>{
   for(const path of ['create','start','close','cancel','publish'])expect((await call('/api/admin/'+path,{method:'POST',body:{}})).status).toBe(401);
   expect((await call('/api/admin/state')).status).toBe(401);
   expect((await call('/api/admin/create',{method:'POST',headers:{Authorization:'Bearer wrong'},body:{}})).status).toBe(401);
 });
 it('creates one race, sanitizes entrants, preserves IDs/order and idempotent create/start',async()=>{
   const key=crypto.randomUUID(),a=await create(key),b=await create(key);expect(a.status).toBe(200);expect(b.data.raceId).toBe(a.data.raceId);
   expect(a.data.phase).toBe('registration');expect(a.data.entrants.map(e=>e.id)).toEqual([12,5,3]);
   expect(a.data.entrants[0]).toEqual({id:12,name:'ぶさかわ012',number:1,previewUrl:null});
   const s=await call('/api/admin/start',{admin:true,method:'POST',body:{raceId:a.data.raceId}}),again=await call('/api/admin/start',{admin:true,method:'POST',body:{raceId:a.data.raceId}});
   expect(s.data.deadlines).toEqual(again.data.deadlines);expect(s.data.deadlines.votingEndsAt-s.data.startedAt).toBe(25000);expect(s.data.deadlines.raceStartsAt-s.data.startedAt).toBe(33000);
 });
 it('rejects before start/preparation, duplicate and late votes; atomically accepts distinct browsers',async()=>{
   const {data:a}=await create(),voterId=crypto.randomUUID();
   const vote=()=>call('/api/votes',{method:'POST',body:{raceId:a.raceId,voterId,entrantId:12}});
   expect((await vote()).data.error).toBe('voting_closed');
   await call('/api/admin/start',{admin:true,method:'POST',body:{raceId:a.raceId}});expect((await vote()).status).toBe(409);
   await makeVoting();const together=await Promise.all(Array.from({length:12},vote));expect(together.filter(r=>r.status===200)).toHaveLength(1);expect(together.filter(r=>r.data.error==='already_voted')).toHaveLength(11);
   expect((await call('/api/votes',{method:'POST',body:{raceId:a.raceId,voterId:crypto.randomUUID(),entrantId:5}})).status).toBe(200);
   const before=await call('/api/admin/state?raceId='+a.raceId,{admin:true});expect(before.data).not.toHaveProperty('counts');
   const own=await call('/api/state?raceId='+a.raceId,{headers:{'X-Voter-Id':voterId}});expect(own.data.hasVoted).toBe(true);expect(own.data).not.toHaveProperty('counts');
   await expireVoting();expect((await call('/api/votes',{method:'POST',body:{raceId:a.raceId,voterId:crypto.randomUUID(),entrantId:12}})).data.error).toBe('voting_closed');
   const locked=await call('/api/admin/state?raceId='+a.raceId,{admin:true});expect(locked.data.counts.map(c=>c.votes)).toEqual([1,1,0]);expect(locked.data.finalized).toBe(true);
   const pub=await call('/api/state?raceId='+a.raceId);expect(pub.data).not.toHaveProperty('counts');expect(pub.data).not.toHaveProperty('results');
 });
 it('never mixes race IDs; stale create retries cannot replace a newer race',async()=>{
   const key=crypto.randomUUID(),a=await create(key),b=await create();expect(a.data.raceId).not.toBe(b.data.raceId);
   expect((await call('/api/votes',{method:'POST',body:{raceId:a.data.raceId,voterId:crypto.randomUUID(),entrantId:12}})).data.error).toBe('race_changed');
   expect((await create(key)).data.error).toBe('stale_create');
   await makeVoting();expect((await call('/api/votes',{method:'POST',body:{raceId:b.data.raceId,voterId:crypto.randomUUID(),entrantId:12}})).status).toBe(200);
   await expireVoting();expect((await call('/api/admin/state?raceId='+b.data.raceId,{admin:true})).data.counts.map(c=>c.votes)).toEqual([1,0,0]);
 });
 it('keeps zero-vote races stopped and publishes only after authenticated completion; ties retained',async()=>{
   const {data:a}=await create();await makeVoting();await expireVoting();expect((await call('/api/state?raceId='+a.raceId)).data.phase).toBe('no_votes');
   const {data:b}=await create();await makeVoting();
   for(const id of [12,5])await call('/api/votes',{method:'POST',body:{raceId:b.raceId,voterId:crypto.randomUUID(),entrantId:id}});
   await expireVoting();const publish=()=>call('/api/admin/publish',{admin:true,method:'POST',body:{raceId:b.raceId,finishTimes:[{id:12,time:2},{id:5,time:2},{id:3,time:3}]}});
   expect((await publish()).status).toBe(409);
   await runInDurableObject(stub(),async(_instance,state)=>{const race=JSON.parse(state.storage.sql.exec('SELECT payload FROM current_race').one().payload);race.deadlines.raceStartsAt=Date.now()-10000;race.deadlines.closingEndsAt=Date.now()-13000;state.storage.sql.exec('UPDATE current_race SET payload=?',JSON.stringify(race));});
   expect((await publish()).status).toBe(200);const pub=await call('/api/state?raceId='+b.raceId);expect(pub.data.results.map(r=>r.rank)).toEqual([1,1,3]);expect(pub.data.results.map(r=>r.votes)).toEqual([1,1,0]);
 });
 it('enforces CORS without using it as authentication and rejects invalid entrants',async()=>{
   expect((await call('/api/current',{headers:{Origin:'https://untrusted.invalid'}})).status).toBe(403);
   const allowed=await call('/api/current',{headers:{Origin:'http://localhost:8000'}});expect(allowed.response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8000');
   expect((await call('/api/admin/create',{admin:true,method:'POST',body:{requestId:crypto.randomUUID(),entrants:[entrants[0],entrants[0]]}})).status).toBe(400);
 });
 it('has exact pure server-deadline boundaries without frame-count timers',()=>{
   const r={startedAt:null,counts:null,cancelledAt:null,publishedAt:null};startRace(r,1000);expect(phaseAt(r,10999)).toBe('preparation');expect(phaseAt(r,11000)).toBe('voting');expect(phaseAt(r,26000)).toBe('closed');expect(phaseAt(r,31000)).toBe('countdown');expect(phaseAt(r,34000)).toBe('racing');
 });
});
