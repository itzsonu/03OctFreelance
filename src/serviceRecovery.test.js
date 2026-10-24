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
  await flush();for(let i=0;i<8;i++){jest.advanceTimersByTime(15000);await flush();}
  expect(await pending).toEqual(expect.objectContaining({message:expect.stringMatching(/longer than expected/)}));
  expect(global.fetch.mock.calls.length).toBeLessThanOrEqual(7);
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
