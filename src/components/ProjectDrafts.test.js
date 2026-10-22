import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProjectDrafts from "./ProjectDrafts";
import { api } from "../api";
jest.mock("../api", () => ({ api: jest.fn() }));

test("opens the latest full draft and requires a separate delete confirmation", async () => {
  const draft = { _id: "draft-1", form: { title: "Brand guide" }, updatedAt: "2026-10-22T00:00:00Z", __v: 3, state: "draft" };
  const continued = jest.fn();
  api.mockImplementation((path, options) => Promise.resolve(path === "/project-drafts" ? { drafts: [draft] } : options?.method === "DELETE" ? {} : { draft }));
  render(<ProjectDrafts onContinue={continued} />);
  fireEvent.click(await screen.findByRole("button", { name: "Continue draft" }));
  await waitFor(() => expect(continued).toHaveBeenCalledWith(draft));
  fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
  expect(api.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/project-drafts/draft-1", { method: "DELETE", body: JSON.stringify({ version: 3 }) }));
});
