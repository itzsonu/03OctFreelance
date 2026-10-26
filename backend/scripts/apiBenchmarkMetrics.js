const nearestRank = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
};
const round = n => n === null ? null : Math.round(n * 100) / 100;
function summarize(samples, elapsedMs) {
  const success = samples.filter(s => s.ok);
  const statusCounts = {};
  for (const s of samples) { const key = s.status ? String(s.status) : s.timeout ? 'timeout' : 'transport_error'; statusCounts[key] = (statusCounts[key] || 0) + 1; }
  return { requests: samples.length, successes: success.length, errors: samples.length - success.length,
    errorRatePercent: round(samples.length ? 100 * (samples.length - success.length) / samples.length : 0),
    p50Ms: round(nearestRank(samples.map(s => s.ms), .5)), p95Ms: round(nearestRank(samples.map(s => s.ms), .95)),
    successP50Ms: round(nearestRank(success.map(s => s.ms), .5)), successP95Ms: round(nearestRank(success.map(s => s.ms), .95)),
    elapsedMs: round(elapsedMs), requestsPerSecond: elapsedMs > 0 ? round(samples.length * 1000 / elapsedMs) : 0,
    successfulRequestsPerSecond: elapsedMs > 0 ? round(success.length * 1000 / elapsedMs) : 0,
    timeouts: samples.filter(s => s.timeout).length, invalidBodies: samples.filter(s => s.invalidBody).length, statusCounts };
}
function parseOptions(args) {
  const options = { requests: 40, rounds: 3, warmup: 5, projects: 100, concurrency: [1, 5, 10] };
  const limits = { requests: [20, 200], rounds: [1, 5], warmup: [1, 20], projects: [20, 1000] };
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.replace(/^--/, ''); const value = args[i + 1];
    if (!args[i]?.startsWith('--') || value === undefined) throw Error('Use documented benchmark options only');
    if (name === 'concurrency') {
      if (!/^\d+(,\d+)*$/.test(value)) throw Error('Invalid concurrency');
      options.concurrency = [...new Set(value.split(',').map(Number))];
      if (options.concurrency.some(n => n < 1 || n > 20) || options.concurrency.length > 4) throw Error('Concurrency must be 1–20 with at most four levels');
    } else if (name in limits) {
      const n = Number(value), [min, max] = limits[name];
      if (!/^\d+$/.test(value) || !Number.isInteger(n) || n < min || n > max) throw Error('Invalid bounded option: ' + name);
      options[name] = n;
    } else throw Error('Unsupported option: ' + name + '. Remote targets are not supported.');
  }
  if (options.requests < Math.max(...options.concurrency)) throw Error('Requests must cover the largest concurrency');
  if (options.requests * options.rounds * options.concurrency.length * 4 > 10000) throw Error('Benchmark exceeds the 10000 measured request budget');
  return options;
}
module.exports = { nearestRank, summarize, parseOptions };
