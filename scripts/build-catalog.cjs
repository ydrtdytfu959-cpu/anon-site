#!/usr/bin/env node
'use strict';
// The production HTML is the page source. Only the adapter block and CSP hash are generated.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const START = '(function exposeCatalogLive(';
const END = '\n;\n(function(root,factory){const lib=factory();';

function boundaries(html) {
  const start = html.indexOf(START), end = html.indexOf(END, start);
  if (start < 0 || end < start || html.indexOf(START, start + START.length) !== -1 || html.indexOf(END, end + END.length) !== -1) {
    throw new Error('Catalog adapter boundary missing or ambiguous');
  }
  return {start, end};
}

function scripts(html) {
  // HTML parsing normalizes line endings before the browser hashes an inline script.
  return [...html.replace(/\r\n?/g, '\n').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(match => !/\bsrc\s*=/i.test(match[1])).map(match => match[2]);
}

function hash(html) {
  const inline = scripts(html);
  if (inline.length !== 1) throw new Error('Expected exactly one production inline script');
  return 'sha256-' + crypto.createHash('sha256').update(inline[0], 'utf8').digest('base64');
}

function build(html, source) {
  const {start, end} = boundaries(html);
  if (!source.trim().startsWith(START) || /<\/script/i.test(source)) throw new Error('Invalid canonical catalog source');
  const bundled = html.slice(0, start) + source.trim() + '\n' + html.slice(end);
  const csp = bundled.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  if (!csp || !/script-src\s+[^;]*'sha256-[^']+'/.test(csp[1])) throw new Error('Missing script CSP hash');
  const updated = csp[0].replace(/(script-src\s+[^;]*?)'sha256-[^']+'/, '$1\'' + hash(bundled) + "'");
  return bundled.replace(csp[0], updated);
}

function check(html, source) {
  const issues = [], {start, end} = boundaries(html);
  if (html.slice(start, end).trim() !== source.trim()) issues.push('Catalog adapter bundle differs from catalog-live.js');
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  const scriptPolicy = csp?.[1].match(/(?:^|;)\s*script-src\s+([^;]+)/)?.[1] || '';
  if (!scriptPolicy.split(/\s+/).includes("'" + hash(html) + "'")) issues.push('Inline script CSP hash is stale');
  return issues;
}

module.exports = {build, check, scripts};
if (require.main === module) {
  const root = path.resolve(__dirname, '..'), target = path.join(root, 'index.html');
  const html = fs.readFileSync(target, 'utf8'), source = fs.readFileSync(path.join(root, 'catalog-live.js'), 'utf8');
  if (process.argv.includes('--check')) {
    const issues = check(html, source);
    if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
    else console.log('Catalog bundle and inline CSP verified');
  } else {
    const output = build(html, source);
    if (output !== html) fs.writeFileSync(target, output);
    console.log('Catalog bundle and inline CSP generated');
  }
}
