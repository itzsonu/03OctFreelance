import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminCases from "./AdminCases";
import { api, downloadCaseAttachment } from "../api";

jest.mock("../api", () => ({ api: jest.fn(), downloadCaseAttachment: jest.fn(), currentUser: () => ({ name: "Case Admin" }), signOut: jest.fn() }));
jest.mock("../components/Shell", () => ({ children }) => <main>{children}</main>);

const openCase = {
  _id: "case-1",
  status: "open",
  project: { title: "Project Alpha", client: { name: "Client One" }, freelancer: { name: "Freelancer One" } },
  createdAt: "2026-09-30T10:00:00.000Z",
  historyCount: 1,
};
const detail = {
  ...openCase,
  history: [{ _id: "entry-1", author: { name: "Client One" }, action: "opened", text: "Review the delivery disagreement.", createdAt: "2026-09-30T10:00:00.000Z", attachments: [{ _id: "file-1", filename: "case-evidence.pdf", size: 2048 }] }],
};

beforeEach(() => {
  api.mockReset();
  downloadCaseAttachment.mockReset();
});

test("admin can read only case evidence and resolve with a recorded reason", async () => {
  let resolved = false;
  api.mockImplementation((path, options) => {
    if (path.startsWith("/admin/cases?status=open")) return Promise.resolve(resolved ? [] : [openCase]);
    if (path === "/admin/cases/case-1/resolve" && options?.method === "POST") {
      resolved = true;
      return Promise.resolve({ ...detail, status: "resolved", resolution: { reason: "The evidence supports the documented delivery decision.", resolvedAt: "2026-10-01T12:00:00.000Z", admin: { name: "Case Admin" } }, history: [...detail.history, { _id: "entry-2", author: { name: "Case Admin" }, action: "resolved", text: "The evidence supports the documented delivery decision.", createdAt: "2026-10-01T12:00:00.000Z", attachments: [] }] });
    }
    if (path === "/admin/cases/case-1") return Promise.resolve(detail);
    return Promise.reject(new Error(`Unexpected request ${path}`));
  });
  downloadCaseAttachment.mockResolvedValue(undefined);
  render(<AdminCases />);

  fireEvent.click(await screen.findByRole("button", { name: /Project Alpha/ }));
  expect(await screen.findByText("Review the delivery disagreement.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /case-evidence\.pdf/ }));
  expect(downloadCaseAttachment).toHaveBeenCalledWith("case-1", { id: "file-1", filename: "case-evidence.pdf" });

  fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "The evidence supports the documented delivery decision." } });
  fireEvent.click(screen.getByRole("button", { name: "Resolve case" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/cases/case-1/resolve", { method: "POST", body: JSON.stringify({ reason: "The evidence supports the documented delivery decision." }) }));
  expect(await screen.findByText("resolved", { selector: ".status" })).toBeInTheDocument();
  expect(screen.getAllByText("The evidence supports the documented delivery decision.")).toHaveLength(2);
  expect(screen.queryByLabelText("Decision reason")).not.toBeInTheDocument();
});
