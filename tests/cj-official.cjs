'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {OFFICIAL_SOURCES, normalizeTJMaxxProduct, createOfficialCJSource} = require('../backend/cj-official');
const product = (i='p1',patch={})=>({
  id:i,advertiserId:'4438309',advertiserName:'TJ Maxx',
  title:'T.J. Maxx official handbag',description:'Product from official merchant',
  brand:'T.J. Maxx',link:'https://tjmaxx.tjx.com/store/jump/product/example',
  imageLink:'https://images.example.test/item.jpg',...patch
});
const evidence={store:'tjmaxx',approved:true,evidence:'verified explicit retailer feed authorization ticket'};
const make = (rows, authorization=evidence) => {
  let requests=0;
  const api=createOfficialCJSource({authorization,approvedImageHosts:['images.example.test'],
    search:async args=>{requests++;assert.deepEqual(args.partnerIds,['4438309']);return {totalCount:50,resultList:rows};}});
  return {api,count:()=>requests};
};
test('no source call without confirmed product display rights',async()=>{
  const {api,count}=make([product()],null);
  const response=await api.page({});
  assert.equal(response.statusCode,403);
  assert.equal(response.body.error,'OFFICIAL_FEED_NOT_AUTHORIZED');
  assert.equal(count(),0);
});
test('CJ TJ Maxx read-only official cards require exact advertiser and destination',async()=>{
  const {api}=make([product('real'),product('spoofer',{advertiserId:'1'}),product('marketplace',{link:'https://poshmark.com/listing/item'}),
    product('fake-host',{link:'https://tjmaxx.tjx.com.evil.example/p'}),
    product('fake-image',{imageLink:'https://unreviewed.example/item.jpg'}),
    product('real')]);
  const result=await api.page({offset:0,limit:24});
  assert.equal(result.statusCode,200);
  assert.deepEqual(result.body.products.map(p=>p.id),['cj-tjmaxx-real','cj-tjmaxx-fake-image']);
  assert.equal(result.body.rejectedCount,4);
  assert.equal(result.body.nextOffset,6);
  assert.ok(result.body.products.every(p=>p.priceCents===null&&p.stock===null&&!p.purchasable));
  assert.equal(result.body.products[1].imageUrl,null,'unreviewed images are never embedded');
});
test('merchant host, product id, redirect, and authorizations cannot be forged',()=>{
  for(const change of [
    {link:'http://tjmaxx.tjx.com/item'}, {link:'https://tjmaxx.tjx.com.evil.example/item'},
    {link:'https://user@tjmaxx.tjx.com/item'}, {link:'https://tjmaxx.tjx.com:444/item'},
    {advertiserName:'T.J. Maxx'}, {id:'bad id'}, {advertiserId:'14438309'}
  ]) assert.equal(normalizeTJMaxxProduct(product('safe',change)),null);
  assert.equal(OFFICIAL_SOURCES.tjmaxx.advertiserId,'4438309');
});
test('deny bad paging and missing source; never hit upstream',async()=>{
  const {api,count}=make([product()]);
  for(const args of [{offset:-1},{offset:5001},{limit:0},{limit:25},{store:'adidas'}]){
    const r=await api.page(args);
    assert.ok([400,404].includes(r.statusCode));
  }
  assert.equal(count(),0);
});
test('provider exceptions and malformed payloads fail closed',async()=>{
  const broken=createOfficialCJSource({authorization:evidence,search:async()=>{throw Error('secret error');}});
  assert.deepEqual(await broken.page(),{statusCode:503,body:{error:'CJ_SOURCE_UNAVAILABLE'}});
  const invalid=createOfficialCJSource({authorization:evidence,search:async()=>({totalCount:NaN,resultList:[product()]})});
  assert.deepEqual(await invalid.page(),{statusCode:502,body:{error:'CJ_SOURCE_INVALID'}});
});

test('CJ must not truncate an overlong source ID into a different accepted product identity',()=>{
  assert.equal(normalizeTJMaxxProduct(product('a'.repeat(81))),null);
  assert.equal(normalizeTJMaxxProduct(product(' a')),null);
});

test('CJ reports rejection reasons separately from missing approved imagery',async()=>{
  const {api}=make([product('official'),product('official'),product('wrong-advertiser',{advertiserId:'1'}),
    product('wrong-destination',{link:'https://marketplace.example/item'}),product('no-image',{imageLink:null}),
    product('a'.repeat(81)),null]);
  const result=await api.page();
  assert.equal(result.statusCode,200);
  assert.equal(result.body.rawCount,7);
  assert.equal(result.body.acceptedCount,2);
  assert.equal(result.body.rejectedCount,5);
  assert.deepEqual(result.body.rejectionReasons,{invalid_record:1,merchant_identity:1,invalid_product:1,merchant_destination:1,duplicate_product:1});
  assert.deepEqual(result.body.warnings,{missing_image:1});
});
