'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('./fixtures/cinematic/catalog.cjs');
const {parseChannel3Page}=require('../catalog-live.js');

test('cinematic search fixtures satisfy real merchant and freshness validation for all six retailers',()=>{
 const stores=[['Nike','nike.com'],['adidas','adidas.com'],['Sephora','sephora.com'],["Levi's",'levi.com'],['TJ Maxx','tjmaxx.tjx.com'],['e.l.f. cosmetics','elfcosmetics.com']];
 let now=Date.now();
 for(const [q,domain] of stores){
  const payload=fixture.searchPage(q,now++),options={q,limit:24,filters:{website_ids:[domain]}};
  assert.equal(Date.parse(payload.expiresAt)-Date.parse(payload.fetchedAt),300000);
  const parsed=parseChannel3Page(payload,options);
  assert.equal(parsed.items.length,4,q+' fixture products accepted');
  assert.equal(parsed.invalidCount,0,q+' fixture products not rejected');
  // The application must continue rejecting the exact malformed fixture that
  // caused the intermittent WebKit CI timeout; never relax its trust boundary.
  const overlong={...payload,expiresAt:new Date(Date.parse(payload.expiresAt)+1).toISOString()};
  assert.throws(()=>parseChannel3Page(overlong,options),{code:'catalog_payload'});
 }
});
