import {env,exports} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {it,expect,vi} from 'vitest';
import {ApiClient} from '../public/shared-client.js';

it('preserves Japanese names from the actual browser client through JSON, SQLite and raw response bytes',async()=>{
  const names=['ぶさかわ003','ぶさかわ012','日本語・ひらがな・カタカナ・😀'];
  const entrants=names.map((name,index)=>({id:index+3,name}));
  const sent=[];
  const network=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
    const request=new Request(url,init);
    if(request.method==='POST'){
      const bytes=new Uint8Array(await request.clone().arrayBuffer());
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      sent.push({contentType:request.headers.get('Content-Type'),body:JSON.parse(text)});
    }
    return exports.default.fetch(request);
  });
  try{
    const client=new ApiClient('https://example.com',env.ADMIN_TOKEN);
    const created=await client.request('/api/admin/create',{method:'POST',admin:true,body:{requestId:crypto.randomUUID(),entrants}});
    expect(sent[0].contentType).toBe('application/json; charset=utf-8');
    expect(sent[0].body.entrants.map(e=>e.name)).toEqual(names);
    expect(created.entrants.map(e=>e.name)).toEqual(names);
    const stub=env.RACE_ROOM.get(env.RACE_ROOM.idFromName('exhibition-main-v1'));
    const saved=await runInDurableObject(stub,(_instance,state)=>state.storage.sql.exec('SELECT payload FROM current_race WHERE slot=1').one().payload);
    expect(JSON.parse(saved).entrants.map(e=>e.name)).toEqual(names);
    const response=await exports.default.fetch('https://example.com/api/state?raceId='+created.raceId);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    const bytes=new Uint8Array(await response.arrayBuffer());
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    expect(JSON.parse(text).entrants.map(e=>e.name)).toEqual(names);
    const expectedHex=Array.from(new TextEncoder().encode('ぶさかわ003'),b=>b.toString(16).padStart(2,'0')).join('');
    const actualHex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    expect(actualHex).toContain(expectedHex);
    const next=await client.request('/api/admin/create',{method:'POST',admin:true,body:{requestId:crypto.randomUUID(),entrants}});
    expect(next.raceId).not.toBe(created.raceId);
    expect((await client.request('/api/state?raceId='+next.raceId)).entrants.map(e=>e.name)).toEqual(names);
  }finally{network.mockRestore();}
});

it('rejects non-UTF-8 request bytes rather than saving replacement characters',async()=>{
  const before=await exports.default.fetch('https://example.com/api/current');const original=await before.json();
  const a=new TextEncoder().encode('{"requestId":"'+crypto.randomUUID()+'","entrants":[{"id":3,"name":"');
  const z=new TextEncoder().encode('"}]}');
  // CP932 あ (82 a0) is not valid UTF-8. Do not silently store U+FFFD instead.
  const bytes=new Uint8Array([...a,0x82,0xa0,...z]);
  const response=await exports.default.fetch('https://example.com/api/admin/create',{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,'Content-Type':'application/json; charset=shift_jis'},body:bytes});
  expect(response.status).toBe(400);expect((await response.json()).error).toBe('invalid_json');
  expect((await (await exports.default.fetch('https://example.com/api/current')).json()).raceId).toBe(original.raceId);
});
it('gives an actionable URL validation error without treating a token as a URL',()=>{
  expect(()=>new ApiClient('')).toThrow('Workers URL欄');
  expect(()=>new ApiClient('not-a-url')).toThrow('Workers URLを確認');
  expect(()=>new ApiClient('http://127.0.0.1:8787/api/current')).toThrow('末尾のパスなし');
  expect(()=>new ApiClient('http://127.0.0.1:8787')).not.toThrow();
});
