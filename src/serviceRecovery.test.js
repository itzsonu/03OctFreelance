const originalFetch = global.fetch;
let service;
const response = (status, data = {}) => ({ status, ok: status < 400, json: async () => data });
const flush = async () => { for (let i=0;i<16;i++) await Promise.resolve(); };
beforeEach(() => { jest.isolateModules(() => { service=require('./serviceRecovery'); }); global.fetch=jest.fn(); });
afterEach(() => { global.fetch=originalFetch; jest.useRealTimers(); });

test('concurrent failed reads share one wake-up and continue without manual refresh', async () => {
  let finishHealth; const counts={}; const states=[];
  global.fetch.mockImplementation(async url => {
    if(url==='/ready') return new Promise(resolve=>{finishHealth=resolve;});
    counts[url]=(counts[url]||0)+1; return response(counts[url]===1?503:200,{saved:true});
  });
  const stop=service.watchServiceConnection(state=>states.push(state));
  const first=service.fetchWithRecovery('/one',{},'/ready');const second=service.fetchWithRecovery('/two',{},'/ready');
  await flush(); expect(global.fetch.mock.calls.filter(([url])=>url==='/ready')).toHaveLength(1);
  finishHealth(response(200,{status:'ready'})); expect((await Promise.all([first,second])).every(item=>item.ok)).toBe(true);
  expect(states).toEqual(['idle','connecting','idle']); stop();
});

test('submitted writes and authorization failures are never retried', async()=>{
  global.fetch.mockResolvedValueOnce(response(503));
  expect((await service.fetchWithRecovery('/save',{method:'POST',body:'original'},'/ready')).status).toBe(503);
  global.fetch.mockResolvedValueOnce(response(401));
  expect((await service.fetchWithRecovery('/private',{},'/ready')).status).toBe(401);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('persistent outage has a finite wait and does not keep polling forever', async()=>{
  jest.useFakeTimers();global.fetch.mockResolvedValue(response(503));
  const pending=service.fetchWithRecovery('/one',{},'/ready').catch(error=>error);
  await flush();for(let i=0;i<42;i++){jest.advanceTimersByTime(3000);await flush();}
  expect(await pending).toEqual(expect.objectContaining({message:expect.stringMatching(/longer than expected/)}));
  expect(global.fetch.mock.calls.length).toBeLessThanOrEqual(41);
});

test('a changed account prevents replaying the old read after wake-up',async()=>{
  global.fetch.mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200,{status:'ready'}));
  await expect(service.fetchWithRecovery('/old-user',{},'/ready',()=>false)).rejects.toThrow('account changed');
  expect(global.fetch.mock.calls.filter(([url])=>url==='/old-user')).toHaveLength(1);
});

test('an explicitly aborted request does not start service recovery',async()=>{
  const controller=new AbortController();controller.abort();
  global.fetch.mockRejectedValue(new Error('cancelled'));
  await expect(service.fetchWithRecovery('/one',{signal:controller.signal},'/ready')).rejects.toThrow('cancelled');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('recent healthy wake is reused briefly and expires without bypassing health validation', async()=>{
  jest.useFakeTimers();global.fetch.mockResolvedValue(response(200,{status:'ready'}));
  await service.ensureServiceReady('/ready');await service.ensureServiceReady('/ready');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(15001);await service.ensureServiceReady('/ready');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('a real read failure invalidates recent readiness and checks again before retry', async()=>{
  global.fetch.mockResolvedValueOnce(response(200,{status:'ready'}));await service.ensureServiceReady('/ready');
  global.fetch.mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200,{status:'ready'})).mockResolvedValueOnce(response(200,{ok:true}));
  expect((await service.fetchWithRecovery('/projects',{},'/ready')).ok).toBe(true);
  expect(global.fetch.mock.calls.map(([url])=>url)).toEqual(['/ready','/projects','/ready','/projects']);
});

test('readiness reuse is scoped to the checked health URL',async()=>{
  global.fetch.mockResolvedValue(response(200,{status:'ready'}));
  await service.ensureServiceReady('/ready');await service.ensureServiceReady('/other-ready');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});


test('recovery keeps checking through a longer cold start and replays only the read',async()=>{
  jest.useFakeTimers();const started=Date.now();let reads=0;
  global.fetch.mockImplementation(async url=>{if(url==='/ready')return response(Date.now()-started>=80000?200:503,{status:'ready'});reads++;return response(reads===1?502:200);});
  const pending=service.fetchWithRecovery('/projects',{},'/ready');await flush();
  for(let i=0;i<28;i++){jest.advanceTimersByTime(3000);await flush();}
  expect((await pending).ok).toBe(true);expect(reads).toBe(2);
});

test('a stalled readiness body times out and a later valid probe recovers',async()=>{
  jest.useFakeTimers();let checks=0;
  global.fetch.mockImplementation(async()=>{checks++;return checks===1?{status:200,ok:true,json:()=>new Promise(()=>{})}:response(200,{status:'ready'});});
  const pending=service.ensureServiceReady('/ready');await flush();
  jest.advanceTimersByTime(12000);await flush();jest.advanceTimersByTime(3000);await flush();
  await pending;expect(checks).toBe(2);
});

test('manual reconnect can succeed after bounded recovery failed',async()=>{
  global.fetch.mockResolvedValueOnce(response(403));await expect(service.ensureServiceReady('/ready')).rejects.toThrow('longer than expected');
  global.fetch.mockResolvedValueOnce(response(200,{status:'ready'}));await service.ensureServiceReady('/ready');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('failed read after a healthy probe clears cached readiness for reconnect',async()=>{
  global.fetch.mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200,{status:'ready'})).mockResolvedValueOnce(response(503));
  await expect(service.fetchWithRecovery('/projects',{},'/ready')).rejects.toThrow('longer than expected');
  global.fetch.mockResolvedValueOnce(response(200,{status:'ready'}));await service.ensureServiceReady('/ready');
  expect(global.fetch.mock.calls.filter(([url])=>url==='/ready')).toHaveLength(2);
});
