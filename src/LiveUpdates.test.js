import { waitFor } from "@testing-library/react";
import { subscribeUpdates } from "./api";

test("authenticated stream parses project events split across network chunks", async () => {
  const originalFetch = global.fetch;
  const originalDecoder = global.TextDecoder;
  global.TextDecoder = require("util").TextDecoder;
  localStorage.setItem("token", "test-token");
  const encode = text => Uint8Array.from(require("buffer").Buffer.from(text));
  const read = jest.fn()
    .mockResolvedValueOnce({ done: false, value: encode("event: ready\ndata: {}\n\nevent: pro") })
    .mockResolvedValueOnce({ done: false, value: encode('ject\ndata: {"projectId":"project-1"}\n\n') })
    .mockResolvedValueOnce({ done: true });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body: { getReader: () => ({ read }) } });
  const received = [];
  const stop = subscribeUpdates(event => received.push(event));
  try {
    await waitFor(() => expect(received).toContainEqual({ type: "project", projectId: "project-1" }));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/updates$/), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
  } finally {
    stop();
    global.fetch = originalFetch;
    global.TextDecoder = originalDecoder;
    localStorage.clear();
  }
});
