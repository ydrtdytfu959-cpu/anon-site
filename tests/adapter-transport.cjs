const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function pendingTransport() {
  const timers = [], cleared = [];
  let requestSignal;
  const context = { module: { exports: {} }, URL, URLSearchParams, AbortController, TextDecoder,
    setTimeout(fn, ms) { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimeout(timer) { cleared.push(timer); },
    fetch(_url, { signal }) {
      requestSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../catalog-live.js'), 'utf8'), context);
  return { api: context.module.exports, timers, cleared, signal: () => requestSignal };
}

test('Channel3 allows the backend cache wait then aborts at eighteen seconds without retries', async () => {
  const run = pendingTransport(), request = run.api.fetchChannel3Page({ q: 'shoes' });
  const rejected = assert.rejects(request, error => error.name === 'AbortError');
  run.timers[0].fn();
  await rejected;
  assert.equal(run.timers[0].ms, 18000);
  assert.equal(run.api.channel3Provider.timeoutMs, 18000);
  assert.equal(run.signal().aborted, true);
  assert.equal(run.timers.length, 1);
  assert.equal(run.cleared[0], run.timers[0]);
});

test('Nike keeps its original eight-second transport deadline', async () => {
  const run = pendingTransport(), request = run.api.fetchPage();
  const rejected = assert.rejects(request, error => error.name === 'AbortError');
  run.timers[0].fn();
  await rejected;
  assert.equal(run.timers[0].ms, 8000);
  assert.equal(run.signal().aborted, true);
  assert.equal(run.timers.length, 1);
});

test('parent cancellation aborts an in-flight Channel3 fetch and clears its deadline', async () => {
  const run = pendingTransport(), controller = new AbortController();
  const request = run.api.fetchChannel3Page({ section: 'featured', signal: controller.signal });
  const rejected = assert.rejects(request, error => error.name === 'AbortError');
  controller.abort();
  await rejected;
  assert.equal(run.signal().aborted, true);
  assert.equal(run.timers.length, 1);
  assert.equal(run.cleared[0], run.timers[0]);
});
