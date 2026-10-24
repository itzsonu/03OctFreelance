const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { subscribe, disconnectAll } = require('./liveUpdates');
function open(sessionHash) {
  const response = new EventEmitter();
  Object.assign(response, { statusCode: 200, ended: false, frames: [], status(code) { this.statusCode=code; return this; }, set() {}, flushHeaders() {}, write(frame) { this.frames.push(frame); }, json(body) { this.body=body; return this; }, end() { this.ended=true; this.emit('close'); } });
  subscribe({ user: { _id: 'synthetic-user', role: 'client' }, authSession: { tokenHash: sessionHash, expiresAt: new Date(Date.now()+60000) } }, response);
  return response;
}
test('a full session can replace its oldest held stream while keeping five active slots', () => {
  try {
    const existing=Array.from({ length: 5 },()=>open('same-session'));
    const recovered=open('same-session');
    assert.equal(existing[0].ended,true); assert.equal(existing.slice(1).filter(row=>!row.ended).length,4);
    assert.equal(recovered.statusCode,200); assert.equal(recovered.ended,false); assert.match(recovered.frames[0],/event: ready/);
  } finally { disconnectAll(); }
});
test('a different login session cannot evict existing connections at the user cap', () => {
  try {
    const existing=Array.from({ length: 5 },()=>open('other-session'));
    const blocked=open('new-session');
    assert.equal(blocked.statusCode,429); assert.equal(existing.some(row=>row.ended),false);
  } finally { disconnectAll(); }
});
