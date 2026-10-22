import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import { api } from "./api";

test("an expired API session clears local credentials and returns to login", async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Not authorized, token failed" }) });
  localStorage.setItem("token", "old-token");
  localStorage.setItem("user", JSON.stringify({ role: "client" }));
  try {
    render(<MemoryRouter initialEntries={["/client-dashboard"]}><Routes>
      <Route path="/client-dashboard" element={<ProtectedRoute allowedRole="client"><button onClick={() => api("/projects/mine").catch(() => {})}>Load projects</button></ProtectedRoute>} />
      <Route path="/login" element={<p>Login screen</p>} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Load projects" }));
    expect(await screen.findByText("Login screen")).toBeInTheDocument();
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  } finally {
    global.fetch = originalFetch;
    localStorage.clear();
  }
});
