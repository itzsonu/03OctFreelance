const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { subscribe, publishProject, publishMarketplace } = require("./liveUpdates");

function connection(userId, role) {
  const res = new EventEmitter();
  res.writes = [];
  res.status = () => res;
  res.set = () => res;
  res.flushHeaders = () => {};
  res.write = text => { res.writes.push(text); return true; };
  res.end = () => res.emit("close");
  subscribe({ user: { _id: userId, role } }, res);
  return res;
}

test("project signals reach only the client and assigned freelancer; marketplace signals reach freelancers", () => {
  const client = connection("client-a", "client");
  const freelancer = connection("freelancer-a", "freelancer");
  const otherClient = connection("client-b", "client");
  try {
    publishProject({ _id: "project-a", client: "client-a", freelancer: "freelancer-a", description: "private project brief" });
    assert.equal(client.writes.filter(value => value.includes("event: project")).length, 1);
    assert.equal(freelancer.writes.filter(value => value.includes("event: project")).length, 1);
    assert.equal(otherClient.writes.filter(value => value.includes("event: project")).length, 0);
    assert.ok(!client.writes.join("").includes("private project brief"));
    publishMarketplace();
    assert.equal(freelancer.writes.filter(value => value.includes("event: marketplace")).length, 1);
    assert.equal(client.writes.filter(value => value.includes("event: marketplace")).length, 0);
  } finally {
    client.emit("close");
    freelancer.emit("close");
    otherClient.emit("close");
  }
});
