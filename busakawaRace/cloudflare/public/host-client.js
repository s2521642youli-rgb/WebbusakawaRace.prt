import {ApiClient,randomId} from './shared-client.js';
export class HostClient {
  constructor(base,token,onState,onError){this.api=new ApiClient(base,token);this.onState=onState;this.onError=onError;this.generation=0;this.busy=false;this.state=null;this.pendingResults=null;}
  stop(){this.generation++;clearTimeout(this.timer);this.state=null;this.pendingResults=null;}
  async create(entrants){
    this.stop();const generation=this.generation;this.requestId=randomId();
    // Keep the request key for a response-loss retry; never silently create a second race.
    this.entrants=entrants;return this.retryCreate(generation);
  }
  async retryCreate(generation=this.generation){
    const next=await this.api.request('/api/admin/create',{method:'POST',admin:true,body:{requestId:this.requestId,entrants:this.entrants}});
    if(generation!==this.generation)return;this.accept(next);this.poll(generation);
  }
  accept(next){if(this.state&&next.serverNow<this.state.serverNow)return;this.state=next;this.onState(next,this.api.clock);}
  async start(){if(this.state?.phase!=='registration'||this.starting)return;this.starting=true;try{this.accept(await this.api.request('/api/admin/start',{method:'POST',admin:true,body:{raceId:this.state.raceId}}));}finally{this.starting=false;}}
  async poll(generation){
    if(generation!==this.generation)return;
    try{
      if(this.pendingResults){await this.api.request('/api/admin/publish',{method:'POST',admin:true,body:{raceId:this.state.raceId,finishTimes:this.pendingResults}});this.pendingResults=null;}
      const next=await this.api.request('/api/admin/state?raceId='+encodeURIComponent(this.state.raceId),{admin:true});
      if(generation===this.generation)this.accept(next);
    }catch(error){if(generation===this.generation)this.onError(error);}
    finally{if(generation===this.generation)this.timer=setTimeout(()=>this.poll(generation),600);}
  }
  publish(finishTimes){this.pendingResults=finishTimes;}
}
