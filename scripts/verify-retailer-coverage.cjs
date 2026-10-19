#!/usr/bin/env node
'use strict';
// Explicit opt-in only: six searches and at most six detail reads, no retries.
// Run after independently checking current AWS monthly AND daily counters.
const fs=require('node:fs'),path=require('node:path');
const adapter=require('../catalog-live.js');
const stores=[['Nike','Nike','nike.com'],['Adidas','adidas','adidas.com'],['Sephora','Sephora','sephora.com'],["Levi's","Levi's",'levi.com'],['TJ Maxx','TJ Maxx','tjmaxx.tjx.com'],['e.l.f. Cosmetics','e.l.f. cosmetics','elfcosmetics.com']];
async function main(){
 if(process.argv[2]!=='--verified-budget-6-searches-6-details')throw Error('Verify runtime budgets/counters, then explicitly authorize this bounded smoke run.');
 const report={checkedAt:new Date().toISOString(),environment:'production',maximumRequests:{search:6,detail:6},requests:{search:0,detail:0},rows:[]};
 for(const [retailer,q,domain] of stores){
  const options={q,limit:24,filters:{website_ids:[domain]}},row={retailer,websiteId:domain};
  try{
   report.requests.search++;
   const r=await fetch(adapter.buildChannel3Url(options),{redirect:'error',signal:AbortSignal.timeout(22000)});
   row.searchStatus=r.status;
   const body=await r.json();
   if(!r.ok){row.error=body.error||'http_'+r.status;report.rows.push(row);continue;}
   row.returnedRecords=body.data?.products?.length??null;
   const page=adapter.parseChannel3Page(body,options);
   row.accepted=page.items.length;row.rejected=page.invalidCount;row.rejectionReasons=page.diagnostics.rejectionReasons;
   row.upstreamDiagnostics=body.data?.diagnostics??null;
   row.hasContinuation=!!page.nextCursor;row.fetchedAt=page.fetchedAt;row.expiresAt=page.expiresAt;
   row.missingImages=page.items.filter(p=>!p.media.length).length;
   row.categories=[...new Set(page.items.map(p=>p.category))];row.sampleProductIds=page.items.slice(0,3).map(p=>p.id);
   if(page.items.length){
    await new Promise(r=>setTimeout(r,300));report.requests.detail++;
    const d=await fetch(adapter.buildChannel3DetailUrl(page.items[0].id),{redirect:'error',signal:AbortSignal.timeout(22000)}),detailBody=await d.json();
    row.detail={httpStatus:d.status};
    if(d.ok){const detail=adapter.parseChannel3Detail(detailBody,page.items[0].id);row.detail={...row.detail,images:detail.images.length,descriptionPresent:!!detail.description,offers:detail.offers.length,optionGroups:detail.variants.options.length,status:detail.freshness.status,freshness:detail.freshness};}
    else row.detail.error=detailBody.error||'http_'+d.status;
   }
  }catch(error){row.error=error.code||error.message;}
  report.rows.push(row);await new Promise(r=>setTimeout(r,300));
 }
 const file=path.join(__dirname,'../docs/evidence/retailer-coverage-2026-10-16.json');
 fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
