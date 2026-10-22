import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../App";
import { api } from "../api";

jest.mock("../api", () => ({ api: jest.fn() }));
beforeEach(() => api.mockReset());

test("login links to a recovery request with a generic confirmation", async () => {
  window.history.pushState({}, "", "/login");
  api.mockResolvedValue({ message: "If an account exists for that email, a reset link will arrive shortly." });
  render(<App />);
  fireEvent.click(screen.getByRole("link", { name: /forgot password/i }));
  expect(screen.getByRole("heading", { name: /forgot your password/i })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "client@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/auth/forgot-password", expect.objectContaining({ method: "POST" })));
  expect(await screen.findByRole("status")).toHaveTextContent(/if an account exists/i);
});

test("local demo explains that reset links appear in the backend terminal", async () => {
  window.history.pushState({}, "", "/forgot-password");
  api.mockImplementation(path => Promise.resolve(path === "/auth/recovery-status"
    ? { mode: "local-console" }
    : { message: "If an account exists, its reset link was printed in the local backend terminal. No email was sent." }));
  render(<App />);
  expect(await screen.findByRole("note")).toHaveTextContent(/no email is sent/i);
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "client@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: /print local reset link/i }));
  expect(await screen.findByRole("status")).toHaveTextContent(/no email was sent/i);
});

test("reset form requires matching passwords and sends the link token", async () => {
  window.history.pushState({}, "", "/reset-password?token=example-token");
  api.mockResolvedValue({ message: "Password updated" });
  render(<App />);
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "new-password-123" } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: "different-password" } });
  fireEvent.click(screen.getByRole("button", { name: /update password/i }));
  expect(screen.getByRole("alert")).toHaveTextContent(/do not match/i);
  expect(api).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: "new-password-123" } });
  fireEvent.click(screen.getByRole("button", { name: /update password/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/auth/reset-password", expect.objectContaining({ method: "POST" })));
  expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({ token: "example-token", password: "new-password-123" });
  expect(await screen.findByText(/password updated. log in/i)).toBeInTheDocument();
});
