import { ACTIVE_SERVICE_CHECK_MS, startServiceActivity } from "./serviceActivity";
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
let page, browser;
beforeEach(() => {
  jest.useFakeTimers();
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  browser = Object.assign(new EventTarget(), { navigator: { onLine: true }, setInterval, clearInterval });
});
afterEach(() => jest.useRealTimers());
test("visible pages wake automatically, keep checking and clean up on unmount", async () => {
  const warm=jest.fn().mockResolvedValue();const stop=startServiceActivity(warm,{page,browser});
  expect(warm).toHaveBeenCalledTimes(1);await flush();
  jest.advanceTimersByTime(ACTIVE_SERVICE_CHECK_MS);expect(warm).toHaveBeenCalledTimes(2);await flush();
  stop();jest.advanceTimersByTime(ACTIVE_SERVICE_CHECK_MS);browser.dispatchEvent(new Event("online"));
  expect(warm).toHaveBeenCalledTimes(2);
});
test("hidden and offline pages send no checks; returning online/visible resumes", async () => {
  page.visibilityState="hidden";const warm=jest.fn().mockResolvedValue();const stop=startServiceActivity(warm,{page,browser});
  jest.advanceTimersByTime(ACTIVE_SERVICE_CHECK_MS*2);expect(warm).not.toHaveBeenCalled();
  page.visibilityState="visible";browser.navigator.onLine=false;page.dispatchEvent(new Event("visibilitychange"));expect(warm).not.toHaveBeenCalled();
  browser.navigator.onLine=true;browser.dispatchEvent(new Event("online"));expect(warm).toHaveBeenCalledTimes(1);await flush();
  page.visibilityState="hidden";jest.advanceTimersByTime(ACTIVE_SERVICE_CHECK_MS);expect(warm).toHaveBeenCalledTimes(1);stop();
});
test("an ongoing wake is shared and a later check recovers after failure", async () => {
  let reject;const warm=jest.fn().mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;})).mockResolvedValue();const stop=startServiceActivity(warm,{page,browser});
  jest.advanceTimersByTime(ACTIVE_SERVICE_CHECK_MS);browser.dispatchEvent(new Event("online"));expect(warm).toHaveBeenCalledTimes(1);
  reject(new Error("temporary outage"));await flush();jest.advanceTimersByTime(ACTIVE_SERVICE_CHECK_MS);expect(warm).toHaveBeenCalledTimes(2);stop();
});
