const test = require('node:test'), assert = require('node:assert/strict');
const { nearestRank, summarize, parseOptions } = require('./apiBenchmarkMetrics');
test('nearest-rank percentiles and empty successful samples are explicit', () => {
  assert.equal(nearestRank([4,1,3,2], .5), 2); assert.equal(nearestRank(Array.from({length:100},(_,i)=>i+1), .95),95);
  const result = summarize([{ms:10,ok:false,status:500},{ms:5000,ok:false,timeout:true}],1000);
  assert.equal(result.p95Ms,5000);assert.equal(result.successP95Ms,null);assert.equal(result.errorRatePercent,100);assert.equal(result.timeouts,1);
});
test('HTTP errors and invalid success bodies count as errors instead of fast successes',()=>{
 const result=summarize([{ms:1,status:200,ok:true},{ms:2,status:200,ok:false,invalidBody:true},{ms:3,status:429,ok:false}],1000);
 assert.equal(result.successes,1);assert.equal(result.errors,2);assert.equal(result.invalidBodies,1);assert.equal(result.statusCounts['429'],1);
});
test('bounded options reject remote targets, excess concurrency and accidental large load',()=>{
 assert.deepEqual(parseOptions([]).concurrency,[1,5,10]);
 for(const args of [['--url','https://example.test'],['--concurrency','100'],['--requests','200','--rounds','5','--concurrency','1,5,10,20'],['--rounds','0']])assert.throws(()=>parseOptions(args));
});
