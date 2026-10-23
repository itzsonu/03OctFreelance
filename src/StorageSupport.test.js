import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Support from "./pages/Support";
import AccountData from "./components/AccountData";
import AdminStorage from "./pages/AdminStorage";
import AdminSupport from "./pages/AdminSupport";
import ServicePolicies from "./pages/ServicePolicies";
import { api, restoreSession } from "./api";
jest.mock("./api", () => ({ api: jest.fn(), restoreSession: jest.fn() }));
jest.mock("./components/Shell", () => ({ children }) => <main>{children}</main>);
beforeEach(() => { api.mockReset(); restoreSession.mockReset(); restoreSession.mockResolvedValue(null); });
const request = { _id: "request-1", subject: "Account help", message: "Please help me access my account.", kind: "support", status: "open", createdAt: "2026-10-22T00:00:00Z", history: [], version: 2 };
const wrap = element => render(<MemoryRouter>{element}</MemoryRouter>);

test("guest support saves a private tracking code and reads an administrator reply", async () => {
  const trackingCode = "x".repeat(43);
  api.mockImplementation(path => Promise.resolve(path === "/support/status" ? { request: { ...request, history: [{ status: "reviewing", response: "We are reviewing the sign-in error.", createdAt: request.createdAt }] } } : { request, trackingCode, message: "Request saved. No email has been sent." }));
  wrap(<Support />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Submit request" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Contact email"), { target: { value: "person@example.test" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: request.subject } });
  fireEvent.change(screen.getByLabelText("How can we help?"), { target: { value: request.message } });
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  expect(await screen.findByText(trackingCode)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check guest request" }));
  expect(await screen.findByText("We are reviewing the sign-in error.")).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/support/status", { method: "POST", body: JSON.stringify({ trackingCode }) });
});

test("password errors allow retry; deletion review shows status and can be cancelled", async () => {
  let attempt = 0;
  api.mockImplementation((path, options) => {
    if (path === "/account/storage") return Promise.resolve({ usedBytes: 1024, maxBytes: 1048576, usedFiles: 1, maxFiles: 1000, maxFileBytes: 10485760, filesPerRequest: 3 });
    if (!options) return Promise.resolve({ request: null });
    if (path.endsWith("/cancel")) return Promise.resolve({ request: { ...request, status: "cancelled" }, message: "Deletion request cancelled." });
    attempt++; return attempt === 1 ? Promise.reject(new Error("Current password is incorrect")) : Promise.resolve({ request: { ...request, kind: "deletion" }, message: "Deletion review requested. Your account has not been deleted." });
  });
  wrap(<AccountData />);
  const button = await screen.findByRole("button", { name: "Request deletion review" });
  fireEvent.change(screen.getByLabelText("Current password to request deletion"), { target: { value: "incorrect" } });
  fireEvent.click(screen.getByLabelText(/I understand this requests a review/)); fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("incorrect"); expect(button).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Current password to request deletion"), { target: { value: "correct-password" } }); fireEvent.click(button);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel deletion request" }));
  expect(await screen.findByRole("status")).toHaveTextContent("cancelled");
});

test("storage cleanup requires a preview and explicit acknowledgement", async () => {
  api.mockImplementation(path => Promise.resolve(path === "/admin/storage" ? { maxBytes: 524288000, maxFiles: 1000, maxFileBytes: 10485760, filesPerRequest: 3, recordedBytes: 4096, recordedFiles: 1, history: [] } : path.endsWith("/preview") ? { token: "private-preview", candidates: 2, bytes: 500, batchLimit: 500, message: "Recorded evidence is preserved.", expiresAt: "2035-01-01T00:00:00Z" } : { message: "Cleanup finished.", removedFiles: 2, releasedReservations: 0, skipped: 0 }));
  wrap(<AdminStorage />);
  expect(screen.queryByRole("button", { name: "Remove previewed abandoned uploads" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Preview abandoned uploads" }));
  const apply = await screen.findByRole("button", { name: "Remove previewed abandoned uploads" }); expect(apply).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Remove the abandoned uploads in this preview/)); fireEvent.click(apply);
  expect(await screen.findByRole("status")).toHaveTextContent("Removed 2 files");
  expect(api).toHaveBeenCalledWith("/admin/storage/cleanup", { method: "POST", body: JSON.stringify({ token: "private-preview" }) });
});

test("administrator review sends the loaded version and a reasoned response", async () => {
  api.mockImplementation((path, options) => Promise.resolve(path.includes("?") ? { items: [{ ...request, email: "person@example.test" }], total: 1, pages: 1 } : options ? { request: { ...request, status: "closed", version: 3 }, message: "Response saved." } : { request }));
  wrap(<AdminSupport />);
  fireEvent.click(await screen.findByRole("button", { name: /Account help/ }));
  fireEvent.change(await screen.findByLabelText("New status"), { target: { value: "closed" } });
  fireEvent.change(screen.getByLabelText("Reply to requester"), { target: { value: "The account issue was reviewed and resolved." } });
  fireEvent.click(screen.getByRole("button", { name: "Save reply & status" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Response saved");
  expect(api).toHaveBeenCalledWith("/admin/support/request-1", { method: "POST", body: JSON.stringify({ version: 2, status: "closed", response: "The account issue was reviewed and resolved." }) });
});

test("privacy information accurately explains the manual deletion review", () => {
  wrap(<ServicePolicies privacy />);
  expect(screen.getByText(/Submitting or closing a review does not automatically erase your account/)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Support" }).length).toBeGreaterThan(0);
});

test.each([["project-suggestions", "Project suggestions feedback"], ["profile-setup", "Profile setup feedback"], ["untrusted-topic", ""]])("feedback topic %s fills only a subject and sends nothing automatically", async (topic, subject) => {
  render(<MemoryRouter initialEntries={[`/support?topic=${topic}`]}><Support /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Submit request" })).toBeEnabled());
  expect(screen.getByLabelText("Subject")).toHaveValue(subject);
  expect(screen.getByLabelText("How can we help?")).toHaveValue("");
  expect(api).not.toHaveBeenCalled();
});
