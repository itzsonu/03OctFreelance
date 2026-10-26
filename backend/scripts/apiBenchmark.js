// Isolated loopback-only benchmark. No dotenv, external URL or existing DB option.
const fs = require('node:fs/promises'), syncFs = require('node:fs');
const path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const crypto = require('node:crypto'), net = require('node:net'), http = require('node:http');
const { performance } = require('node:perf_hooks');
const { parseOptions, summarize } = require('./apiBenchmarkMetrics');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { const s = net.createServer(); await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);}); const p=s.address().port; await new Promise(resolve=>s.close(resolve)); return p; }
function cleanEnv() { return Object.fromEntries(['PATH','Path','SystemRoot','SystemDrive','WINDIR','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','ProgramData','ProgramFiles','ProgramFiles(x86)'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])); }
function request(port, agent, spec) {
 return new Promise(resolve => {
  const started=performance.now(); let finished=false, timedOut=false, status=0;
  function done(result){if(finished)return;finished=true;clearTimeout(deadline);resolve({ms:performance.now()-started,status,timeout:timedOut,...result});}
  const req=http.request({hostname:'127.0.0.1',port,path:spec.path,method:'GET',agent,headers:spec.cookie?{Cookie:spec.cookie}:{}},res=>{
   status=res.statusCode;let body='',bytes=0;
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024)req.destroy();else body+=chunk;});
   res.on('end',()=>{let valid=false;try{valid=Boolean(spec.valid(JSON.parse(body)));}catch{}done({ok:status===200&&valid,invalidBody:status===200&&!valid});});
   res.on('error',()=>done({ok:false}));res.on('aborted',()=>done({ok:false}));
  });
  const deadline=setTimeout(()=>{timedOut=true;req.destroy();done({ok:false});},5000);
  req.on('error',()=>done({ok:false}));req.end();
 });
}
async function batch(port,agent,spec,count,concurrency) {
 let cursor=0;const samples=[];const start=performance.now();
 await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<count){cursor++;samples.push(await request(port,agent,spec));}}));
 return {samples,elapsedMs:performance.now()-start};
}
async function stopChild(child) {
 if(!child||!child.pid||child.exitCode!==null)return;
 const exit=new Promise(resolve=>child.once('exit',resolve));
 if(child.connected)child.send('stop');else child.kill();
 const timer=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(timer);
}
async function main(args=process.argv.slice(2)) {
 const options=parseOptions(args); const id=crypto.randomBytes(6).toString('hex');
 const temporaryRoot=path.resolve(__dirname,'../../work/benchmark-temp');await fs.mkdir(temporaryRoot,{recursive:true});
 const directory=await fs.mkdtemp(path.join(temporaryRoot,'fc-api-benchmark-'));
 const database='fc_benchmark_'+id;let mongo,server,mongoose,report,agent,cleanup=false;
 const dbpath=path.join(directory,'db');await fs.mkdir(dbpath);
 const binary=process.env.FC_TEST_MONGOD || (process.platform==='win32'?'C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe':'mongod');
 const dbPort=await freePort();const uri=`mongodb://127.0.0.1:${dbPort}/${database}`;
 try {
  let ready=false,startError;const startupMessages=[];
  mongo=cp.spawn(binary,['--dbpath',dbpath,'--port',String(dbPort),'--bind_ip','127.0.0.1'],{env:cleanEnv(),windowsHide:true,stdio:['ignore','pipe','pipe']});
  mongo.once('error',error=>{startError=error.code||'spawn_error';});mongo.stderr.on('data',b=>{startupMessages.push(String(b).slice(-500));});
  mongo.stdout.on('data',b=>{if(String(b).includes('Waiting for connections'))ready=true;for(const line of String(b).split('\n')){try{const row=JSON.parse(line);if(!['Frame','BACKTRACE'].includes(row.msg)){startupMessages.push(row.msg+' '+JSON.stringify(row.attr||{}));if(startupMessages.length>30)startupMessages.shift();}}catch{}}});
  for(let i=0;i<150&&!ready;i++){if(startError||mongo.exitCode!==null)throw Error('Dedicated local MongoDB could not start: '+(startError||mongo.exitCode)+' '+startupMessages.slice(-14).join(' ').slice(-5000));await sleep(200);}
  if(!ready)throw Error('Dedicated local MongoDB startup timed out');
  // No ambient credentials/configuration can select the target database.
  for(const key of Object.keys(process.env))if(/^(MONGO|RESTORE_|JWT_|FC_PROXY|APP_ORIGIN|CLIENT_ORIGIN|TRUST_PROXY|PRIVATE_UPLOAD|UPLOAD_|AI_|GEMINI_|OPENAI_|GOOGLE_|BREVO_|RESEND_|RESET_|GMAIL_|EVENT_EMAIL)/.test(key))delete process.env[key];
  process.env.NODE_ENV='test';process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
  process.env.PRIVATE_UPLOAD_BACKEND='mongo';process.env.EVENT_EMAILS_ENABLED='false';
  mongoose=require('mongoose');await mongoose.connect(uri,{serverSelectionTimeoutMS:5000});
  const User=require('../models/User'),Project=require('../models/Project'),Task=require('../models/ProjectTask');
  const Session=require('../models/Session');
  await Promise.all([User.init(),Project.init(),Task.init(),Session.init()]);
  const hash=await require('bcryptjs').hash(crypto.randomBytes(24).toString('hex'),10);
  const [client,freelancer]=await User.create([{name:'Synthetic Benchmark Client',email:'client@benchmark.invalid',password:hash,role:'client'},{name:'Synthetic Benchmark Freelancer',email:'freelancer@benchmark.invalid',password:hash,role:'freelancer',profile:{skills:['React','Node.js'],availability:'available'}}]);
  const deadline=new Date(Date.now()+90*86400000).toISOString().slice(0,10);
  await Project.insertMany(Array.from({length:options.projects},(_,i)=>({title:`Synthetic project ${i+1}`,description:'Fictional local benchmark brief for a small web application.',requiredSkills:['React','Node.js'],category:'Web Development',budget:1000+i,deadline,client:client._id,status:'Open',milestones:[{title:'Delivery',description:'Synthetic deliverable',payment:1000,dueDate:deadline,status:'active'}]})));
  const assigned=await Project.create({title:'Synthetic assigned task board',budget:1000,deadline,client:client._id,freelancer:freelancer._id,status:'In Progress',milestones:[{title:'Delivery',payment:1000,status:'active',dueDate:deadline}]});
  await Task.insertMany(Array.from({length:30},(_,i)=>({project:assigned._id,owner:freelancer._id,title:`Synthetic task ${i+1}`,status:['todo','in_progress','review','done'][i%4],priority:'medium',checklist:[{title:'Synthetic checklist item',done:false}]})));
  const sessions=require('../sessions');const clientSession=await sessions.createSession(client),freelancerSession=await sessions.createSession(freelancer);
  const mongoInfo=await mongoose.connection.db.admin().serverInfo();
  const env={...cleanEnv(),NODE_ENV:'test',MONGO_URI:uri,JWT_SECRET:process.env.JWT_SECRET,PRIVATE_UPLOAD_BACKEND:'mongo',UPLOAD_SHARED_QUOTA_MB:'100',EVENT_EMAILS_ENABLED:'false'};
  server=cp.fork(path.join(__dirname,'apiBenchmarkServer.js'),[],{env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});server.stderr.on('data',()=>{});
  const apiPort=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Isolated API startup timed out')),30000);server.once('message',message=>{clearTimeout(timer);if(!Number.isInteger(message.port)||message.port<1)reject(Error('Invalid local API port'));else resolve(message.port);});server.once('exit',()=>{clearTimeout(timer);reject(Error('Isolated API exited before startup'));});server.once('error',()=>{clearTimeout(timer);reject(Error('Could not launch isolated API'));});});
  const specs=[
   {name:'readiness',path:'/api/health/ready',valid:b=>b.status==='ready'},
   {name:'public_projects',path:'/api/projects/public?page=1&pageSize=12',valid:b=>Array.isArray(b.projects)&&b.projects.length===12&&b.total===options.projects},
   {name:'client_projects',path:'/api/projects/mine?page=1&pageSize=12',cookie:'fc_session='+clientSession.token,valid:b=>Array.isArray(b.items)&&b.items.length===12&&b.total===options.projects+1},
   {name:'private_task_board',path:`/api/task-boards/${assigned._id}?page=1&pageSize=12`,cookie:'fc_session='+freelancerSession.token,valid:b=>Array.isArray(b.items)&&b.items.length===12&&b.total===30}
  ];
  agent=new http.Agent({keepAlive:true,maxSockets:20});
  console.log('Isolated local API ready; measuring synthetic read traffic only.');
  const measurements=[];
  for(let round=1;round<=options.rounds;round++) {
   const levels=round%2?options.concurrency:[...options.concurrency].reverse();
   for(const concurrency of levels)for(const spec of specs){
    const warm=await batch(apiPort,agent,spec,options.warmup,1);
    if(warm.samples.some(s=>!s.ok))throw Error('Warm-up failed for '+spec.name+'; no successful benchmark claim');
    const result=await batch(apiPort,agent,spec,options.requests,concurrency);
    measurements.push({round,scenario:spec.name,concurrency,...summarize(result.samples,result.elapsedMs),samples:result.samples});
   }
  }
  const aggregate=[];
  for(const spec of specs)for(const concurrency of options.concurrency){const selected=measurements.filter(m=>m.scenario===spec.name&&m.concurrency===concurrency);aggregate.push({scenario:spec.name,concurrency,...summarize(selected.flatMap(m=>m.samples),selected.reduce((sum,m)=>sum+m.elapsedMs,0))});}
  const repo=path.resolve(__dirname,'../..');let revision='unknown';try{revision=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
  const sources=['backend/app.js','backend/sessions.js','backend/routes/projectRoutes.js','backend/routes/taskBoardRoutes.js','backend/scripts/apiBenchmark.js','backend/scripts/apiBenchmarkMetrics.js','backend/scripts/apiBenchmarkServer.js'];
  report={format:'freelancechain-local-api-benchmark-v1',runId:id,createdAt:new Date().toISOString(),environment:'isolated_local_loopback',revision,
   sourceHashes:Object.fromEntries(sources.map(file=>[file,crypto.createHash('sha256').update(syncFs.readFileSync(path.join(repo,file))).digest('hex')])),
   runtime:{node:process.version,mongoose:mongoose.version,mongodb:mongoInfo.version,os:os.platform(),release:os.release(),arch:os.arch(),logicalCpus:os.cpus().length,cpu:os.cpus()[0]?.model,memoryGiB:Math.round(os.totalmem()/1024**3)},
   configuration:{...options,requestTimeoutMs:5000,maxConcurrentRequests:Math.max(...options.concurrency),keepAlive:true,workersStarted:false,privateStorageBackend:'mongo',loadGenerator:'separate process on same machine',externalServicesCalled:false,sessionSetup:'real synthetic DB sessions; password login excluded',measuredMethods:['GET']},
   dataset:{synthetic:true,users:2,openProjects:options.projects,assignedProjects:1,privateTasks:30,returnedPageSize:12},
   methodology:{percentile:'nearest rank',latency:'client-observed request start through full JSON response and validation',concurrency:'closed-loop bounded workers; no fixed arrival rate',warmupExcluded:true,concurrencyOrder:'forward on odd rounds, reverse on even rounds',p95SampleWarning:'120 requests per cell at defaults; short local sample, not capacity certification'},
   aggregate,rounds:measurements.map(({samples,...rest})=>rest),limitations:['No Vercel/Render/Atlas/network/TLS latency measured','Warm steady-state reads only; startup, login bcrypt, writes/uploads, AI, email and live streams excluded','Synthetic dataset and same-machine generator do not model real users or production scale','No before/after comparison or universal capacity/SLA claim'],passed:aggregate.every(row=>row.errors===0)};
 } finally {
  if(agent)agent.destroy();await stopChild(server);
  if(mongoose?.connection.readyState===1){if(mongoose.connection.name!==database)throw Error('Cleanup target mismatch');await mongoose.connection.dropDatabase();await mongoose.disconnect();}
  await stopChild(mongo);
  const absolute=path.resolve(directory);const parent=await fs.realpath(temporaryRoot);
  if(path.dirname(await fs.realpath(absolute))!==parent||!path.basename(absolute).startsWith('fc-api-benchmark-')||(await fs.lstat(absolute)).isSymbolicLink())throw Error('Cleanup path rejected');
  await fs.rm(absolute,{recursive:true,force:true});cleanup=true;
 }
 report.cleanup={ownedDatabaseDropped:cleanup,ownedProcessesStopped:cleanup,temporaryDirectoryRemoved:cleanup};
 const reports=path.resolve(__dirname,'../../outputs/performance');await fs.mkdir(reports,{recursive:true});
 const stem='local-api-'+report.createdAt.replace(/[:.]/g,'-')+'-'+id;
 const jsonPath=path.join(reports,stem+'.json'),mdPath=path.join(reports,stem+'.md');
 await fs.writeFile(jsonPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 const md=['# FreelanceChain controlled local API benchmark','',`Date UTC: ${report.createdAt}`,`Source revision: ${report.revision}`,'','Synthetic local measurement only. No live load and no before/after claim.','', '| Scenario | Concurrent requests | Requests | p50 ms | p95 ms | Error rate % | Requests per second |','| --- | --- | --- | --- | --- | --- | --- |',...report.aggregate.map(r=>`| ${r.scenario} | ${r.concurrency} | ${r.requests} | ${r.p50Ms} | ${r.p95Ms} | ${r.errorRatePercent} | ${r.requestsPerSecond} |`),'','## Context','',`Node ${report.runtime.node}; MongoDB ${report.runtime.mongodb}; ${report.runtime.os}/${report.runtime.arch}; ${report.runtime.logicalCpus} logical CPUs; ${report.runtime.memoryGiB} GiB RAM.`,`${options.rounds} rounds; ${options.requests} requests per round/cell; ${options.warmup} excluded warm-up reads before each cell.`,`${options.projects} open projects, one assigned project, 30 private tasks, two synthetic accounts. Page size 12.`, 'Closed-loop load generator and API use separate processes on the same host. Connections are reused. Authenticated scenarios use actual MongoDB sessions; login hashing is not timed. All HTTP, transport, timeout and invalid-body failures count as errors. Successful-only percentiles and round-level results are in JSON.','', '## Limits','',...report.limitations.map(s=>'- '+s),'','Cleanup completed: '+cleanup+'. No credentials, cookies or response bodies are saved.',''];
 await fs.writeFile(mdPath,md.join('\n'),{flag:'wx'});
 console.table(report.aggregate.map(({scenario,concurrency,p50Ms,p95Ms,errorRatePercent,requestsPerSecond})=>({scenario,concurrency,p50Ms,p95Ms,errorRatePercent,requestsPerSecond})));
 console.log('JSON report: '+jsonPath);console.log('Markdown report: '+mdPath);
 if(!report.passed)process.exitCode=1;
 return report;
}
if(require.main===module)main().catch(error=>{console.error('Local benchmark stopped without a success claim: '+(error.name==='Error'?error.message:'setup or database failure'));process.exitCode=1;});
module.exports={main};
