'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('commerce foundation retains the production CSP allowlists and prohibitions', () => {
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)[1];
  assert.equal(policy.replace(/sha256-[A-Za-z0-9+/=]+/g, 'sha256-HASH'), "default-src 'none'; script-src 'self' 'sha256-HASH' https://www.googletagmanager.com; script-src-attr 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob: https://static.nike.com https://cdn.trychannel3.com; font-src 'none'; connect-src https://zmumi2wruk.execute-api.us-east-2.amazonaws.com https://cognito-idp.us-east-2.amazonaws.com https://www.google-analytics.com https://*.google-analytics.com; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
});

// Approved copy updates refresh their production baseline hashes. Authentication is
// now canonical and intentionally extended; test its old access boundaries below
// and its new commerce/session behavior in auth-commerce.cjs instead of freezing
// the entire implementation against an earlier phase's source hash.
for (const [name,start,end,expected] of [
  ['analytics','(function(root,factory){const api=factory(root);','\n;\n(function exposeCatalogLive(','23ddb4edf314c0cc43342c7f9c35aa8884b48ebf8422cea55df12a141ec273ba'],
  ['customer storage and footer','/* Component: customer.js */','function updateCatalogStatus()','060a868e1ef02b21301f4777a86e03762fa982b0bf02cc3effdbfd81a5125d42'],
  ['product detail','/* Component: product.js */','/* Component: routing.js */','3bee3b2478bc13b970de75916beac9be940ca3a882d4393bc1fc8158dede7eea']
]) test(`${name} baseline remains unchanged`, () => {
  const a=html.indexOf(start), b=html.indexOf(end,a);
  assert.ok(a>=0&&b>a);
  assert.equal(crypto.createHash('sha256').update(html.slice(a,b)).digest('hex'),expected);
});

test('legacy account access remains scoped to profile reads, order reads and display-name updates', async () => {
  const {createClient,config}=require('../auth.js'),requests=[];
  const session={idToken:'fixture-id',accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000};
  const auth=createClient({storage:{getItem:()=>JSON.stringify(session),setItem(){},removeItem(){}},fetch:async(url,options)=>{requests.push({url,options});return Response.json({});}});
  await auth.api('/me');await auth.api('/orders');await auth.api('/me',{method:'PUT',body:JSON.stringify({displayName:'Test customer'})});
  assert.deepEqual(requests.map(r=>[r.url,r.options.method]),[[config.apiBase+'/me','GET'],[config.apiBase+'/orders','GET'],[config.apiBase+'/me','PUT']]);
  for(const [target,options] of [['/orders',{method:'POST',body:'{}'}],['/checkout-auth',{method:'POST',body:'{}'}],['/me',{method:'PUT',body:JSON.stringify({displayName:'Test',role:'admin'})}],['https://example.com/me',{}]])await assert.rejects(auth.api(target,options));
  assert.equal(requests.length,3,'forbidden calls must fail before network access');
});
