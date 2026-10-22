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
