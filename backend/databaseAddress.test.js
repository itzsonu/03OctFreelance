const test=require("node:test");
const assert=require("node:assert/strict");
const { databaseUriWithPassword }=require("./deployment");
const base="mongodb+srv://fc_app@cluster.example.test/freelancechain_demo?retryWrites=true&w=majority&authSource=admin";
test("separate password preserves the explicit database and encodes reserved characters",()=>{
  const password="test/@:#?$[]%+ only";
  const uri=databaseUriWithPassword(base,password);
  const parsed=new URL(uri);
  assert.equal(decodeURIComponent(parsed.password),password);
  assert.equal(parsed.pathname,"/freelancechain_demo");
  assert.equal(parsed.searchParams.get("authSource"),"admin");
  assert.equal(require("./recovery").namedDatabase(uri),"freelancechain_demo");
});
test("invalid addresses and ambiguous credential sources fail without leaking values",()=>{
  for(const uri of ["password-only","https://fc_app@cluster.example.test/db","mongodb+srv://cluster.example.test/db","mongodb+srv://fc_app:already-set@cluster.example.test/db","mongodb+srv://fc_app@cluster.example.test/","mongodb+srv://fc_app@cluster.example.test/admin"]){
    assert.throws(()=>databaseUriWithPassword(uri,"test-only-private-password"),error=>!error.message.includes("test-only-private-password")&&!error.message.includes("already-set"));
  }
  assert.throws(()=>databaseUriWithPassword(base,""),/MONGO_PASSWORD is required/);
});
