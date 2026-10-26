// Internal child only. This file never loads dotenv or accepts a remote database.
async function start() {
  if (!process.send || !/^mongodb:\/\/127\.0\.0\.1:\d+\/fc_benchmark_[a-f0-9]+$/.test(process.env.MONGO_URI || '')) throw Error('Benchmark child requires an owned loopback database');
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await require('../mongoFileStorage').init();
  // Block outbound HTTP integrations even if source changes later enable a provider.
  global.fetch = async () => { throw Error('Outbound requests disabled in local benchmark'); };
  const server = require('../app').listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  let closing = false;
  async function close() { if (closing) return; closing = true; await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); process.exit(0); }
  process.on('message', message => { if (message === 'stop') close().catch(() => process.exit(1)); });
  process.on('disconnect', () => close().catch(() => process.exit(1)));
}
if (require.main === module) start().catch(() => { console.error('Isolated benchmark API failed to start'); process.exit(1); });
