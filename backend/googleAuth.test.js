const test=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto"),mongoose=require("mongoose");
process.env.JWT_SECRET=crypto.randomBytes(32).toString("hex");process.env.GOOGLE_CLIENT_ID="test.apps.googleusercontent.com";
const {OAuth2Client}=require("google-auth-library"),User=require("./models/User"),Challenge=require("./models/GoogleLoginChallenge"),app=require("./app");
test("Google challenges verify identity, protect accounts and create normal sessions",async()=>{
 const db="freelancechain_google_test_"+crypto.randomBytes(8).toString("hex");let server,payload;const verify=OAuth2Client.prototype.verifyIdToken;
 OAuth2Client.prototype.verifyIdToken=async function(options){assert.equal(options.audience,process.env.GOOGLE_CLIENT_ID);if(options.idToken==="invalid")throw Error("bad signature");return{getPayload:()=>payload};};
 try{
 await mongoose.connect((process.env.TEST_MONGO_BASE||"mongodb://127.0.0.1:27017")+"/"+db);await Promise.all([User.init(),Challenge.init()]);server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));const base="http://127.0.0.1:"+server.address().port+"/api";
 async function req(path,body,cookie){const r=await fetch(base+path,{method:body?"POST":"GET",headers:{"Content-Type":"application/json","X-FreelanceChain-Request":"1",...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,json:await r.json(),cookie:r.headers.get("set-cookie")};}
 async function challenge(role="client",mode="register"){const r=await req("/auth/google/challenge",{role,mode});assert.equal(r.status,200);payload={sub:crypto.randomBytes(10).toString("hex"),email:"new@gmail.com",email_verified:true,name:"Google user",aud:process.env.GOOGLE_CLIENT_ID,iss:"https://accounts.google.com",exp:Math.floor(Date.now()/1000)+120,nonce:r.json.nonce};return{cookie:r.cookie.split(";")[0],role,mode};}
 async function login(c,credential="test-signed-token"){return req("/auth/google",{credential,role:c.role,mode:c.mode},c.cookie);}
 assert.equal((await req("/auth/google/status")).json.available,true);
 assert.equal((await req("/auth/google/challenge",{role:"admin",mode:"register"})).status,400);
 const c=await challenge();assert.equal((await login(c,"invalid")).status,400);payload.nonce="wrong";assert.equal((await login(c)).status,400);payload.nonce=c.cookie.split("=")[1];
 const ok=await login(c);assert.equal(ok.status,200,JSON.stringify(ok.json));assert.ok(ok.json.csrfToken);assert.match(ok.cookie,/HttpOnly/);assert.equal(ok.json.user.googleSubject,undefined);assert.equal(ok.json.user.password,undefined);assert.equal((await login(c)).status,400);
 const created=await User.findOne({email:"new@gmail.com"});assert.equal(created.authProvider,"google");assert.equal(created.password,undefined);created.profile.bio="Updated profile";await created.save();
 const wrongRole=await challenge("freelancer","login");payload.sub=(await User.findById(created._id).select("+googleSubject")).googleSubject;assert.equal((await login(wrongRole)).status,403);
 const collision=await User.create({name:"Unverified",email:"unverified@gmail.com",password:"test-hash",role:"client"});const cl=await challenge();payload.email=collision.email;assert.equal((await login(cl)).status,409);assert.equal((await User.findById(collision._id).select("+googleSubject")).googleSubject,undefined);
 await User.updateOne({_id:collision._id},{$set:{emailVerifiedAt:new Date()}});const linked=await challenge();payload.email=collision.email;assert.equal((await login(linked)).status,200);
 const external=await challenge();payload.email="user@example.test";assert.equal((await login(external)).status,403);
 const expired=await challenge();await Challenge.updateMany({},{$set:{expiresAt:new Date(0)}});assert.equal((await login(expired)).status,400);
 const absent=await challenge("client","login");payload.email="absent@gmail.com";assert.equal((await login(absent)).status,404);
 const suspended=await challenge();await User.updateOne({_id:created._id},{$set:{suspended:true}});payload.sub=(await User.findById(created._id).select("+googleSubject")).googleSubject;assert.equal((await login(suspended)).status,403);
 delete process.env.GOOGLE_CLIENT_ID;assert.equal((await req("/auth/google/status")).json.available,false);assert.equal((await req("/auth/google/challenge",{role:"client",mode:"login"})).status,503);
 }finally{OAuth2Client.prototype.verifyIdToken=verify;if(server)await new Promise(r=>server.close(r));if(mongoose.connection.readyState===1&&mongoose.connection.name===db)await mongoose.connection.dropDatabase();await mongoose.disconnect();}
});
