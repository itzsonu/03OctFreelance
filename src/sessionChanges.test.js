import { announceSessionChange, listenForSessionChanges } from "./sessionChanges";
const originalChannel = global.BroadcastChannel;
afterEach(() => { global.BroadcastChannel = originalChannel; localStorage.clear(); jest.restoreAllMocks(); });

test("storage fallback signals other tabs without keeping credentials or account data", () => {
  global.BroadcastChannel = undefined;
  const onChange = jest.fn();
  const stop = listenForSessionChanges(onChange);
  const set = jest.spyOn(Storage.prototype, "setItem");
  announceSessionChange();
  expect(set).toHaveBeenCalledWith("freelancechain:session-change", expect.any(String));
  expect(localStorage.length).toBe(0);
  window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "anything" }));
  window.dispatchEvent(new StorageEvent("storage", { key: "freelancechain:session-change", newValue: "event-marker" }));
  window.dispatchEvent(new StorageEvent("storage", { key: "freelancechain:session-change", newValue: null }));
  expect(onChange).toHaveBeenCalledTimes(1);
  stop();
  window.dispatchEvent(new StorageEvent("storage", { key: "freelancechain:session-change", newValue: "later" }));
  expect(onChange).toHaveBeenCalledTimes(1);
});

test("broadcast notification carries only a change signal and releases listeners", () => {
  const channels = new Set();
  const messages = [];
  global.BroadcastChannel = class {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage(data) { messages.push(data); for (const other of channels) if (other !== this && other.name === this.name) other.onmessage?.({ data }); }
    close() { channels.delete(this); }
  };
  const onChange = jest.fn();
  const stop = listenForSessionChanges(onChange);
  announceSessionChange();
  expect(messages).toEqual(["changed"]);
  expect(onChange).toHaveBeenCalledTimes(1);
  stop();
  expect(channels.size).toBe(0);
});
