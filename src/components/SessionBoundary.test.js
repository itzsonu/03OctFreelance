import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SessionBoundary from "./SessionBoundary";
import ProtectedRoute from "../ProtectedRoute";
import { currentUser, restoreSession, invalidateCachedSession } from "../api";
import { listenForSessionChanges } from "../sessionChanges";

jest.mock("../api", () => ({ currentUser: jest.fn(), restoreSession: jest.fn(), invalidateCachedSession: jest.fn() }));
jest.mock("../sessionChanges", () => ({ listenForSessionChanges: jest.fn() }));
let identity; let nextIdentity; let changed;
beforeEach(() => {
  identity = { id: "client-1", role: "client" }; nextIdentity = identity;
  currentUser.mockImplementation(() => identity);
  restoreSession.mockImplementation(async () => { identity = nextIdentity; return identity; });
  invalidateCachedSession.mockImplementation(() => { identity = null; });
  listenForSessionChanges.mockImplementation(callback => { changed = callback; return () => {}; });
});
function Workspace() {
  return <MemoryRouter initialEntries={["/client-dashboard"]}><SessionBoundary><Routes>
    <Route path="/client-dashboard" element={<ProtectedRoute allowedRole="client"><label>Private draft<input defaultValue="" /></label></ProtectedRoute>} />
    <Route path="/freelancer-dashboard" element={<ProtectedRoute allowedRole="freelancer"><p>Freelancer workspace</p></ProtectedRoute>} />
    <Route path="/login" element={<p>Sign in</p>} />
  </Routes></SessionBoundary></MemoryRouter>;
}

test("another tab switching roles removes the old workspace and restores the current account", async () => {
  render(<Workspace />);
  await screen.findByLabelText("Private draft");
  nextIdentity = { id: "freelancer-1", role: "freelancer" };
  act(() => changed());
  await screen.findByText("Freelancer workspace");
  expect(screen.queryByLabelText("Private draft")).not.toBeInTheDocument();
});

test("switching to another account with the same role clears the previous private page state", async () => {
  render(<Workspace />);
  fireEvent.change(await screen.findByLabelText("Private draft"), { target: { value: "previous account draft" } });
  nextIdentity = { id: "client-2", role: "client" };
  act(() => changed());
  await waitFor(() => expect(screen.getByLabelText("Private draft")).toHaveValue(""));
  expect(currentUser()).toEqual(nextIdentity);
});
