'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Phase 1 retains the production CSP allowlists and prohibitions', () => {
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)[1];
  assert.equal(policy.replace(/sha256-[A-Za-z0-9+/=]+/g, 'sha256-HASH'), "default-src 'none'; script-src 'self' 'sha256-HASH' https://www.googletagmanager.com; script-src-attr 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob: https://static.nike.com https://cdn.trychannel3.com; font-src 'none'; connect-src https://zmumi2wruk.execute-api.us-east-2.amazonaws.com https://cognito-idp.us-east-2.amazonaws.com https://www.google-analytics.com https://*.google-analytics.com; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
});

// These hashes are from the production baseline 9b81ec5, before Phase 1 changes.
for (const [name,start,end,expected] of [
  ['authentication','(function(root,factory){const lib=factory();','\n;\n(function (root, factory) {','181c6e3d13c52beff0dcd3f5a85a97a99bd1294a4205ed93beb0659796519583'],
  ['analytics','(function(root,factory){const api=factory(root);','\n;\n(function exposeCatalogLive(','23ddb4edf314c0cc43342c7f9c35aa8884b48ebf8422cea55df12a141ec273ba'],
  ['customer storage and footer','/* Component: customer.js */','function updateCatalogStatus()','d9f9ddd576bcdf7e47af839b4f44272287c3be13c8c3e86ab889def46ab917ab'],
  ['product detail','/* Component: product.js */','/* Component: routing.js */','f3dd1bf3ec49a44cdcf961629159045fa3534013455a299c2f9b269c3adbfdba']
]) test(`${name} implementation remains unchanged in this catalog-only phase`, () => {
  const a=html.indexOf(start), b=html.indexOf(end,a);
  assert.ok(a>=0&&b>a);
  assert.equal(crypto.createHash('sha256').update(html.slice(a,b)).digest('hex'),expected);
});
