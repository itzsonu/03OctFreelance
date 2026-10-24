let client;
const originalFetch = global.fetch;
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const user = { id: "client-1", role: "client", name: "Asha" };
beforeEach(() => {
  localStorage.setItem("token", "legacy-secret"); localStorage.setItem("user", JSON.stringify(user));
  jest.isolateModules(() => { client = require("./api"); });
  global.fetch = jest.fn();
});
afterEach(() => { global.fetch = originalFetch; localStorage.clear(); });

test("login and protected writes use cookies plus CSRF without persistent browser credentials", async () => {
  global.fetch.mockResolvedValueOnce(response({ user, csrfToken: "csrf-one" })).mockResolvedValueOnce(response({ message: "Saved" }));
  await client.api("/auth/login", { method: "POST", body: "{}" });
  await client.api("/project-drafts", { method: "POST", body: "{}" });
  expect(client.currentUser()).toEqual(user);
  expect(localStorage.getItem("token")).toBeNull(); expect(localStorage.getItem("user")).toBeNull();
  const options = global.fetch.mock.calls[1][1];
  expect(options.credentials).toBe("include");
  expect(options.headers["X-CSRF-Token"]).toBe("csrf-one");
  expect(options.headers["X-FreelanceChain-Request"]).toBe("1");
  expect(options.headers.Authorization).toBeUndefined();
});

test("page reload restores identity from the server and coalesces concurrent checks", async () => {
  global.fetch.mockResolvedValue(response({ user, csrfToken: "restored" }));
  await Promise.all([client.restoreSession(), client.restoreSession()]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(client.currentUser()).toEqual(user);
  expect(global.fetch.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store" });
});

test("failed server logout keeps the UI signed in; successful logout clears memory", async () => {
  global.fetch.mockResolvedValueOnce(response({ user, csrfToken: "csrf-one" })).mockResolvedValueOnce(response({ message: "Please retry" }, 503)).mockResolvedValueOnce(response({ signedOut: true }));
  await client.restoreSession();
  await expect(client.signOut()).rejects.toThrow("Please retry");
  expect(client.currentUser()).toEqual(user);
  await client.signOut();
  expect(client.currentUser()).toBeNull();
});

test("a late 401 from a previous session cannot erase a newer login", async () => {
  let finish;
  global.fetch.mockResolvedValueOnce(response({ user, csrfToken: "old" }));
  await client.restoreSession();
  global.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const oldRequest = client.api("/projects/mine").catch(() => {});
  const newUser = { id: "client-2", role: "client" };
  global.fetch.mockResolvedValueOnce(response({ user: newUser, csrfToken: "new" }));
  await client.api("/auth/login", { method: "POST", body: "{}" });
  finish(response({ message: "Expired" }, 401));
  await oldRequest;
  expect(client.currentUser()).toEqual(newUser);
});

test("an HTML success page cannot turn a session check into a guest login", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError("HTML response"); } });
  await expect(client.restoreSession()).rejects.toThrow("unreadable response");
  global.fetch.mockResolvedValueOnce(response({ user, csrfToken: "restored" }));
  await client.restoreSession();
  expect(client.currentUser()).toEqual(user);
});

test("temporary proxy errors preserve sign-in and do not replay a write", async () => {
  global.fetch.mockResolvedValueOnce(response({ user, csrfToken: "csrf-one" }));
  await client.restoreSession();
  global.fetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw new SyntaxError("HTML response"); } });
  await expect(client.api("/project-drafts", { method: "POST", body: "{}" })).rejects.toThrow("Connection interrupted");
  expect(client.currentUser()).toEqual(user);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test("malformed session JSON cannot sign out an existing account or confirm a new login", async () => {
  global.fetch.mockResolvedValueOnce(response({}));
  await expect(client.restoreSession()).rejects.toThrow("could not be confirmed");
  global.fetch.mockResolvedValueOnce(response({ user, csrfToken: "csrf-one" }));
  await client.restoreSession();
  global.fetch.mockResolvedValueOnce(response({}));
  await expect(client.api("/auth/login", { method: "POST", body: "{}" })).rejects.toThrow("could not be confirmed");
  expect(client.currentUser()).toEqual(user);
});

test("an HTML unauthorized response still expires the current session", async () => {
  global.fetch.mockResolvedValueOnce(response({ user, csrfToken: "csrf-one" }));
  await client.restoreSession();
  global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => { throw new SyntaxError("HTML response"); } });
  await expect(client.api("/projects/mine")).rejects.toThrow("Session expired");
  expect(client.currentUser()).toBeNull();
});

test("a stale session restore cannot overwrite a switch from another tab", async () => {
  let finishOld;
  global.fetch.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  const old = client.restoreSession();
  client.invalidateCachedSession();
  const switched = { id: "freelancer-2", role: "freelancer" };
  global.fetch.mockResolvedValueOnce(response({ user: switched, csrfToken: "new" }));
  await client.restoreSession();
  finishOld(response({ user, csrfToken: "old" }));
  await old;
  expect(client.currentUser()).toEqual(switched);
});


test("session restoration recovers from a cold proxy without logging the user out", async () => {
  global.fetch.mockResolvedValueOnce(response({},503)).mockResolvedValueOnce(response({status:"ready"})).mockResolvedValueOnce(response({user,csrfToken:"restored"}));
  await expect(client.restoreSession()).resolves.toEqual(user);
  expect(client.currentUser()).toEqual(user);
  expect(global.fetch.mock.calls.filter(([url])=>url.endsWith("/health/ready"))).toHaveLength(1);
});

test("a write waits for active warm-up and is sent only once afterwards", async () => {
  global.fetch.mockResolvedValueOnce(response({user,csrfToken:"csrf-one"}));await client.restoreSession();
  let finish;
  global.fetch.mockImplementation(url=>url.endsWith("/health/ready")?new Promise(resolve=>{finish=resolve;}):Promise.resolve(response({message:"Saved"})));
  const warming=client.warmService(); const write=client.api("/project-drafts",{method:"POST",body:"{}"});
  await Promise.resolve();expect(global.fetch.mock.calls.filter(([url])=>url.endsWith("/project-drafts"))).toHaveLength(0);
  finish(response({status:"ready"}));await warming;await write;
  expect(global.fetch.mock.calls.filter(([url])=>url.endsWith("/project-drafts"))).toHaveLength(1);
});
