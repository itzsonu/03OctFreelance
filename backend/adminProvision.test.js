const test=require('node:test'),assert=require('node:assert/strict');
const mongoose=require('mongoose'),bcrypt=require('bcryptjs'),User=require('./models/User');
const {createAdmin}=require('./scripts/createAdmin');
const env={ADMIN_NAME:'Test Admin',ADMIN_EMAIL:'NEW-ADMIN@example.test',ADMIN_PASSWORD:'test-only-strong-password',MONGO_URI:'mongodb+srv://test_user@db.example.test/test_admin?authSource=admin',MONGO_PASSWORD:'test-only:p@ss/word'};
test('admin provisioning encodes separate DB password and creates hashed admin only',async t=>{
 let captured;const connect=t.mock.method(mongoose,'connect',async()=>{});t.mock.method(mongoose,'disconnect',async()=>{});t.mock.method(console,'log',()=>{});t.mock.method(User,'exists',async()=>false);t.mock.method(User,'create',async data=>{captured=data;return{...data,_id:'test-only-id'};});
 await createAdmin({...env});assert.equal(connect.mock.calls[0].arguments[0],'mongodb+srv://test_user:test-only%3Ap%40ss%2Fword@db.example.test/test_admin?authSource=admin');assert.equal(captured.role,'admin');assert.equal(captured.email,'new-admin@example.test');assert.notEqual(captured.password,env.ADMIN_PASSWORD);assert.ok(await bcrypt.compare(env.ADMIN_PASSWORD,captured.password));
});
test('existing accounts cannot be promoted or overwritten',async t=>{
 t.mock.method(mongoose,'connect',async()=>{});const close=t.mock.method(mongoose,'disconnect',async()=>{});t.mock.method(User,'exists',async()=>true);const write=t.mock.method(User,'create',async()=>{throw Error('must not write');});await assert.rejects(createAdmin({...env}),/never promotes/);assert.equal(write.mock.calls.length,0);assert.equal(close.mock.calls.length,1);
});
test('invalid password and ambiguous DB config fail before connecting',async t=>{
 const connect=t.mock.method(mongoose,'connect',async()=>{});await assert.rejects(createAdmin({...env,ADMIN_PASSWORD:'short'}),/12–128/);await assert.rejects(createAdmin({...env,MONGO_URI_FILE:'unused'}),/Configure only/);assert.equal(connect.mock.calls.length,0);
});
