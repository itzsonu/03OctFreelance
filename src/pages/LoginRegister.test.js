import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import LoginRegister from "./LoginRegister";
import { api } from "../api";

jest.mock("../api", () => ({ api: jest.fn() }));
jest.mock("../components/AuthFrame", () => ({ children, title }) => <div><h1>{title}</h1>{children}</div>);

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}</output>;
}

beforeEach(() => {
  api.mockReset();
  localStorage.clear();
});

test("admin-only login has no signup or public role controls", async () => {
  api.mockResolvedValue({ token: "admin-token", user: { id: "admin-1", name: "Case Admin", role: "admin" } });
  render(<MemoryRouter initialEntries={["/admin/login"]}><CurrentPath /><LoginRegister adminOnly /></MemoryRouter>);

  expect(screen.getByRole("heading", { name: "Admin sign in" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sign up" })).not.toBeInTheDocument();
  expect(screen.queryByText("I’m joining as")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "case-admin@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-only-admin-password" } });
  fireEvent.click(screen.getByRole("button", { name: /log in/i }));

  await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/admin/cases"));
  expect(api).toHaveBeenCalledWith("/auth/login", { method: "POST", body: JSON.stringify({ email: "case-admin@example.test", password: "test-only-admin-password", role: "admin" }) });
  expect(JSON.parse(localStorage.getItem("user")).role).toBe("admin");
});
