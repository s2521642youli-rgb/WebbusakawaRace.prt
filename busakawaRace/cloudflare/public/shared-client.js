export function randomId(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  if(!globalThis.crypto?.getRandomValues)throw new Error('このブラウザでは投票識別子を作れないよ。');
  return Array.from(crypto.getRandomValues(new Uint8Array(24)),n=>n.toString(16).padStart(2,'0')).join('');
}
export class ServerClock {
  constructor(){this.anchor=0;this.perf=0;this.lastServerNow=-Infinity;}
  update(serverNow,before,after){
    if(!Number.isFinite(serverNow)||serverNow<this.lastServerNow)return false;
    this.lastServerNow=serverNow;this.anchor=serverNow+Math.max(0,after-before)/2;this.perf=after;return true;
  }
  now(){return this.anchor+performance.now()-this.perf;}
  toPerformance(epoch){return this.perf+epoch-this.anchor;}
}
export class ApiClient {
  constructor(base,token=''){
    if(typeof base!=='string'||!base.trim())throw new Error('Workers URL欄にAPIの接続先を入力してね。ローカルなら http://127.0.0.1:8787 （/api/currentは付けない）。');
    let url;try{url=new URL(base.trim());}catch{throw new Error('Workers URLを確認してね。https://... または http://127.0.0.1:8787 の形式で入力してね。');}
    if(url.username||url.password||url.search||url.hash||!['https:','http:'].includes(url.protocol)||url.pathname!=='/')throw new Error('APIはWorkersのURL（末尾のパスなし）を入力してね。');
    const local=/^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
    if(url.protocol!=='https:'&&!local)throw new Error('本番のAPIはHTTPSのURLを使ってね。');
    this.base=url.origin;this.token=token;this.clock=new ServerClock();
  }
  async request(path,{method='GET',body,admin=false,voterId}={}){
    const headers={'Accept':'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json; charset=utf-8';
    if(admin)headers.Authorization='Bearer '+this.token;
    if(voterId)headers['X-Voter-Id']=voterId;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000),before=performance.now();
    try {
      const response=await fetch(this.base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:controller.signal});
      const after=performance.now();let data;
      try{data=await response.json();}catch{throw new Error('APIの応答を読めなかったよ。URLと通信状態を確認してね。');}
      if(!response.ok){const error=new Error(data.message??'通信できなかったよ。');error.code=data.error;error.status=response.status;throw error;}
      if(Number.isFinite(data.serverNow))this.clock.update(data.serverNow,before,after);
      return data;
    }catch(error){if(error.name==='AbortError')throw new Error('通信がタイムアウトしたよ。集計を確認できていないよ。');throw error;}
    finally{clearTimeout(timer);}
  }
}
export function publicPhase(state,now){
  if(!state)return 'connecting';
  if(['empty','registration','result','no_votes','cancelled'].includes(state.phase)||!state.deadlines)return state.phase;
  const d=state.deadlines;
  if(now<d.preparationEndsAt)return 'preparation';
  if(now<d.votingEndsAt)return 'voting';
  if(now<d.closingEndsAt)return 'closed';
  if(now<d.raceStartsAt)return 'countdown';
  return 'racing';
}
