'use strict';
// Offline admission-control profile: no HTTP, AWS SDK, credentials or payment calls.
const { performance } = require('node:perf_hooks');
const { setTimeout: wait } = require('node:timers/promises');
const { createHandler } = require('../backend/commerce/index.js');
const { MemoryStore, FIXED_NOW, requestBody, freshProduct, event, config } = require('../tests/helpers/commerce.cjs');
async function scenario(delayMs, distinct, lineCount) {
  let calls = 0, active = 0, peak = 0;
  const store = new MemoryStore(), body = requestBody(), original = body.lines[0];
  body.lines = Array.from({ length: lineCount }, (_, index) => ({ ...structuredClone(original), productId: 'profile' + (index % distinct), merchantDomain: index >= distinct ? 'adidas.com' : 'nike.com' }));
  const handler = createHandler({ store, config, now: () => FIXED_NOW, logger: { error() {} }, catalog: { freshProduct: async (input, { signal }) => {
    calls++; peak = Math.max(peak, ++active);
    try {
      await wait(delayMs, undefined, { signal });
      const snapshot = freshProduct(input); snapshot.data.product.offers.push({ ...structuredClone(snapshot.data.product.offers[0]), domain: 'adidas.com' }); return snapshot;
    } finally { active--; }
  } } });
  const start = performance.now(), result = await handler(event('POST', '/commerce/quotes', body));
  return { simulatedReadLatencyMs: delayMs, distinctSelections: distinct, lines: lineCount, elapsedMs: Math.round(performance.now() - start), statusCode: result.statusCode, detailCalls: calls, maximumConcurrentReads: peak, persistedRecords: store.records.size, audits: store.audits.length };
}
(async () => {
  const scenarios = [];
  for (const args of [[100, 1, 1], [100, 5, 10], [1000, 5, 10], [4000, 5, 10], [5000, 5, 10], [100, 6, 6]]) scenarios.push(await scenario(...args));
  process.stdout.write(JSON.stringify({ evidenceKind: 'offline_simulation', includes: 'Real quote handler, validation, concurrency scheduler and in-memory transaction adapter', excludes: 'Network, AWS IAM/DynamoDB/Cold-start latency, actual Channel3 billing, production deployment and payment operations', scenarios }, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
