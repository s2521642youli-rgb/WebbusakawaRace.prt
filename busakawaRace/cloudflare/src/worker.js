export {RaceRoom} from './race-room.js';
async function authenticated(request,secret){
  if(typeof secret!=='string'||secret.length<32)return false;
  const value=request.headers.get('Authorization')??'';
  if(!value.startsWith('Bearer ')||value.length>4096)return false;
  const encode=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encode.encode(value.slice(7))),crypto.subtle.digest('SHA-256',encode.encode(secret))]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);let difference=0;
  for(let i=0;i<aa.length;i++)difference|=aa[i]^bb[i];
  return difference===0;
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/')){
      if(url.pathname==='/')url.pathname='/vote.html';
      const asset=await env.ASSETS.fetch(new Request(url,request));
      const headers=new Headers(asset.headers);
      // Explicit encoding also covers direct document navigation and inspection tools.
      const mime=headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
      if(['text/html','text/javascript','application/javascript','text/css'].includes(mime))headers.set('Content-Type',mime+'; charset=utf-8');
      headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
      headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      return new Response(asset.body,{status:asset.status,headers});
    }
    const origin=request.headers.get('Origin');
    const allowed=new Set([url.origin,...(env.ALLOWED_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean)]);
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
    if(origin&&!allowed.has(origin))return Response.json({error:'origin_not_allowed',message:'この画面の接続元は許可されていないよ。'},{status:403,headers});
    if(origin)headers['Access-Control-Allow-Origin']=origin;
    headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers']='Authorization, Content-Type, X-Voter-Id';
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.headers.get('Content-Length')&&Number(request.headers.get('Content-Length'))>8192)return Response.json({error:'too_large'},{status:413,headers});
    if(url.pathname.startsWith('/api/admin/')&&!(await authenticated(request,env.ADMIN_TOKEN)))return Response.json({error:'unauthorized',message:'管理用トークンを確認してね。'},{status:401,headers});
    const stub=env.RACE_ROOM.get(env.RACE_ROOM.idFromName('exhibition-main-v1'));
    const response=await stub.fetch(request);
    const combined=new Headers(response.headers);for(const [key,value]of Object.entries(headers))combined.set(key,value);
    return new Response(response.body,{status:response.status,headers:combined});
  }
};
