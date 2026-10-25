const test=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto"),mongoose=require("mongoose");
process.env.JWT_SECRET=crypto.randomBytes(32).toString("hex");process.env.APP_ORIGIN="https://example.test";process.env.RESET_DELIVERY="brevo";process.env.BREVO_API_KEY="test-only-api-key";process.env.RESET_FROM_EMAIL="sender@example.test";
const { testSession, authHeaders }=require("./testSession");const User=require("./models/User");const {sendResetEmail,resetDeliveryMode}=require("./resetMail");const app=require("./app");
test("Brevo HTTPS verification is email-bound, single-use, rate-limited and fails safely",async()=>{
 const db="freelancechain_mail_test_"+crypto.randomBytes(8).toString("hex");let server;const original=global.fetch;const sent=[];let rejectMail=false;
 const tokenOf=mail=>new URL(mail.textContent.split("\n").find(line=>line.startsWith("https://"))).searchParams.get("token");
 global.fetch=async(url,options)=>{if(String(url).startsWith("https://api.brevo.com/")){assert.equal(options.headers["api-key"],"test-only-api-key");assert.equal(String(url),"https://api.brevo.com/v3/smtp/email");sent.push(JSON.parse(options.body));return {ok:!rejectMail,status:rejectMail?429:201,json:async()=>({messageId:"mock-accepted"})};}return original(url,options);};
 try{
  await mongoose.connect((process.env.TEST_MONGO_BASE||"mongodb://127.0.0.1:27017")+"/"+db,{serverSelectionTimeoutMS:5000});
  server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));const base="http://127.0.0.1:"+server.address().port+"/api";
  async function person(name){const user=await User.create({name,email:name+"@example.test",password:"test-only-hash",role:"client"});return{user,auth:await testSession(user)};}
  async function request(method,path,actor,body,status=200){const r=await original(base+path,{method,headers:{...authHeaders(actor?.auth),"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();assert.equal(r.status,status,JSON.stringify(j));return j;}
  const owner=await person("owner");assert.equal(resetDeliveryMode(),"email");
  await request("POST","/account/email-verification",null,{},401);
  await request("POST","/account/email-verification",owner,{});assert.equal(sent.length,1);
  assert.equal(sent[0].to[0].email,owner.user.email);assert.equal(sent[0].sender.email,"sender@example.test");
  const token=tokenOf(sent[0]);const saved=await User.findById(owner.user._id).select("+emailVerificationTokenHash");assert.notEqual(saved.emailVerificationTokenHash,token);assert.equal(saved.emailVerifiedAt,null);
  await request("POST","/account/email-verification",owner,{},429);assert.equal(sent.length,1);
  await request("GET","/account/email-verification/confirm?token="+token,null,null,401);
  await request("POST","/account/email-verification/confirm",null,{token:"bad"},400);
  await request("POST","/account/email-verification/confirm",null,{token});assert.ok((await User.findById(owner.user._id)).emailVerifiedAt);
  await request("POST","/account/email-verification/confirm",null,{token},400);
  for(const kind of ["expired","changed"]){const actor=await person(kind);await request("POST","/account/email-verification",actor,{});const t=tokenOf(sent.at(-1));await User.updateOne({_id:actor.user._id},{$set:kind==="expired"?{emailVerificationExpiresAt:new Date(0)}:{email:"changed-new@example.test"}});await request("POST","/account/email-verification/confirm",null,{token:t},400);assert.equal((await User.findById(actor.user._id)).emailVerifiedAt,null);}
  const failed=await person("failure");rejectMail=true;await request("POST","/account/email-verification",failed,{},503);assert.equal((await User.findById(failed.user._id).select("+emailVerificationTokenHash")).emailVerificationTokenHash,undefined);
  rejectMail=false;await sendResetEmail("owner@example.test","x".repeat(43));assert.match(sent.at(-1).textContent,/reset-password/);
  delete process.env.BREVO_API_KEY;assert.equal(resetDeliveryMode(),"unavailable");
 }finally{global.fetch=original;if(server)await new Promise(r=>server.close(r));if(mongoose.connection.readyState===1&&mongoose.connection.name===db)await mongoose.connection.dropDatabase();await mongoose.disconnect();}
});
