import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ConversationPanel from "./ConversationPanel";
import { api, subscribeUpdates } from "../api";

jest.mock("../api", () => ({ api: jest.fn(), currentUser: () => ({ id: "freelancer-1" }), subscribeUpdates: jest.fn(() => () => {}) }));

test("participant can read and send an application message", async () => {
  api.mockImplementation((path, options) => {
    if (path.split("?")[0] !== "/messages/application/application-1") return Promise.reject(new Error("Unexpected request"));
    if (options?.method === "POST") return Promise.resolve({ id: "message-2", senderId: "freelancer-1", body: "I can start tomorrow.", createdAt: "2026-09-29T10:00:00.000Z" });
    return Promise.resolve([{ id: "message-1", senderId: "client-1", body: "When can you start?", createdAt: "2026-09-29T09:00:00.000Z" }]);
  });
  render(<ConversationPanel applicationId="application-1" projectId="project-1" otherLabel="Client" />);
  expect(await screen.findByText("When can you start?")).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/write a message/i), { target: { value: "I can start tomorrow." } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/messages/application/application-1", { method: "POST", body: JSON.stringify({ body: "I can start tomorrow." }) }));
  expect(await screen.findByText("I can start tomorrow.")).toBeInTheDocument();
});

test("older history survives live catch-up and duplicate message delivery", async () => {
  api.mockReset(); subscribeUpdates.mockClear();
  const message = (id, body) => ({ id, body, senderId: 'client-1', createdAt: '2030-01-01T00:00:00Z' });
  api.mockImplementation(path => Promise.resolve(path.includes('before=') ? { messages: [message('1','Old history'),message('2','Latest original')],hasOlder:false,beforeCursor:'oldest' } : path.includes('after=c3') ? { messages:[message('3','Newest original'),message('4','New live message')],hasMore:true,afterCursor:'c4' } : path.includes('after=c4') ? { messages:[message('5','Caught up message')],hasMore:false,afterCursor:'c5' } : { messages:[message('2','Latest original'),message('3','Newest original')],hasOlder:true,beforeCursor:'c2',afterCursor:'c3' }));
  render(<ConversationPanel applicationId="application-1" projectId="project-1" otherLabel="Client" />);
  fireEvent.click(await screen.findByRole('button',{name:'Load older messages'}));
  expect(await screen.findByText('Old history')).toBeInTheDocument();
  await act(async()=>{subscribeUpdates.mock.calls[0][0]({type:'messages',projectId:'project-1'});});
  expect(await screen.findByText('Caught up message')).toBeInTheDocument();
  expect(screen.getByText('Old history')).toBeInTheDocument();
  expect(screen.getAllByText('Newest original')).toHaveLength(1);
});

test("a late response from a previous conversation cannot replace the current one", async () => {
  api.mockReset(); let finish;
  api.mockImplementation(path => path.includes('/old?') ? new Promise(resolve=>{finish=resolve;}) : Promise.resolve({messages:[{id:'new',body:'Current conversation',createdAt:'2030-01-01T00:00:00Z'}],hasOlder:false}));
  const {rerender}=render(<ConversationPanel applicationId="old" projectId="project-1" otherLabel="Client" />);
  rerender(<ConversationPanel applicationId="new" projectId="project-2" otherLabel="Other client" />);
  expect(await screen.findByText('Current conversation')).toBeInTheDocument();
  await act(async()=>{finish({messages:[{id:'old',body:'Wrong conversation',createdAt:'2030-01-01T00:00:00Z'}]});});
  expect(screen.queryByText('Wrong conversation')).not.toBeInTheDocument();
});
