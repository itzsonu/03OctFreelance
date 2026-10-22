import { render, screen } from "@testing-library/react";
import App from "./App";

test("landing page offers project search and the real milestone workflow", () => {
  window.history.pushState({}, "", "/");
  render(<App />);
  expect(screen.getByRole("textbox", { name: /search open projects/i })).toBeInTheDocument();
  expect(screen.getByText(/submit, review and approve each milestone/i)).toBeInTheDocument();
});

test("freelancer link preselects the freelancer role", () => {
  window.history.pushState({}, "", "/login?role=freelancer");
  render(<App />);
  expect(screen.getByRole("button", { name: /freelancer find & deliver/i })).toHaveClass("chosen");
});

test("expired sessions explain why login is needed", () => {
  window.history.pushState({}, "", "/login?session=expired");
  render(<App />);
  expect(screen.getByRole("alert")).toHaveTextContent("Session expired. Log in again.");
});
