'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('canonical client replacement rejects missing/duplicate markers and HTML script escape', () => {
  const {replaceModule} = require('../scripts/build-clients.cjs');
  const spec = {name:'fixture',start:'START(',end:'END'};
  assert.equal(replaceModule('prefixSTART(old)\nENDtail','START(new)',spec),'prefixSTART(new)\nENDtail');
  assert.throws(()=>replaceModule('START(old)ENDSTART(second)','START(new)',spec),/ambiguous/);
  assert.throws(()=>replaceModule('no marker','START(new)',spec),/missing/);
  assert.throws(()=>replaceModule('START(old)END','START(new)</script>',spec),/Invalid/);
  assert.throws(()=>replaceModule('START(old)END','OTHER(new)',spec),/Invalid/);
});

test('full client bundle is deterministic, canonical and protected by the actual inline CSP', () => {
  const {build,check,readSources} = require('../scripts/build-clients.cjs');
  const {scripts} = require('../scripts/build-catalog.cjs');
  const sources = readSources(root),html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  const built = build(html,sources);
  assert.equal(build(built,sources),built);
  assert.deepEqual(check(built,sources),[]);
  assert.deepEqual(check(html,sources),[],'committed HTML must match all canonical modules');
  assert.ok(check(built,{...sources,auth:sources.auth+'\n// drift'}).some(x=>x.includes('auth.js')));
  assert.ok(check(built,{...sources,commerce:sources.commerce+'\n// drift'}).some(x=>x.includes('commerce-client.js')));
  assert.ok(check(built,{...sources,icons:sources.icons+'\n// drift'}).some(x=>x.includes('icons.js')));
  assert.ok(check(built,{...sources,iconStyles:sources.iconStyles+'\n/* drift */'}).some(x=>x.includes('icons.css')));
  for (const script of scripts(built)) new vm.Script(script,{filename:'generated index.html'});
});
