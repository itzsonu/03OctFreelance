const { randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');
const GROUPS = new Set(['auth','account','profile','projects','project-drafts','applications','task-boards','workrooms','messages','notifications','talent','invitations','reviews','admin','support','health','updates']);
const LIMITS = [50,100,250,500,1000,5000,Infinity];
function createTelemetry({write = line => console.log(line), logging = () => process.env.NODE_ENV !== 'test' && process.env.OBSERVABILITY_LOGS !== 'false'} = {}) {
 const context=new AsyncLocalStorage(), startedAt=new Date().toISOString();
 const requests=new Map(), ai=new Map();
 function emit(data) { if(logging())try{write(JSON.stringify({at:new Date().toISOString(),...data}));}catch{} }
 function middleware(req,res,next) {
  const requestId=randomUUID(), start=performance.now();
  req.requestId=requestId;res.setHeader('X-Request-ID',requestId);
  // Fixed route groups only: never persist raw paths, IDs, query strings or bodies.
  const first=req.path.split('/').filter(Boolean)[0];const group=GROUPS.has(first)?first:'other';
  const method=['GET','HEAD','POST','PATCH','PUT','DELETE','OPTIONS'].includes(req.method)?req.method:'OTHER';
  let complete=false;
  function record(aborted) {
   if(complete)return;complete=true;
   const durationMs=Math.round((performance.now()-start)*100)/100;
   const status=aborted?0:res.statusCode;const family=aborted?'aborted':Math.floor(status/100)+'xx';
   const key=method+':'+group+':'+family;
   if(!requests.has(key))requests.set(key,{method,group,statusFamily:family,count:0,totalDurationMs:0,durationBuckets:LIMITS.map((upperMs)=>({upperMs:upperMs===Infinity?null:upperMs,count:0}))});
   const item=requests.get(key);item.count++;
   if(group!=='updates'){item.totalDurationMs+=durationMs;item.durationBuckets[LIMITS.findIndex(limit=>durationMs<=limit)].count++;}
   emit({event:'api_request',requestId,method,group,status,durationMs,aborted,stream:group==='updates'});
  }
  res.once('finish',()=>record(false));res.once('close',()=>record(!res.writableFinished));
  context.run({requestId},next);
 }
 async function observeAi(provider,feature,action) {
  provider=['gemini','openai'].includes(provider)?provider:'other';feature=['planning','matching'].includes(feature)?feature:'other';
  const key=provider+':'+feature;if(!ai.has(key))ai.set(key,{provider,feature,attempts:0,successes:0,failures:0,totalDurationMs:0,quotaFailures:0,accessFailures:0,timeouts:0});
  const counter=ai.get(key);counter.attempts++;const start=performance.now();let reason='success';
  try{const result=await action();counter.successes++;return result;}
  catch(error){counter.failures++;const status=error.providerStatus??error.status;reason=status===429?'quota':[401,403].includes(status)?'access':['TimeoutError','AbortError'].includes(error.name)?'timeout':'failed';if(reason==='quota')counter.quotaFailures++;if(reason==='access')counter.accessFailures++;if(reason==='timeout')counter.timeouts++;throw error;}
  finally{const durationMs=Math.round((performance.now()-start)*100)/100;counter.totalDurationMs+=durationMs;emit({event:'ai_operation',requestId:context.getStore()?.requestId||null,provider,feature,outcome:reason,durationMs});}
 }
 function snapshot(){return {startedAt,scope:'single_process_since_start',durations:'noncumulative histogram buckets; updates stream durations excluded',requests:[...requests.values()].map(r=>({...r,totalDurationMs:Math.round(r.totalDurationMs*100)/100,durationBuckets:r.durationBuckets.map(b=>({...b}))})),ai:[...ai.values()].map(r=>({...r,totalDurationMs:Math.round(r.totalDurationMs*100)/100}))};}
 return {middleware,observeAi,snapshot};
}
module.exports={...createTelemetry(),createTelemetry};
