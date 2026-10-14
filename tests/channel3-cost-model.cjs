'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {estimate}=require('../scripts/channel3-cost-model.cjs');
test('cost model separates shared free credits, paid searches and zero-credit product detail',()=>{
  const result=estimate({mau:1000,pagesPerUser:24,hitPercent:50,detailPagesPerUser:10,quotesPerUser:2,remainingFreeCredits:1000});
  assert.equal(result.searchRequests,24000);assert.equal(result.searchUpstream,12000);assert.equal(result.detailUpstream,14000);
  assert.equal(result.paidSearchCredits,11000);assert.equal(result.channel3Usd,77);assert.equal(result.withoutFreeAllowanceUsd,84);
  assert.equal(result.providerRequests,26000);assert.equal(result.customerApiRequests,36000);
  assert.ok(result.awsCoreSubtotalUsd>0);assert.ok(result.awsAssumptions.exclusions.includes('data transfer'));
});
test('cache misses consume credits per page and small allocations never infer account allowance',()=>{
  const input={mau:100,pagesPerUser:10,hitPercent:85,detailPagesPerUser:4,quotesPerUser:1,remainingFreeCredits:0};
  assert.equal(estimate(input).channel3Usd,1.05);
  assert.equal(estimate({...input,remainingFreeCredits:1000}).channel3Usd,0);
  assert.equal(estimate({...input,hitPercent:0}).searchUpstream,1000);
});
test('model rejects invalid assumptions and flags unsupported provider demand without granting a budget',()=>{
  const input={mau:10000,pagesPerUser:60,hitPercent:10,detailPagesPerUser:30,quotesPerUser:5,remainingFreeCredits:1000};
  const result=estimate(input);assert.equal(result.searchUpstream,540000);assert.equal(result.channel3Usd,3773);
  assert.equal(result.exceedsDocumentedDefaultDailyAverage,true);assert.equal(result.paidOptInRequired,true);assert.equal(result.enablesSpending,false);
  for(const patch of [{mau:-1},{hitPercent:101},{remainingFreeCredits:1001},{mau:Infinity},{pagesPerUser:1.1}])assert.throws(()=>estimate({...input,...patch}));
});
