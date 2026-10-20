// Timers are server epoch deadlines. This module has no browser clock or network state.
export const DURATIONS = Object.freeze({preparation:10000,voting:15000,closing:5000,countdown:3000});
export class ApiError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
export function fail(status,code,message){throw new ApiError(status,code,message);}
export function validId(value){return typeof value==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(value);}
export function phaseAt(race,now){
  if(!race)return 'empty';
  if(race.cancelledAt!==null)return 'cancelled';
  if(race.publishedAt!==null)return 'result';
  if(race.startedAt===null)return 'registration';
  if(now<race.deadlines.preparationEndsAt)return 'preparation';
  if(now<race.deadlines.votingEndsAt)return 'voting';
  if(race.counts&&race.counts.every(item=>item.votes===0))return 'no_votes';
  if(now<race.deadlines.closingEndsAt)return 'closed';
  if(now<race.deadlines.raceStartsAt)return 'countdown';
  return 'racing';
}
export function startRace(race,now){
  if(race.startedAt!==null)return; // retries cannot reset or extend deadlines
  race.startedAt=now;
  const preparationEndsAt=now+DURATIONS.preparation;
  const votingEndsAt=preparationEndsAt+DURATIONS.voting;
  race.deadlines={preparationEndsAt,votingEndsAt,closingEndsAt:votingEndsAt+DURATIONS.closing,raceStartsAt:votingEndsAt+DURATIONS.closing+DURATIONS.countdown};
}
export function rankCounts(counts){
  const ordered=[...counts].sort((a,b)=>b.votes-a.votes||a.id-b.id);
  return ordered.map((item,index)=>({...item,rank:ordered.findIndex(other=>other.votes===item.votes)+1}));
}
export function validateEntrants(input){
  if(!Array.isArray(input)||input.length<1||input.length>4)fail(400,'invalid_entrants','出走者は1〜4体にしてね。');
  const seen=new Set();
  return input.map((entry,index)=>{
    if(!entry||!Number.isSafeInteger(entry.id)||entry.id<1||seen.has(entry.id)||typeof entry.name!=='string'||entry.name.trim().length<1||entry.name.length>80)fail(400,'invalid_entrants','出走者の番号と名前を確認してね。');
    seen.add(entry.id);
    // No whole character data or arbitrary remote image URLs are uploaded.
    return {id:entry.id,name:entry.name.trim(),number:index+1,previewUrl:null};
  });
}
export function snapshot(race,now,{admin=false,hasVoted=false}={}){
  if(!race)return {raceId:null,phase:'empty',serverNow:now};
  const result={raceId:race.raceId,phase:phaseAt(race,now),serverNow:now,createdAt:race.createdAt,startedAt:race.startedAt,deadlines:race.deadlines,entrants:race.entrants,hasVoted,finalized:race.counts!==null};
  // Never leak intermediate counts, even on admin reads. Public results wait for host publication.
  if(admin&&race.counts!==null)result.counts=race.counts;
  if(race.publishedAt!==null)result.results=rankCounts(race.counts);
  return result;
}
