import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import WorkroomCasePanel from "./WorkroomCasePanel";
import { api } from "../api";
let mockChange;
jest.mock("../api",()=>({api:jest.fn()}));
jest.mock("../useLiveUpdates",()=>({__esModule:true,default:callback=>{mockChange=callback;return "live";}}));
jest.mock("./AttachmentList",()=>()=>null);
const sample={_id:"case-1",status:"open",createdAt:"2026-10-29T00:00:00Z",history:[{_id:"h1",action:"opened",author:{name:"Demo client"},text:"Synthetic scope question",createdAt:"2026-10-29T00:00:00Z",attachments:[]}]};
beforeEach(()=>api.mockReset());

test("failed case history is retryable and does not imply that no case exists",async()=>{
 api.mockRejectedValueOnce(new Error("Temporary outage")).mockResolvedValue([]);
 render(<WorkroomCasePanel projectId="project-a" projectStatus="In Progress"/>);
 expect(await screen.findByRole("alert")).toHaveTextContent("Temporary outage");
 expect(screen.queryByRole("button",{name:"Open case"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Refresh case history"}));
 expect(await screen.findByRole("button",{name:"Open case"})).toBeInTheDocument();
});

test("an administrator decision refreshes participant history on its project event",async()=>{
 api.mockResolvedValueOnce([sample]).mockResolvedValue([{...sample,status:"resolved",resolution:{reason:"Synthetic decision recorded",admin:{name:"Demo admin"},resolvedAt:"2026-10-29T01:00:00Z"}}]);
 render(<WorkroomCasePanel projectId="project-a" projectStatus="In Progress"/>);
 await screen.findByText("Synthetic scope question");
 act(()=>mockChange({type:"project",projectId:"unrelated"}));expect(api).toHaveBeenCalledTimes(1);
 act(()=>mockChange({type:"project",projectId:"project-a"}));
 expect(await screen.findByText("Synthetic decision recorded")).toBeInTheDocument();
 expect(screen.queryByLabelText("Add information or evidence")).not.toBeInTheDocument();
});

test("a late reply from the previous project cannot replace the current case history",async()=>{
 let old;api.mockImplementation(path=>path.includes("project-a")?new Promise(r=>{old=r;}):Promise.resolve([]));
 const view=render(<WorkroomCasePanel projectId="project-a" projectStatus="In Progress"/>);
 view.rerender(<WorkroomCasePanel projectId="project-b" projectStatus="In Progress"/>);
 await screen.findByRole("button",{name:"Open case"});
 await act(async()=>old([sample]));
 expect(screen.queryByText("Synthetic scope question")).not.toBeInTheDocument();
 expect(screen.getByRole("button",{name:"Open case"})).toBeInTheDocument();
});
