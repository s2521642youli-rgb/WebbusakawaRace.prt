import {ApiClient,randomId,publicPhase} from './shared-client.js';
const phaseLabel=document.getElementById('phase'),timer=document.getElementById('timer'),message=document.getElementById('message'),connection=document.getElementById('connection');
const views=new Map();const api=new ApiClient(location.origin);let state=null,raceId=new URL(location.href).searchParams.get('raceId'),voterId,lastSuccess=-Infinity,busy=false,stopped=false,pollTimer,polling=false,identityError='';
try {
  const key='busakawaRace.voter.v1';voterId=localStorage.getItem(key);
  if(!voterId){voterId=randomId();localStorage.setItem(key,voterId);}
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(voterId))throw new Error('投票識別子を読み取れなかったよ。ブラウザの保存設定を確認してね。');
}catch(error){voterId=null;identityError=error.message;connection.textContent=error.message||'ブラウザに投票識別子を保存できないよ。保存を許可してから開き直してね。';}
function buildCards(){
  const cards=[];views.clear();
  for(const entrant of state.entrants??[]){
    const card=document.createElement('div');card.className='card';
    const label=document.createElement('div'),number=document.createElement('p'),name=document.createElement('strong');
    number.textContent='出走者 '+entrant.number;name.textContent=entrant.name;label.append(number,name);
    const button=document.createElement('button');button.textContent='ぶさかわ！';button.setAttribute('aria-label',entrant.name+'に投票');
    button.addEventListener('click',()=>vote(entrant.id));card.append(label,button);cards.push(card);views.set(entrant.id,button);
  }
  document.getElementById('entrants').replaceChildren(...cards);
}
function render(){
  const phase=publicPhase(state,api.clock.now()),fresh=performance.now()-lastSuccess<4000;
  const labels={connecting:'接続中…',empty:'次のレースを待ってね',registration:'参加者受付中！',preparation:'まもなく投票開始！',voting:'投票受付中！',closed:'投票終了！',countdown:'まもなくレース開始！',racing:'会場のレースを応援してね！',result:'レース結果',no_votes:'投票がありませんでした',cancelled:'このレースは終了したよ'};
  phaseLabel.textContent=labels[phase]??'レースを確認中…';
  const deadline=phase==='preparation'?state.deadlines.preparationEndsAt:phase==='voting'?state.deadlines.votingEndsAt:null;
  timer.textContent=deadline===null?'':`あと${Math.max(0,Math.ceil((deadline-api.clock.now())/1000))}秒`;
  for(const button of views.values())button.disabled=phase!=='voting'||!fresh||state.hasVoted||busy||!voterId;
  if(state?.hasVoted)message.textContent='投票を受け付けました！ このレースへの投票は完了だよ。';
  else if(phase==='registration')message.textContent='会場のPCで投票が始まるまで、この画面で待っていてね。';
  else if(phase==='voting'&&!busy)message.textContent='一番ぶさかわだと思う子に1票！';
  else if(['closed','countdown','racing'].includes(phase))message.textContent='投票は締め切ったよ。結果は会場のレース後に発表！';
  if(state?.results){
    const rows=state.results.map(row=>{const li=document.createElement('li');li.textContent=`${row.rank}位 ${row.name} ${row.votes}票`;return li;});
    const list=document.getElementById('results');list.hidden=false;list.replaceChildren(...rows);
  }
  if(!fresh&&state&&!stopped)connection.textContent='通信を確認中… 接続が戻るまで投票はできないよ。';
}
async function vote(entrantId){
  if(busy||!voterId||state?.hasVoted||publicPhase(state,api.clock.now())!=='voting'||performance.now()-lastSuccess>=4000)return;
  busy=true;render();
  try{
    await api.request('/api/votes',{method:'POST',body:{raceId,voterId,entrantId}});state.hasVoted=true;message.textContent='投票を受け付けました！';
  }catch(error){
    if(error.code==='already_voted')state.hasVoted=true;
    connection.textContent=error.message;
  }finally{busy=false;render();}
}
async function poll(){
  if(stopped||polling)return;
  clearTimeout(pollTimer);polling=true;
  try{
    if(!raceId){const current=await api.request('/api/current');if(current.raceId)raceId=current.raceId;else{state=current;lastSuccess=performance.now();render();return;}}
    const next=await api.request('/api/state?raceId='+encodeURIComponent(raceId),{voterId});
    const rebuild=JSON.stringify(next.entrants)!==JSON.stringify(state?.entrants);
    // A lost POST response may be followed by polling: the server's own-vote flag restores the receipt.
    if(state?.hasVoted)next.hasVoted=true;
    if(state&&next.serverNow<state.serverNow)return;
    state=next;lastSuccess=performance.now();connection.textContent=identityError;if(rebuild)buildCards();
    document.getElementById('raceId').textContent='レース：'+raceId;
  }catch(error){
    connection.textContent=error.message;
    if(error.code==='race_changed'){stopped=true;for(const b of views.values())b.disabled=true;phaseLabel.textContent='新しいレースになったよ';state=null;}
  }finally{polling=false;if(!stopped){render();pollTimer=setTimeout(poll,1000);}}
}
setInterval(()=>{if(!stopped)render();},200); // display only; deadlines and vote acceptance are server-authoritative
window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(pollTimer);});
window.addEventListener('pageshow',()=>{if(stopped){stopped=false;poll();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){clearTimeout(pollTimer);poll();}});
poll();
