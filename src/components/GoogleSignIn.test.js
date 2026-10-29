import React from "react";
import {render,screen,waitFor,act,fireEvent} from "@testing-library/react";
import GoogleSignIn from "./GoogleSignIn";
import {api} from "../api";
jest.mock("../api",()=>({api:jest.fn()}));
afterEach(()=>{delete window.google;jest.clearAllMocks();});
test("unconfigured Google leaves password login alone",async()=>{api.mockResolvedValue({available:false});const {container}=render(<GoogleSignIn role="client" mode="login"/>);await waitFor(()=>expect(container).toBeEmptyDOMElement());});
test("verified callback submits once, role changes discard stale callbacks",async()=>{
 const initialize=jest.fn(),renderButton=jest.fn();window.google={accounts:{id:{initialize,renderButton}}};
 let complete;api.mockImplementation(path=>path.endsWith("status")?Promise.resolve({available:true}):path.endsWith("challenge")?Promise.resolve({nonce:"test-nonce",clientId:"public-client"}):new Promise(r=>{complete=r;}));
 const success=jest.fn(),error=jest.fn(),busy=jest.fn();const props={role:"client",mode:"login",onSuccess:success,onError:error,onBusy:busy};
 const view=render(<GoogleSignIn {...props}/>);await waitFor(()=>expect(initialize).toHaveBeenCalledTimes(1));const first=initialize.mock.calls[0][0];expect(first.nonce).toBe("test-nonce");
 view.rerender(<GoogleSignIn {...props} role="freelancer"/>);await waitFor(()=>expect(initialize).toHaveBeenCalledTimes(2));await act(async()=>{await first.callback({credential:"stale-token"});});expect(api.mock.calls.filter(c=>c[0]==="/auth/google")).toHaveLength(0);
 const current=initialize.mock.calls[1][0];let pending;act(()=>{pending=current.callback({credential:"test-google-token"});});await act(async()=>{await current.callback({credential:"test-google-token"});});expect(api.mock.calls.filter(c=>c[0]==="/auth/google")).toHaveLength(1);expect(JSON.parse(api.mock.calls.at(-1)[1].body).role).toBe("freelancer");
 await act(async()=>{complete({user:{role:"freelancer"}});await pending;});expect(success).toHaveBeenCalledTimes(1);expect(error).not.toHaveBeenCalled();expect(busy.mock.calls).toEqual([[true],[false]]);
});

test("the role-bound challenge starts while the Google script is still loading",async()=>{
 api.mockImplementation(path=>Promise.resolve(path.endsWith("status")?{available:true}:{nonce:"test-nonce",clientId:"public-client"}));
 const error=jest.fn();render(<GoogleSignIn role="client" mode="login" onError={error}/>);
 await waitFor(()=>expect(api).toHaveBeenCalledWith("/auth/google/challenge",expect.any(Object)));
 const script=document.querySelector('script[src="https://accounts.google.com/gsi/client"]');expect(script).not.toBeNull();
 const initialize=jest.fn(),renderButton=jest.fn();window.google={accounts:{id:{initialize,renderButton}}};
 await act(async()=>{script.dispatchEvent(new Event("load"));});
 await waitFor(()=>expect(renderButton).toHaveBeenCalledTimes(1));expect(initialize.mock.calls[0][0].nonce).toBe("test-nonce");expect(error).not.toHaveBeenCalled();script.remove();
});

test("failed configuration has an explicit retry without blocking email login",async()=>{
 const initialize=jest.fn();window.google={accounts:{id:{initialize,renderButton:jest.fn()}}};
 api.mockRejectedValueOnce(new Error("Temporary connection failure")).mockResolvedValueOnce({available:true}).mockResolvedValue({nonce:"retry-nonce",clientId:"public-client"});
 render(<GoogleSignIn role="client" mode="login"/>);
 expect(screen.getByRole("status")).toHaveTextContent(/Preparing Google/);
 fireEvent.click(await screen.findByRole("button",{name:"Try Google again"}));
 await waitFor(()=>expect(initialize).toHaveBeenCalledTimes(1));expect(initialize.mock.calls[0][0].nonce).toBe("retry-nonce");
});
