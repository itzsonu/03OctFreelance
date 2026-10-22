import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AccountSettings from "./AccountSettings";
import VerifyEmailChange from "./VerifyEmailChange";
import { api, signOut } from "../api";
jest.mock("../api", () => ({ api: jest.fn(), currentUser: () => ({ id: "client-1", role: "client" }), signOut: jest.fn() }));
jest.mock("../components/Shell", () => ({ children }) => <div>{children}</div>);
beforeEach(() => { api.mockReset(); signOut.mockReset(); });

test("password mismatch is local; successful update signs out the current session", async () => {
  api.mockImplementation(path => Promise.resolve(path === "/account" ? { email: "old@example.test", deliveryMode: "email" } : { signedOut: true }));
  render(<MemoryRouter><AccountSettings /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText("Current password"), { target: { value: "current-password" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-123" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "not-matching" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password and sign out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("do not match");
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new-password-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password and sign out" }));
  await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  expect(api).toHaveBeenCalledWith("/account/password", { method: "POST", body: JSON.stringify({ currentPassword: "current-password", password: "new-password-123" }) });
});

test("unconfigured email delivery disables verification and does not pretend to send", async () => {
  api.mockResolvedValue({ email: "old@example.test", deliveryMode: "unavailable" });
  render(<MemoryRouter><AccountSettings /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: "Send verification link" })).toBeDisabled();
  expect(screen.getByText(/verification is not configured/)).toBeInTheDocument();
});

test("visiting a verification link never consumes it without explicit confirmation", async () => {
  api.mockResolvedValue({ signedOut: true });
  const token = "a".repeat(43);
  render(<MemoryRouter initialEntries={[`/account/verify-email?token=${token}`]}><VerifyEmailChange /></MemoryRouter>);
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm email change" }));
  await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  expect(api).toHaveBeenCalledWith("/account/email/confirm", { method: "POST", body: JSON.stringify({ token }) });
  expect(screen.getByRole("heading", { name: "Email updated" })).toBeInTheDocument();
});
