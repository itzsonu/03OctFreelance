const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { testSession, authHeaders } = require("./testSession");
const { sampleComparison, createDemoRunner } = require("./aiComparisonDemo");
const { rankApplicants } = require("./semanticMatching");
const { projectInsights } = require("./insights");
const { requireAiResponse } = require("./aiProvider");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.AI_PROVIDER = "gemini";
delete process.env.GEMINI_API_KEY;
const app = require("./app");
const User = require("./models/User");
const Project = require("./models/Project");
const Application = require("./models/Application");

test("sample comparison uses the production scorer and one genuine-shaped embedding batch", async () => {
  const sample = sampleComparison();
  assert.equal(sample.synthetic, true);
  assert.equal(sample.applicants.length, 3);
  assert.ok(sample.applicants.every(a => a.trust.score === null && a.trust.approvedMilestones === 0));
  assert.ok(sample.applicants[0].match.score > sample.applicants[1].match.score);
  process.env.GEMINI_API_KEY = "test-only-not-a-real-key";
  let calls = 0;
  try {
    const result = await rankApplicants(sample.project, sample.applicants, async (url, options) => {
      calls++;
      assert.match(url, /batchEmbedContents$/);
      const body = JSON.parse(options.body);
      assert.equal(body.requests.length, 4);
      assert.ok(body.requests.every(r => !/email|password|@example/.test(r.content.parts[0].text)));
      return { ok: true, json: async () => ({ embeddings: [[1,0], [1,0], [0.8,0.6], [0,1]].map(values => ({values})) }) };
    });
    assert.equal(calls, 1);
    assert.equal(result.ranking[0].applicationId, "sample-writer");
    for (const item of result.ranking) assert.equal(item.score, Math.round(item.semanticScore * 0.6 + item.ruleScore * 0.4));
  } finally { delete process.env.GEMINI_API_KEY; }
});

test("sample requests coalesce, reuse cache and bound retries after quota errors", async () => {
  let calls=0, clock=100000;
  const run=createDemoRunner({now:()=>clock,rank:async()=>{calls++;return {ranking:[],model:"test"};}});
  await Promise.all([run(),run(),run()]);
  assert.equal(calls,1);
  assert.equal((await run()).cached,true);
  clock+=600001;
  await run(); assert.equal(calls,2);
  const unavailable=createDemoRunner({now:()=>clock,rank:async()=>{throw new Error("unavailable");}});
  await assert.rejects(unavailable,/unavailable/);
  await assert.rejects(unavailable,/wait a minute/);
  await assert.rejects(()=>requireAiResponse({ok:false,status:429,json:async()=>({error:{status:"RESOURCE_EXHAUSTED"}})},"matching"), error=>error.status===429 && /Regular fit/.test(error.message) && !/guided draft/.test(error.message));
});

test("a missed milestone target is visible even before the project deadline", () => {
  const project={status:"In Progress",deadline:"2030-12-31",milestones:[{status:"active",dueDate:"2030-12-01"},{status:"completed",dueDate:"2030-11-01"}]};
  const before=JSON.stringify(project);
  const result=projectInsights(project,new Date("2030-12-02T12:00:00Z"));
  assert.equal(result.level,"urgent");
  assert.match(result.reasons[0],/1 unapproved milestone is past/);
  assert.equal(JSON.stringify(project),before);
  assert.equal(projectInsights({...project,status:"Completed"},new Date("2030-12-02")).level,"complete");
});

test("revision, withdrawn/declined offers and participant authorization against an isolated Mongo database", async t => {
  const db="freelancechain_finish_test_"+crypto.randomBytes(8).toString("hex");
  let server;
  try {
    await mongoose.connect((process.env.TEST_MONGO_BASE||"mongodb://127.0.0.1:27028")+"/"+db,{serverSelectionTimeoutMS:5000});
    server=app.listen(0,"127.0.0.1"); await new Promise(r=>server.once("listening",r));
    const base="http://127.0.0.1:"+server.address().port+"/api";
    const people={};
    for(const [name,role] of [["client","client"],["stranger","client"],["worker","freelancer"],["other","freelancer"]]) {
      const user=await User.create({name,email:name+"@example.test",password:"test-only-hash",role});
      people[name]={id:user._id,auth:await testSession(user)};
    }
    async function request(method,path,who,body,status=200){
      const response=await fetch(base+path,{method,headers:{...authHeaders(people[who]?.auth),"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
      const data=await response.json(); assert.equal(response.status,status,method+" "+path+": "+JSON.stringify(data));return data;
    }
    const draft={title:"Synthetic workflow check",category:"Writing & Translation",description:"Write and edit a sample tutorial for workflow verification only.",requiredSkills:["Technical Writing"],budget:1000,deadline:"2030-12-31",milestones:[{title:"Draft",payment:500,dueDate:"2030-12-15",dependsOn:[]},{title:"Final",payment:500,dueDate:"2030-12-31",dependsOn:[0]}]};
    const create=async()=> (await request("POST","/projects/create","client",draft,201)).project;
    const apply=async p=>(await request("POST","/applications","worker",{projectId:p._id,proposal:"I will write the sample tutorial and edit the final draft.",proposedPrice:1000,deliveryEstimateDays:10},201)).application;
    const offer=async a=>(await request("POST","/applications/"+a._id+"/offer","client",{terms:{scope:draft.description,amount:1000,deliveryDate:draft.deadline,milestones:draft.milestones}},201)).application;
    await t.test("fixed sample demo cannot submit real text or be run by a freelancer",async()=>{
      await request("GET","/applications/ai-demo",null,null,401);
      await request("GET","/applications/ai-demo","worker",null,403);
      const demo=await request("GET","/applications/ai-demo","client");assert.equal(demo.applicants.length,3);assert.equal(demo.available,false);
      await request("POST","/applications/ai-demo","client",{proposal:"real text"},400);
      await request("POST","/applications/ai-demo","client",{},503);
    });
    await t.test("withdrawal and decline close offers and block stale acceptance",async()=>{
      for(const action of ["withdraw","decline"]){
        const p=await create(),a=await apply(p),o=await offer(a);
        const route="/applications/"+a._id+(action==="withdraw"?"/withdraw":"/offer/"+o.currentOfferId+"/decline");
        await request("POST",route,"other",{},403);
        await request("POST",route,"worker",{});
        const saved=await Application.findById(a._id);
        assert.equal(saved.status,action==="withdraw"?"WITHDRAWN":"REJECTED");
        assert.equal(saved.currentOfferState,action==="withdraw"?"STALE":"DECLINED");
        await request("POST","/applications/"+a._id+"/offer/"+o.currentOfferId+"/accept","worker",{},409);
        assert.equal((await Project.findById(p._id)).freelancer,null);
      }
    });
    await t.test("revision keeps history, rejects stale feedback and unlocks only on current approval",async()=>{
      const p=await create(),a=await apply(p),o=await offer(a);
      await request("POST","/applications/"+a._id+"/offer/"+o.currentOfferId+"/accept","worker",{});
      p.milestones=(await request("GET","/projects/"+p._id,"client")).milestones;
      const first=p.milestones[0]._id,second=p.milestones[1]._id;
      const step="/projects/"+p._id+"/milestone/"+first;
      await request("GET","/projects/"+p._id,"stranger",null,403);
      await request("GET","/projects/"+p._id,"other",null,403);
      await request("POST",step+"/submit","other",{submittedWork:"Forbidden"},403);
      await request("POST",step+"/request-revision","stranger",{feedback:"Unauthorized revision request"},403);
      await request("POST","/projects/"+p._id+"/milestone/"+second+"/submit","worker",{submittedWork:"Locked work"},400);
      let result=await request("POST",step+"/submit","worker",{submittedWork:"Synthetic first draft"});
      const v1=result.project.milestones[0].currentSubmission;
      await request("POST",step+"/approve","stranger",{submissionId:v1},403);
      result=await request("POST",step+"/request-revision","client",{feedback:"Please add a clear example and edit the conclusion.",submissionId:v1});
      assert.equal(result.project.milestones[1].status,"locked");
      result=await request("POST",step+"/submit","worker",{submittedWork:"Synthetic revised draft with example"});
      const v2=result.project.milestones[0].currentSubmission;
      await request("POST",step+"/request-revision","client",{feedback:"Stale feedback from the previous version.",submissionId:v1},409);
      await request("POST",step+"/approve","client",{submissionId:v1},409);
      const saved=await Project.findById(p._id);assert.equal(saved.milestones[0].revisionCount,1);assert.equal(saved.milestones[0].submissions.length,2);assert.equal(saved.milestones[0].revisionRequests[0].submission.toString(),v1);
      result=await request("POST",step+"/approve","client",{submissionId:v2});
      assert.equal(result.project.milestones[1].status,"active");
      const reloaded=await request("GET","/projects/"+p._id,"worker");
      assert.equal(reloaded.milestones[0].submissions[0].work,"Synthetic first draft");
      assert.equal(reloaded.milestones[0].submissions[1].work,"Synthetic revised draft with example");
    });
  } finally {
    if(server)await new Promise(r=>server.close(r));
    if(mongoose.connection.readyState===1 && mongoose.connection.name===db)await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
