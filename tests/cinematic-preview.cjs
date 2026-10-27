'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {worker,previewHtml}=require('../scripts/serve-cinematic.cjs');
test('direct preview entry never starts the application without its isolation worker',()=>{
 const script=require('../scripts/build-catalog.cjs').scripts(previewHtml())[0];
 for(const navigator of [{},{serviceWorker:{controller:null}},{serviceWorker:{controller:{scriptURL:'http://127.0.0.1:8787/unrelated.js'}}}]){
  const redirects=[];
  vm.runInNewContext(script,{navigator,URL,location:{origin:'http://127.0.0.1:8787',replace:url=>redirects.push(url)}});
  assert.deepEqual(redirects,['/preview/start.html'],'an uncontrolled document must go to the safe launcher before any app initialization');
 }
});
test('offline preview preserves the production file and rehashes only its in-memory review copy',()=>{
 const file=path.join(__dirname,'../index.html'),before=fs.readFileSync(file,'utf8'),preview=previewHtml();
 assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.ok(preview.includes('OFFLINE DESIGN PREVIEW · SYNTHETIC DATA · NO LIVE SERVICES'));
 const scripts=require('../scripts/build-catalog.cjs').scripts(preview);assert.equal(scripts.length,1);new vm.Script(scripts[0]);
 const hash=require('node:crypto').createHash('sha256').update(scripts[0]).digest('base64');assert.ok(preview.includes("'sha256-"+hash+"'"));
 assert.ok(preview.includes('Offline preview: external links are disabled.'));
});
test('offline worker fails closed for external services and server mutations',async()=>{
 const handlers={},calls=[];
 vm.runInNewContext(worker,{self:{addEventListener:(type,fn)=>{handlers[type]=fn;}},location:{origin:'http://127.0.0.1:8787'},URL,Response,fetch:async target=>{calls.push(target);return new Response('local fixture');}});
 async function request(url,method='GET'){let result;handlers.fetch({request:{url,method},respondWith:value=>{result=Promise.resolve(value);}});assert.ok(result,'every request must be handled');return result;}
 for(const [url,method] of [['https://cognito-idp.us-east-2.amazonaws.com/','POST'],['https://zmumi2wruk.execute-api.us-east-2.amazonaws.com/commerce/requests','POST'],['https://unrecognized.example/','GET'],['http://127.0.0.1:8787/backend/index.js','GET']])assert.equal((await request(url,method)).status,403);
 assert.deepEqual(calls,[],'blocked requests never reach a network delegate');
 assert.equal((await request('https://cdn.trychannel3.com/cinematic-fixture/jacket.svg')).status,200);
 assert.equal((await request('https://zmumi2wruk.execute-api.us-east-2.amazonaws.com/catalog/search?q=Nike')).status,200);
 assert.deepEqual(calls,['/fixture/art/jacket','/fixture/api/catalog/search?q=Nike']);
});
