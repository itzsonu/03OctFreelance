const test=require('node:test'),assert=require('node:assert/strict');
const {PassThrough,Writable}=require('node:stream');
const {createPrompt}=require('./adminConsolePrompt');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){const input=new PassThrough();let text='';const output=new Writable({write(c,e,cb){text+=c.toString();cb();}});return{input,prompt:createPrompt(input,output),text:()=>text};}
test('hidden password does not erase final prompt; blank input retries and lowercase works',async()=>{
 const s=setup();try{const password=s.prompt.ask('Secret password (hidden): ',true);s.input.write('mock-only-password\r\n');assert.equal(await password,'mock-only-password');assert.equal(s.text().includes('mock-only-password'),false);
 const confirmation=s.prompt.confirmCreate();assert.match(s.text(),/Type CREATE/);s.input.write('\r\n');await tick();assert.match(s.text(),/No account created yet/);s.input.write('  create  \r\n');assert.equal(await confirmation,true);
 }finally{s.prompt.close();s.input.end();}
});
test('only explicit CANCEL cancels the final confirmation',async()=>{const s=setup();try{const p=s.prompt.confirmCreate();s.input.write('cancel\r\n');assert.equal(await p,false);}finally{s.prompt.close();s.input.end();}});
