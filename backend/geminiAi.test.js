const test = require('node:test');
const assert = require('node:assert/strict');
const { aiStatus, aiConfig } = require('./aiProvider');
const { generateAiMilestones } = require('./aiPlanner');
const { rankApplicants } = require('./semanticMatching');
const names = ['AI_PROVIDER', 'GEMINI_API_KEY', 'OPENAI_API_KEY'];
const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
test.beforeEach(() => { process.env.AI_PROVIDER='gemini'; process.env.GEMINI_API_KEY='synthetic-key'; process.env.OPENAI_API_KEY='unused-openai-key'; });
test.after(() => { for (const name of names) if (prior[name] === undefined) delete process.env[name]; else process.env[name]=prior[name]; });
const project = { title: 'Synthetic writing check', description: 'Write an article explaining a React dashboard API for a beginner audience.', category: 'Writing & Translation', requiredSkills: ['Technical Writing'], budget: 100.01 };
const plan = { milestones: [{ title: 'Outline', description: 'Agree the article outline.', weight: 30, dependsOn: [] }, { title: 'Article and edit', description: 'Deliver the article and agreed edits.', weight: 70, dependsOn: [0] }] };
const applicants = [{ _id: 'synthetic-writer', proposal: 'Write the article.', freelancer: { profile: { skills: ['Technical Writing'] } }, match: { score: 70 } }, { _id: 'synthetic-developer', proposal: 'Build a server.', freelancer: { profile: { skills: ['Node.js'] } }, match: { score: 70 } }];
test('Gemini status exposes provider disclosure and models, never keys or paid fallback', () => {
  assert.equal(aiStatus().providerName, 'Google Gemini'); assert.equal(aiStatus().available, true);
  assert.equal(aiStatus().planningModel, 'gemini-3.5-flash-lite'); assert.equal(aiStatus().matchingModel, 'gemini-embedding-2');
  assert.match(aiStatus().dataNotice, /free-tier/); assert.doesNotMatch(JSON.stringify(aiStatus()), /synthetic-key|unused-openai-key/);
  delete process.env.GEMINI_API_KEY; assert.equal(aiStatus().available, false); assert.equal(aiConfig().provider, 'gemini');
  process.env.AI_PROVIDER='unknown'; assert.equal(aiStatus().available, false);
});
test('Gemini planner sends category-aware structured output request and cent-exact reviewable draft', async () => {
  let calls=0;
  const result=await generateAiMilestones(project,{fetchImpl:async (url, options)=>{
    calls++; assert.match(url, /gemini-3.5-flash-lite:generateContent$/); assert.equal(url.includes('key='), false);
    assert.equal(options.headers['x-goog-api-key'],'synthetic-key'); const body=JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType,'application/json'); assert.equal(body.generationConfig.responseJsonSchema.additionalProperties,false);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).category,'Writing & Translation');
    return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(plan)}]}}]})};
  }});
  assert.equal(calls,1); assert.equal(result.provider,'gemini'); assert.equal(result.method,'ai_assisted');
  assert.equal(Math.round(result.suggestions.reduce((sum,item)=>sum+item.payment,0)*100),10001);
});
test('Gemini refusal, quota, malformed JSON and invalid dependencies fail once without switching providers', async () => {
  for (const response of [{ok:false,status:429},{ok:true,json:async()=>({promptFeedback:{blockReason:'SAFETY'}})},{ok:true,json:async()=>({candidates:[{finishReason:'MAX_TOKENS'}]})},{ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'not JSON'}]}}]})},{ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({milestones:[{...plan.milestones[0],dependsOn:[0]},plan.milestones[1]]})}]}}]})}]) {
    let calls=0; await assert.rejects(()=>generateAiMilestones(project,{fetchImpl:async(url)=>{calls++; assert.match(url,/googleapis/); return response;}})); assert.equal(calls,1);
  }
});
test('Gemini matching embeds all texts in one request and ranks with existing explainable fit', async () => {
  let calls=0;
  const result=await rankApplicants(project,applicants,async(url,options)=>{
    calls++; assert.match(url,/gemini-embedding-2:batchEmbedContents$/); const body=JSON.parse(options.body);
    assert.equal(body.requests.length,3); assert.equal(body.requests[0].outputDimensionality,768);
    assert.match(body.requests[0].content.parts[0].text,/Writing & Translation/);
    return {ok:true,json:async()=>({embeddings:[{values:[1,0]},{values:[1,0]},{values:[0,1]}]})};
  });
  assert.equal(calls,1); assert.equal(result.model,'gemini-embedding-2'); assert.equal(result.provider,'gemini');
  assert.deepEqual(result.ranking.map(row=>[row.applicationId,row.score]),[['synthetic-writer',88],['synthetic-developer',28]]);
});
test('Gemini incomplete or invalid vectors cannot produce a ranking, and missing key sends nothing', async()=>{
  for(const body of [{embeddings:[]},{embeddings:[{values:[1,0]},null,{values:[0,1]}]},{embeddings:[{values:[0,0]},{values:[1,0]},{values:[0,1]}]}]) await assert.rejects(()=>rankApplicants(project,applicants,async()=>({ok:true,json:async()=>body})));
  delete process.env.GEMINI_API_KEY; let calls=0; await assert.rejects(()=>rankApplicants(project,applicants,async()=>{calls++;})); assert.equal(calls,0);
});
