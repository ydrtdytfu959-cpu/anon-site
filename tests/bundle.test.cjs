'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('production HTML embeds the canonical adapter and a valid CSP hash', () => {
  const {check, scripts} = require('../scripts/build-catalog.cjs');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'catalog-live.js'), 'utf8');
  assert.deepEqual(check(html, source), []);
  for (const script of scripts(html)) new vm.Script(script, {filename:'index.html inline'});
});

test('build is deterministic; check rejects source and CSP drift', () => {
  const {build, check} = require('../scripts/build-catalog.cjs');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'catalog-live.js'), 'utf8');
  const built = build(html, source);
  assert.equal(build(built, source), built);
  assert.deepEqual(check(built, source), []);
  assert.ok(check(built, source+'\n// drift').includes('Catalog adapter bundle differs from catalog-live.js'));
  assert.ok(check(built.replace(/sha256-[A-Za-z0-9+/=]+/, 'sha256-invalid'), source).includes('Inline script CSP hash is stale'));
});

test('build refuses missing or ambiguous boundaries instead of corrupting HTML', () => {
  const {build} = require('../scripts/build-catalog.cjs');
  assert.throws(() => build('<html></html>', 'x'), /boundary/);
});
