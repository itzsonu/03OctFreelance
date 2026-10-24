import { waitFor } from "@testing-library/react";
import { subscribeUpdates, invalidateCachedSession } from "./api";

test("authenticated stream parses project events split across network chunks", async () => {
  const originalFetch = global.fetch;
  const originalDecoder = global.TextDecoder;
  global.TextDecoder = require("util").TextDecoder;
  const encode = text => Uint8Array.from(require("buffer").Buffer.from(text));
  const read = jest.fn()
    .mockResolvedValueOnce({ done: false, value: encode("event: ready\ndata: {}\n\nevent: pro") })
    .mockResolvedValueOnce({ done: false, value: encode('ject\ndata: {"projectId":"project-1"}\n\nevent: tasks\ndata: {"projectId":"project-1"}\n\n') })
    .mockResolvedValueOnce({ done: true });
  global.fetch = jest.fn().mockImplementation(url => Promise.resolve(url.endsWith("/auth/session") ? { ok: true, status: 200, json: async () => ({ user: { id: "client-1", role: "client" }, csrfToken: "csrf-test" }) } : { ok: true, status: 200, headers: { get: () => "text/event-stream" }, body: { getReader: () => ({ read }) } }));
  const received = [];
  const stop = subscribeUpdates(event => received.push(event));
  try {
    await waitFor(() => expect(received).toContainEqual({ type: "project", projectId: "project-1" }));
    expect(received).toContainEqual({ type: "tasks", projectId: "project-1" });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/updates$/), expect.objectContaining({ credentials: "include", headers: { Accept: "text/event-stream" } }));
  } finally {
    stop();
    global.fetch = originalFetch;
    global.TextDecoder = originalDecoder;
    localStorage.clear();
  }
});


const bytes = text => Uint8Array.from(require("buffer").Buffer.from(text));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function liveFixture({ contentType = "text/event-stream", status = 200 } = {}) {
  const originalFetch = global.fetch;
  const originalDecoder = global.TextDecoder;
  global.TextDecoder = require("util").TextDecoder;
  invalidateCachedSession();
  const streams = [];
  global.fetch = jest.fn(async (url, options) => {
    if (url.endsWith("/auth/session")) return { ok: true, status: 200, json: async () => ({ user: { id: "client-live", role: "client" }, csrfToken: "synthetic-csrf" }) };
    const stream = { signal: options.signal, push: null };
    const reader = { read: jest.fn(() => new Promise(resolve => { stream.push = resolve; })), releaseLock: jest.fn() };
    stream.reader = reader;
    options.signal.addEventListener("abort", () => stream.push?.({ done: true }));
    streams.push(stream);
    return { ok: status === 200, status, headers: { get: () => contentType }, body: { getReader: () => reader } };
  });
  return { streams, restore: () => { global.fetch = originalFetch; global.TextDecoder = originalDecoder; invalidateCachedSession(); } };
}

test("six views share one stream; removing one listener preserves the others", async () => {
  const fixture = liveFixture(); const received = Array.from({ length: 6 }, () => []);
  const stops = received.map(events => subscribeUpdates(event => events.push(event)));
  try {
    await waitFor(() => expect(fixture.streams).toHaveLength(1));
    const stream = fixture.streams[0];
    stream.push({ done: false, value: bytes("event: ready\r") }); await flush();
    expect(received[0]).toEqual([]);
    stream.push({ done: false, value: bytes("\n" + "data: {}\r\n\r\n") }); await flush();
    received.forEach(events => expect(events).toContainEqual({ type: "connected" }));
    stops[0](); expect(stream.signal.aborted).toBe(false);
    stream.push({ done: false, value: bytes('event: tasks\ndata: {"projectId":"p1"}\n\n') }); await flush();
    expect(received[0]).not.toContainEqual({ type: "tasks", projectId: "p1" });
    expect(received[5]).toContainEqual({ type: "tasks", projectId: "p1" });
    stops.slice(1).forEach(stop => stop()); expect(stream.signal.aborted).toBe(true);
  } finally { stops.forEach(stop => stop()); fixture.restore(); }
});

test("an HTML proxy response never claims to be a live stream", async () => {
  const fixture = liveFixture({ contentType: "text/html" }); const events = [];
  const stop = subscribeUpdates(event => events.push(event));
  try {
    await waitFor(() => expect(events).toContainEqual({ type: "disconnected" }));
    expect(events).not.toContainEqual({ type: "connected" });
    expect(fixture.streams[0].reader.read).not.toHaveBeenCalled();
  } finally { stop(); fixture.restore(); }
});

test("retries back off and recovered connections refresh stale views", async () => {
  jest.useFakeTimers(); const fixture = liveFixture({ status: 429 }); const events = [];
  const stop = subscribeUpdates(event => events.push(event));
  try {
    await flush(); expect(fixture.streams).toHaveLength(1);
    jest.advanceTimersByTime(2999); await flush(); expect(fixture.streams).toHaveLength(1);
    jest.advanceTimersByTime(1); await flush(); expect(fixture.streams).toHaveLength(2);
    jest.advanceTimersByTime(5999); await flush(); expect(fixture.streams).toHaveLength(2);
    global.fetch.mockImplementation(async (url, options) => {
      const stream = { signal: options.signal, push: null };
      const reader = { read: () => new Promise(resolve => { stream.push = resolve; }), releaseLock: jest.fn() };
      options.signal.addEventListener("abort", () => stream.push?.({ done: true }));
      fixture.streams.push(stream);
      return { ok: true, status: 200, headers: { get: () => "text/event-stream" }, body: { getReader: () => reader } };
    });
    jest.advanceTimersByTime(1); await flush(); expect(fixture.streams).toHaveLength(3);
    fixture.streams[2].push({ done: false, value: bytes("event: ready\ndata: {}\n\n") }); await flush();
    expect(events).toContainEqual({ type: "connected" }); expect(events).toContainEqual({ type: "reconnected" });
  } finally { stop(); fixture.restore(); jest.useRealTimers(); }
});

test("stalled streams time out and events from a replaced session are discarded", async () => {
  jest.useFakeTimers(); const fixture = liveFixture(); const events = [];
  const stop = subscribeUpdates(event => events.push(event));
  try {
    await flush(); expect(fixture.streams).toHaveLength(1);
    expect(events).not.toContainEqual({ type: "connected" });
    jest.advanceTimersByTime(45000); await flush();
    expect(fixture.streams[0].signal.aborted).toBe(true);
    expect(events).toContainEqual({ type: "disconnected" });
    jest.advanceTimersByTime(3000); await flush();
    const stream = fixture.streams[1];
    stream.push({ done: false, value: bytes("event: ready\ndata: {}\n\n") }); await flush();
    invalidateCachedSession();
    stream.push({ done: false, value: bytes('event: project\ndata: {"projectId":"old-account"}\n\n') }); await flush();
    expect(events).not.toContainEqual({ type: "project", projectId: "old-account" });
    expect(stream.signal.aborted).toBe(true);
  } finally { stop(); fixture.restore(); jest.useRealTimers(); }
});
