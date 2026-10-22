import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import { api } from "./api";

test("an expired API session clears local credentials and returns to login", async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockImplementation(url => Promise.resolve(url.endsWith("/auth/session") ? { ok: true, status: 200, json: async () => ({ user: { id: "client-1", role: "client" }, csrfToken: "csrf-test" }) } : { ok: false, status: 401, json: async () => ({ message: "Session expired" }) }));
  localStorage.setItem("token", "old-token");
  localStorage.setItem("user", JSON.stringify({ role: "client" }));
  try {
    render(<MemoryRouter initialEntries={["/client-dashboard"]}><Routes>
      <Route path="/client-dashboard" element={<ProtectedRoute allowedRole="client"><button onClick={() => api("/projects/mine").catch(() => {})}>Load projects</button></ProtectedRoute>} />
      <Route path="/login" element={<p>Login screen</p>} />
    </Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Load projects" }));
    expect(await screen.findByText("Login screen")).toBeInTheDocument();
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  } finally {
    global.fetch = originalFetch;
    localStorage.clear();
  }
});
