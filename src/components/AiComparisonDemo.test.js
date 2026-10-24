import { fireEvent, render, screen } from "@testing-library/react";
import AiComparisonDemo from "./AiComparisonDemo";
import { api } from "../api";
jest.mock("../api",()=>({api:jest.fn()}));
const sample={available:true,providerName:"Google Gemini",project:{title:"Sample tutorial",description:"Write an article",category:"Writing & Translation",requiredSkills:["Writing"]},applicants:[1,2,3].map(n=>({_id:"a"+n,label:"Sample "+n,proposal:"Fictional proposal",freelancer:{profile:{headline:"Writer",bio:"Sample bio",skills:["Writing"],experienceYears:2}},match:{score:60,missingSkills:[]}}))};
beforeEach(()=>api.mockReset());
test("demo opens without a provider call and displays three explicit synthetic score breakdowns",async()=>{
  api.mockImplementation((path,options)=>Promise.resolve(options?.method?{model:"gemini-test",generatedAt:"2026-10-24T00:00:00Z",cached:false,ranking:[1,2,3].map(n=>({applicationId:"a"+n,rank:n,semanticScore:80,ruleScore:60,score:72}))}:sample));
  render(<AiComparisonDemo/>);
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Open sample demo"}));
  await screen.findByText("FICTIONAL SAMPLE DATA");
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"Compare sample profiles with AI"}));
  await screen.findByText("AI rank #1 · 72/100");
  expect(screen.getAllByText("round(80 × 0.6 + 60 × 0.4) = 72")).toHaveLength(3);
  expect(screen.getByRole("button",{name:"Sample comparison complete"})).toBeDisabled();
});
test("quota failure leaves all regular scores visible and never invents an AI rank",async()=>{
  api.mockImplementation((path,options)=>options?.method?Promise.reject(new Error("AI free quota is currently exhausted.")):Promise.resolve(sample));
  render(<AiComparisonDemo/>);fireEvent.click(screen.getByRole("button",{name:"Open sample demo"}));
  fireEvent.click(await screen.findByRole("button",{name:"Compare sample profiles with AI"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("quota");
  expect(screen.getAllByText("Regular fit: 60/100")).toHaveLength(3);
  expect(screen.queryByText(/AI rank #/)).not.toBeInTheDocument();
  expect(api).toHaveBeenCalledTimes(2);
});
