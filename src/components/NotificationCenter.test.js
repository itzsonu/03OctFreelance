import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotificationCenter from "./NotificationCenter";
import { api, subscribeUpdates } from "../api";

jest.mock("../api", () => ({ api: jest.fn(), subscribeUpdates: jest.fn(() => () => {}) }));

test("shows unread activity and marks it read", async () => {
  let read = false;
  api.mockImplementation(path => {
    if (path === "/notifications") return Promise.resolve({ unreadCount: read ? 0 : 1, notifications: [{ _id: "note-1", title: "New project invitation", body: "A client invited you.", link: "/freelancer-dashboard", createdAt: "2026-09-29T10:00:00Z", readAt: read ? "2026-09-29T10:01:00Z" : null }] });
    if (path === "/notifications/note-1/read") { read = true; return Promise.resolve({ id: "note-1" }); }
    return Promise.reject(new Error("Unexpected request"));
  });
  render(<MemoryRouter><NotificationCenter /></MemoryRouter>);
  await screen.findByRole("button", { name: "Notifications, 1 unread" });
  fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
  expect(screen.getByText("New project invitation")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /New project invitation/ }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/notifications/note-1/read", { method: "PATCH" }));
  await screen.findByRole("button", { name: "Notifications" });
  await act(async () => { subscribeUpdates.mock.calls[0][0]({ type: "notifications" }); });
  expect(api.mock.calls.filter(([path]) => path === "/notifications").length).toBeGreaterThan(1);
});
