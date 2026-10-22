import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProjectForm from "./ProjectForm";
import { api } from "../api";

jest.mock("../api", () => ({ api: jest.fn() }));
beforeEach(() => api.mockReset());

test("saves an incomplete brief without publishing and restores its custom field and milestones", async () => {
  const saved = jest.fn();
  api.mockImplementation(path => Promise.resolve(path === "/project-drafts" ? { draft: { _id: "draft-1", __v: 0, state: "draft" } } : {}));
  const { unmount } = render(<ProjectForm onClose={() => {}} onCreated={() => {}} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Other" } });
  fireEvent.change(screen.getByPlaceholderText(/Architecture/), { target: { value: "Marine education" } });
  fireEvent.change(screen.getByPlaceholderText(/initial concepts/i), { target: { value: "Research notes" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft and close" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const form = JSON.parse(api.mock.calls.find(([path]) => path === "/project-drafts")[1].body).form;
  expect(form.description).toBe("");
  expect(api.mock.calls.some(([path]) => path === "/projects/create")).toBe(false);
  unmount();
  render(<ProjectForm initialDraft={{ _id: "draft-1", __v: 0, state: "draft", form }} onClose={() => {}} onCreated={() => {}} />);
  expect(screen.getByDisplayValue("Marine education")).toBeInTheDocument();
  expect(screen.getByDisplayValue("Research notes")).toBeInTheDocument();
});

test("failed draft saving keeps entered work visible and does not close the dialog", async () => {
  const saved = jest.fn();
  api.mockImplementation(path => path === "/project-drafts" ? Promise.reject(new Error("Connection lost")) : Promise.resolve({}));
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} onSaved={saved} />);
  fireEvent.change(screen.getByPlaceholderText(/brand identity refresh/i), { target: { value: "Keep this work" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft and close" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByDisplayValue("Keep this work")).toBeInTheDocument();
  expect(saved).not.toHaveBeenCalled();
});

test("project dialog keeps keyboard focus and returns it after closing", () => {
  api.mockResolvedValue({});
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  const onClose = jest.fn();
  const { unmount } = render(<ProjectForm onClose={onClose} onCreated={() => {}} />);
  expect(screen.getByRole("dialog")).toHaveFocus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});

test("publishes the brief, required skills and milestone plan", async () => {
  api.mockResolvedValue({});
  const onCreated = jest.fn();
  render(<ProjectForm onClose={() => {}} onCreated={onCreated} />);
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Design & Creative" } });
  fireEvent.change(screen.getByPlaceholderText(/brand identity refresh/i), { target: { value: "Brand identity refresh" } });
  fireEvent.change(screen.getByPlaceholderText(/goals, deliverables/i), { target: { value: "Create a complete visual identity and deliver editable design files." } });
  fireEvent.change(screen.getByPlaceholderText(/React, UI design/i), { target: { value: "Figma, Branding" } });
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Design & Creative" } });
  fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: "10000" } });
  fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: "2026-12-01" } });
  fireEvent.change(screen.getByPlaceholderText(/initial concepts/i), { target: { value: "First concepts" } });
  fireEvent.click(screen.getByRole("button", { name: /publish project/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/projects/create", expect.objectContaining({ method: "POST" })));
  const body = JSON.parse(api.mock.calls.find(([path]) => path === "/projects/create")[1].body);
  expect(body.category).toBe("Design & Creative");
  expect(body.requiredSkills).toEqual(["Figma", "Branding"]);
  expect(body.description).toMatch(/complete visual identity/);
  expect(body.milestones[0].title).toBe("First concepts");
  expect(onCreated).toHaveBeenCalled();
});

test("sends selected prerequisite indexes for a later milestone", async () => {
  api.mockResolvedValue({});
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Design & Creative" } });
  fireEvent.change(screen.getByPlaceholderText(/brand identity refresh/i), { target: { value: "Brand identity refresh" } });
  fireEvent.change(screen.getByPlaceholderText(/goals, deliverables/i), { target: { value: "Create a complete visual identity and deliver editable design files." } });
  fireEvent.change(screen.getByPlaceholderText(/React, UI design/i), { target: { value: "Branding" } });
  fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: "10000" } });
  fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: "2026-12-01" } });
  fireEvent.change(screen.getByPlaceholderText(/initial concepts/i), { target: { value: "Concepts" } });
  fireEvent.click(screen.getByRole("button", { name: /add step/i }));
  fireEvent.change(screen.getAllByPlaceholderText(/initial concepts/i)[1], { target: { value: "Delivery" } });
  fireEvent.click(screen.getByRole("button", { name: /publish project/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/projects/create", expect.objectContaining({ method: "POST" })));
  const body = JSON.parse(api.mock.calls[api.mock.calls.length - 1][1].body);
  expect(body.milestones[1].dependsOn).toEqual([0]);
});

test("previews a guided plan and applies it only after the client chooses it", async () => {
  const suggestions = [
    { title: "Scope", description: "Agree on requirements", payment: 2500, dependsOn: [] },
    { title: "Build", description: "Implement the work", payment: 5000, dependsOn: [0] },
    { title: "Handoff", description: "Deliver final files", payment: 2500, dependsOn: [1] },
  ];
  api.mockImplementation(path => Promise.resolve(path === "/projects/suggest-milestones" ? { method: "guided_template", explanation: "Review each step before publishing.", suggestions } : {}));
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Design & Creative" } });
  fireEvent.change(screen.getByPlaceholderText(/brand identity refresh/i), { target: { value: "Brand identity refresh" } });
  fireEvent.change(screen.getByPlaceholderText(/goals, deliverables/i), { target: { value: "Create a complete visual identity and deliver editable design files." } });
  fireEvent.change(screen.getByPlaceholderText(/React, UI design/i), { target: { value: "Figma, Branding" } });
  fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: "10000" } });
  fireEvent.click(screen.getByRole("button", { name: /suggest a plan/i }));
  await screen.findByRole("region", { name: /suggested milestone plan/i });
  expect(screen.getAllByPlaceholderText(/initial concepts/i)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /use this draft/i }));
  expect(screen.getAllByPlaceholderText(/initial concepts/i)).toHaveLength(3);
  expect(screen.getByDisplayValue("Build")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: "2026-12-01" } });
  fireEvent.click(screen.getByRole("button", { name: /publish project/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/projects/create", expect.objectContaining({ method: "POST" })));
  const body = JSON.parse(api.mock.calls[api.mock.calls.length - 1][1].body);
  expect(body.milestones).toEqual(suggestions.map(step => ({ ...step, dueDate: "" })));
});

test("AI planning sends the brief only after an explicit click and leaves the result editable", async () => {
  api.mockReset();
  const suggestions = [
    { title: "Scope", description: "Agree on deliverables", payment: 3000, dependsOn: [] },
    { title: "Delivery", description: "Build and test", payment: 7000, dependsOn: [0] },
  ];
  api.mockImplementation(path => Promise.resolve(path === "/projects/ai-planning-status" ? { available: true } : path === "/projects/ai-suggest-milestones" ? { method: "ai_assisted", explanation: "Review all steps.", suggestions } : {}));
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  await screen.findByText(/sends your project title/i);
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Design & Creative" } });
  fireEvent.change(screen.getByPlaceholderText(/brand identity refresh/i), { target: { value: "Brand identity refresh" } });
  fireEvent.change(screen.getByPlaceholderText(/goals, deliverables/i), { target: { value: "Create a complete visual identity and deliver editable design files." } });
  fireEvent.change(screen.getByPlaceholderText(/React, UI design/i), { target: { value: "Figma, Branding" } });
  fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: "10000" } });
  fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: "2030-12-01" } });
  expect(api.mock.calls.some(([path]) => path === "/projects/ai-suggest-milestones")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: /draft with ai/i }));
  await screen.findByText("AI-assisted draft");
  expect(screen.getAllByPlaceholderText(/initial concepts/i)).toHaveLength(1);
  expect(api).toHaveBeenCalledWith("/projects/ai-suggest-milestones", expect.objectContaining({ method: "POST" }));
  fireEvent.click(screen.getByRole("button", { name: /use this draft/i }));
  fireEvent.change(screen.getByDisplayValue("Delivery"), { target: { value: "Final delivery" } });
  fireEvent.click(screen.getByRole("button", { name: /publish project/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/projects/create", expect.objectContaining({ method: "POST" })));
  const body = JSON.parse(api.mock.calls.find(([path]) => path === "/projects/create")[1].body);
  expect(body.milestones[1].title).toBe("Final delivery");
});

const fillPlanBrief = () => {
  fireEvent.change(screen.getByPlaceholderText(/brand identity refresh/i), { target: { value: "Technical guide" } });
  fireEvent.change(screen.getByPlaceholderText(/goals, deliverables/i), { target: { value: "Write a clear guide explaining React and Node APIs for new developers." } });
  fireEvent.change(screen.getByPlaceholderText(/React, UI design/i), { target: { value: "React, Writing" } });
  fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: "10000" } });
};
const samplePlan = { method: "guided_template", explanation: "Writing draft", suggestions: [{ title: "Outline", description: "Review outline", payment: 10000, dependsOn: [] }] };

test("a suggested plan with paise amounts remains valid and can be published", async () => {
  const suggestions = [
    { title: "Scope", description: "Confirm work", payment: 1500.15, dependsOn: [] },
    { title: "Build", description: "Deliver work", payment: 8500.85, dependsOn: [0] },
  ];
  api.mockImplementation(path => Promise.resolve(path === "/projects/suggest-milestones" ? { ...samplePlan, suggestions } : {}));
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fillPlanBrief();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Web Development" } });
  fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: "10001" } });
  fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: "2030-12-31" } });
  fireEvent.click(screen.getByRole("button", { name: /suggest a plan/i }));
  await screen.findByRole("region", { name: /suggested milestone plan/i });
  fireEvent.click(screen.getByRole("button", { name: /use this draft/i }));
  for (const input of screen.getAllByLabelText(/Planned amount/)) expect(input).toBeValid();
  fireEvent.click(screen.getByRole("button", { name: /publish project/i }));
  await waitFor(() => expect(api.mock.calls.some(([path]) => path === "/projects/create")).toBe(true));
  expect(JSON.parse(api.mock.calls.find(([path]) => path === "/projects/create")[1].body).milestones).toEqual(suggestions.map(step => ({ ...step, dueDate: "" })));
});

test("category selection and a valid Other field are required before suggestions", async () => {
  api.mockResolvedValue({});
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fillPlanBrief();
  expect(screen.getByRole("button", { name: /suggest a plan/i })).toBeDisabled();
  expect(screen.queryByLabelText(/^Project field/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Other" } });
  expect(screen.getByRole("button", { name: /suggest a plan/i })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/^Project field/), { target: { value: "Legal research" } });
  expect(screen.getByRole("button", { name: /suggest a plan/i })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Writing & Translation" } });
  expect(screen.queryByLabelText(/^Project field/)).not.toBeInTheDocument();
  await act(async () => {});
});

test("guided requests include category and cannot reuse a preview after changing it", async () => {
  api.mockImplementation(path => Promise.resolve(path === "/projects/suggest-milestones" ? samplePlan : {}));
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fillPlanBrief();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Writing & Translation" } });
  fireEvent.click(screen.getByRole("button", { name: /suggest a plan/i }));
  await screen.findByRole("region", { name: /suggested milestone plan/i });
  const body = JSON.parse(api.mock.calls.find(([path]) => path === "/projects/suggest-milestones")[1].body);
  expect(body.category).toBe("Writing & Translation");
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Web Development" } });
  expect(screen.queryByRole("region", { name: /suggested milestone plan/i })).not.toBeInTheDocument();
});

test("Other field is included in planning and publishing, and edits invalidate its preview", async () => {
  api.mockImplementation(path => Promise.resolve(path === "/projects/suggest-milestones" ? samplePlan : {}));
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fillPlanBrief();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Other" } });
  fireEvent.change(screen.getByLabelText(/^Project field/), { target: { value: " Technical writing " } });
  fireEvent.click(screen.getByRole("button", { name: /suggest a plan/i }));
  await screen.findByRole("region", { name: /suggested milestone plan/i });
  expect(JSON.parse(api.mock.calls.find(([path]) => path === "/projects/suggest-milestones")[1].body).customCategory).toBe("Technical writing");
  fireEvent.change(screen.getByLabelText(/^Project field/), { target: { value: "Legal research" } });
  expect(screen.queryByRole("region", { name: /suggested milestone plan/i })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: "2030-12-31" } });
  fireEvent.change(screen.getByPlaceholderText(/initial concepts/i), { target: { value: "Research findings" } });
  fireEvent.click(screen.getByRole("button", { name: /publish project/i }));
  await waitFor(() => expect(api.mock.calls.some(([path]) => path === "/projects/create")).toBe(true));
  const body = JSON.parse(api.mock.calls.find(([path]) => path === "/projects/create")[1].body);
  expect(body.category).toBe("Other");
  expect(body.customCategory).toBe("Legal research");
});

test("changing category while planning discards a late response", async () => {
  let finish;
  api.mockImplementation(path => path === "/projects/suggest-milestones" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}));
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fillPlanBrief();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Writing & Translation" } });
  fireEvent.click(screen.getByRole("button", { name: /suggest a plan/i }));
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Marketing" } });
  await act(async () => { finish(samplePlan); });
  expect(screen.queryByRole("region", { name: /suggested milestone plan/i })).not.toBeInTheDocument();
});

test("unsaved project survives close, Escape and outside click until explicit discard", async () => {
  api.mockResolvedValue({});
  const onClose = jest.fn();
  const { container } = render(<ProjectForm onClose={onClose} onCreated={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/brand identity refresh/i), { target: { value: "Keep this draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByText("Discard this project draft?")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByDisplayValue("Keep this draft")).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("button", { name: "Discard draft" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.mouseDown(container.querySelector(".modal-overlay"));
  expect(onClose).not.toHaveBeenCalled();
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => {});
});

test("project target dates are validated and included when publishing", async () => {
  api.mockResolvedValue({});
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fillPlanBrief();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Web Development" } });
  fireEvent.change(screen.getByPlaceholderText(/initial concepts/i), { target: { value: "Scope" } });
  fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: "2000-01-01" } });
  fireEvent.submit(screen.getByRole("button", { name: /publish project/i }).closest("form"));
  expect(screen.getByRole("alert")).toHaveTextContent(/deadline of today or later/);
  fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: "2030-12-31" } });
  fireEvent.change(screen.getByLabelText(/Target date/), { target: { value: "2031-01-01" } });
  fireEvent.submit(screen.getByRole("button", { name: /publish project/i }).closest("form"));
  expect(screen.getByRole("alert")).toHaveTextContent(/between today and the project deadline/);
  fireEvent.change(screen.getByLabelText(/Target date/), { target: { value: "2030-12-20" } });
  fireEvent.click(screen.getByRole("button", { name: /publish project/i }));
  await waitFor(() => expect(api.mock.calls.some(([path]) => path === "/projects/create")).toBe(true));
  expect(JSON.parse(api.mock.calls.find(([path]) => path === "/projects/create")[1].body).milestones[0].dueDate).toBe("2030-12-20");
});

test("referenced milestone cannot be removed before dependencies are adjusted", async () => {
  api.mockResolvedValue({});
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /add step/i }));
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
  expect(screen.getByRole("alert")).toHaveTextContent(/Steps 2 depend on it/);
  expect(screen.getAllByPlaceholderText(/initial concepts/i)).toHaveLength(2);
  fireEvent.click(screen.getByLabelText("Step 1"));
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
  expect(screen.getAllByPlaceholderText(/initial concepts/i)).toHaveLength(1);
  await act(async () => {});
});

const skillResult = { method: "catalogue_extraction_v1", explanation: "Review named skills from the brief.", suggestions: [
  { skill: "React", aliases: ["react", "reactjs"], matchedTerm: "React", evidence: "Build a React dashboard" },
  { skill: "Node.js", aliases: ["node.js", "nodejs"], matchedTerm: "Node.js", evidence: "Node.js API" },
] };

test("skill extraction is explicit and adds only chosen skills while preserving manual edits", async () => {
  api.mockImplementation(path => Promise.resolve(path === "/projects/suggest-skills" ? skillResult : {}));
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fillPlanBrief();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Web Development" } });
  fireEvent.change(screen.getByPlaceholderText(/React, UI design/i), { target: { value: "ReactJS, Custom skill" } });
  expect(api.mock.calls.some(([path]) => path === "/projects/suggest-skills")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Suggest skills from brief" }));
  await screen.findByRole("region", { name: "Suggested skills" });
  expect(screen.getByRole("button", { name: "Added React" })).toBeDisabled();
  expect(screen.getByPlaceholderText(/React, UI design/i)).toHaveValue("ReactJS, Custom skill");
  fireEvent.click(screen.getByRole("button", { name: "Add Node.js" }));
  expect(screen.getByPlaceholderText(/React, UI design/i)).toHaveValue("ReactJS, Custom skill, Node.js");
  fireEvent.change(screen.getByPlaceholderText(/React, UI design/i), { target: { value: "Writing" } });
  expect(screen.getByRole("button", { name: "Add React" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Writing & Translation" } });
  expect(screen.queryByRole("region", { name: "Suggested skills" })).not.toBeInTheDocument();
});

test("late skill suggestions cannot be reused after a brief edit", async () => {
  let finish;
  api.mockImplementation(path => path === "/projects/suggest-skills" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}));
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fillPlanBrief();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Web Development" } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest skills from brief" }));
  fireEvent.change(screen.getByPlaceholderText(/goals, deliverables/i), { target: { value: "Write a clear article describing the project requirements for the readers." } });
  await act(async () => { finish(skillResult); });
  expect(screen.queryByRole("region", { name: "Suggested skills" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Suggest skills from brief" })).toBeEnabled();
});

test("skill suggestions respect the ten-skill limit and provide a manual path when no skills match", async () => {
  api.mockImplementation(path => Promise.resolve(path === "/projects/suggest-skills" ? skillResult : {}));
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fillPlanBrief();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Other" } });
  fireEvent.change(screen.getByLabelText(/^Project field/), { target: { value: "Marine research" } });
  fireEvent.change(screen.getByPlaceholderText(/React, UI design/i), { target: { value: Array.from({ length: 10 }, (_, i) => `Custom ${i}`).join(", ") } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest skills from brief" }));
  expect(await screen.findByRole("button", { name: "Add React" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add Node.js" })).toBeDisabled();
  api.mockImplementation(path => Promise.resolve(path === "/projects/suggest-skills" ? { ...skillResult, suggestions: [] } : {}));
  fireEvent.click(screen.getByRole("button", { name: "Suggest skills from brief" }));
  expect(await screen.findByText(/No known skills found/)).toBeInTheDocument();
  expect(JSON.parse(api.mock.calls.find(([path]) => path === "/projects/suggest-skills")[1].body).customCategory).toBe("Marine research");
});

test("AI outage preserves milestones and offers an explicitly labelled guided fallback", async () => {
  api.mockImplementation(path => path === "/projects/ai-suggest-milestones" ? Promise.reject(new Error("AI service unavailable")) : Promise.resolve(path === "/projects/ai-planning-status" ? { available: true } : path === "/projects/suggest-milestones" ? samplePlan : {}));
  render(<ProjectForm onClose={() => {}} onCreated={() => {}} />);
  fillPlanBrief();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Writing & Translation" } });
  fireEvent.change(screen.getByPlaceholderText(/initial concepts/i), { target: { value: "Keep my milestone" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Draft with AI" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Draft with AI" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use guided fallback" }));
  expect(await screen.findByText("Guided draft")).toBeInTheDocument();
  expect(screen.getByDisplayValue("Keep my milestone")).toBeInTheDocument();
  expect(screen.queryByText("AI-assisted draft")).not.toBeInTheDocument();
  expect(api.mock.calls.filter(([path]) => path === "/projects/ai-suggest-milestones")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /use this draft/i }));
  expect(screen.getByDisplayValue("Outline")).toBeInTheDocument();
});
