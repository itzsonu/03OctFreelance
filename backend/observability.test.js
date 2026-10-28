const test=require('node:test'), assert=require('node:assert/strict'), http=require('node:http');
const express=require('express');const {createTelemetry}=require('./observability');
process.env.NODE_ENV='test';
async function withServer(app,action){const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{await action('http://127.0.0.1:'+server.address().port);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}
test('generated request IDs correlate AI logs without request or error content',async()=>{
 const logs=[],telemetry=createTelemetry({write:s=>logs.push(JSON.parse(s)),logging:()=>true});const app=express();
 app.use('/api',telemetry.middleware);app.get('/api/projects/:id',async(req,res)=>{try{await telemetry.observeAi('gemini','planning',async()=>{throw Object.assign(Error('SECRET PROMPT AND API KEY'),{status:429});});}catch{}res.json({ok:true});});
 await withServer(app,async base=>{const responses=await Promise.all([fetch(base+'/api/projects/private-id?token=SECRET',{headers:{Cookie:'password=SECRET','X-Request-ID':'attacker-controlled'}}),fetch(base+'/api/projects/other-private-id')]);for(const r of responses){await r.json();assert.match(r.headers.get('x-request-id'),/^[a-f0-9-]{36}$/);assert.ok(logs.some(l=>l.event==='ai_operation'&&l.requestId===r.headers.get('x-request-id')));}assert.notEqual(responses[0].headers.get('x-request-id'),responses[1].headers.get('x-request-id'));});
 assert.doesNotMatch(JSON.stringify(logs),/SECRET|private-id|attacker-controlled|password/);const view=telemetry.snapshot();assert.equal(view.ai[0].attempts,2);assert.equal(view.ai[0].quotaFailures,2);assert.equal(view.requests[0].count,2);
 view.ai[0].attempts=999;assert.equal(telemetry.snapshot().ai[0].attempts,2);
});
test('failed and successful AI operations are bounded by allowlisted labels and preserve behavior',async()=>{
 const telemetry=createTelemetry({logging:()=>false});const error=Object.assign(Error('private content'),{name:'TimeoutError'});
 assert.equal(await telemetry.observeAi('arbitrary-secret','unexpected',async()=>42),42);
 await assert.rejects(telemetry.observeAi('arbitrary-secret','unexpected',async()=>{throw error;}),e=>e===error);
 const row=telemetry.snapshot().ai[0];assert.equal(row.provider,'other');assert.equal(row.feature,'other');assert.equal(row.successes,1);assert.equal(row.timeouts,1);
});
test('operations metrics require a real admin authorization boundary',async t=>{
 const sessions=require('./sessions');let role=null;t.mock.method(sessions,'readSession',async()=>role?{user:{_id:'synthetic-user',role},session:{},token:'synthetic-token'}:null);
 const app=require('./app');await withServer(app,async base=>{
  let r=await fetch(base+'/api/admin/operations');assert.equal(r.status,401);assert.equal((await r.json()).scope,undefined);
  role='client';r=await fetch(base+'/api/admin/operations');assert.equal(r.status,403);
  role='admin';r=await fetch(base+'/api/admin/operations');assert.equal(r.status,200);assert.equal((await r.json()).scope,'single_process_since_start');
 });
});
test('translated provider errors retain safe access/quota classification',async()=>{
 const telemetry=createTelemetry({logging:()=>false});
 await assert.rejects(telemetry.observeAi('gemini','planning',async()=>{throw Object.assign(Error('private provider body'),{status:502,providerStatus:403});}));
 assert.equal(telemetry.snapshot().ai[0].accessFailures,1);
});
