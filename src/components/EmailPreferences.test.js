import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import EmailPreferences from "./EmailPreferences";
import { api } from "../api";
jest.mock("../api", () => ({ api: jest.fn() }));
beforeEach(() => api.mockReset());

test("saves selected alerts while honestly showing delivery is not active", async () => {
  const preferences = { proposals: false, offers: false, submissions: false, revisions: false };
  api.mockImplementation((path, options) => Promise.resolve(options?.method === "PUT" ? { preferences: { ...preferences, offers: true }, message: "Email preferences saved." } : { preferences, enabled: false, deliveryMode: "unavailable" }));
  render(<EmailPreferences />);
  const offers = await screen.findByRole("checkbox", { name: /Offers and agreements/ });
  expect(offers).not.toBeChecked();
  expect(screen.getByText(/Email delivery is not active/)).toBeInTheDocument();
  fireEvent.click(offers);
  fireEvent.click(screen.getByRole("button", { name: "Save email preferences" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Email preferences saved");
  expect(api).toHaveBeenCalledWith("/account/notification-preferences", { method: "PUT", body: JSON.stringify({ preferences: { ...preferences, offers: true } }) });
});

test("a failed preference update preserves the choice without claiming it was saved", async () => {
  api.mockImplementation((path, options) => options ? Promise.reject(new Error("Unable to save")) : Promise.resolve({ preferences: { proposals: false, offers: false, submissions: false, revisions: false }, enabled: true, deliveryMode: "local-console" }));
  render(<EmailPreferences />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /Revision requests/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save email preferences" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save");
  expect(screen.getByRole("checkbox", { name: /Revision requests/ })).toBeChecked();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText(/No email is sent/)).toBeInTheDocument();
});
