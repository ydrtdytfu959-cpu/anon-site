#!/usr/bin/env node
'use strict';
// Explicit opt-in: at most five unique browsing pages plus cache-hit/validation probes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const catalog = require('../catalog-live.js');
if (!process.argv.includes('--live')) throw Error('Use --live to authorize the bounded metered smoke test');
const report={started:new Date().toISOString(),endpoint:catalog.CHANNEL3_API_BASE,requests:[],checks:[]};
async function request(options, expected=200) {
  const response=await fetch(catalog.buildChannel3Url(options),{redirect:'error',headers:{Origin:'https://anox.app'},signal:AbortSignal.timeout(19000)});
  const body=await response.json();
  report.requests.push({mode:options.q?'search':'discovery',section:options.section||null,cursorProvided:!!options.cursor,status:response.status,products:body.data?.products?.length??0,fetchedAt:body.fetchedAt||null});
  assert.equal(response.status,expected,JSON.stringify({status:response.status,error:body.error}));
  assert.equal(response.headers.get('access-control-allow-origin'),'https://anox.app');
  assert.equal(response.headers.get('cache-control'),'no-store');
  return body;
}
(async()=>{
  const options={section:'featured',limit:24};
  const first=await request(options), repeated=await request(options);
  assert.deepEqual(repeated,first,'identical requests reuse the same fetched response');
  const ids=new Set();let body=first,pages=0,received=0;
  for(;;) {
    const parsed=catalog.parseChannel3Page(body,options);
    assert.ok(parsed.items.length,'live page normalizes into renderable products');
    assert.ok(parsed.items.every(item=>item.media.length<=1));
    for(const item of parsed.items)ids.add(item.id);
    received+=parsed.items.length;pages++;
    if(!parsed.nextCursor||pages===3)break;
    body=await request({...options,cursor:parsed.nextCursor});
  }
  report.checks.push({name:'native cursor browsing',pages,received,unique:ids.size,overlap:received-ids.size});
  const search=await request({q:'running shoes',limit:24});
  const normalized=await request({q:' running  shoes ',limit:24});
  assert.deepEqual(search,normalized,'canonical whitespace shares a cache key');
  const men=await request({section:'men',limit:24});
  assert.ok(catalog.parseChannel3Page(men,{section:'men'}).items.length);
  await request({...options,cursor:'unknown-phase1-cursor'},400);
  report.checks.push({name:'cache replay, normalized query, independent section, unissued cursor, CORS and one-image envelope',pass:true});
  report.completed=new Date().toISOString();
  const output=process.argv.find(arg=>arg.startsWith('--report='))?.slice(9);
  if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
