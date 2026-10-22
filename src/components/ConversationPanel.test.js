import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ConversationPanel from "./ConversationPanel";
import { api } from "../api";

jest.mock("../api", () => ({ api: jest.fn(), currentUser: () => ({ id: "freelancer-1" }), subscribeUpdates: jest.fn(() => () => {}) }));

test("participant can read and send an application message", async () => {
  api.mockImplementation((path, options) => {
    if (path !== "/messages/application/application-1") return Promise.reject(new Error("Unexpected request"));
    if (options?.method === "POST") return Promise.resolve({ id: "message-2", senderId: "freelancer-1", body: "I can start tomorrow.", createdAt: "2026-09-29T10:00:00.000Z" });
    return Promise.resolve([{ id: "message-1", senderId: "client-1", body: "When can you start?", createdAt: "2026-09-29T09:00:00.000Z" }]);
  });
  render(<ConversationPanel applicationId="application-1" projectId="project-1" otherLabel="Client" />);
  expect(await screen.findByText("When can you start?")).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/write a message/i), { target: { value: "I can start tomorrow." } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/messages/application/application-1", { method: "POST", body: JSON.stringify({ body: "I can start tomorrow." }) }));
  expect(await screen.findByText("I can start tomorrow.")).toBeInTheDocument();
});
