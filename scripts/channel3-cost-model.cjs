#!/usr/bin/env node
'use strict';
// Offline planning only. This does not read a provider balance, configure a
// budget, contact a service, or predict a payable invoice.
const AWS_ASSUMPTIONS=Object.freeze({
  currency:'USD',region:'us-east-2 planning assumptions; reprice before approval',days:30,memoryGb:0.25,
  lambdaPerMillionRequests:0.20,lambdaPerGbSecond:0.0000166667,httpApiPerMillionRequests:1,
  dynamoPerMillionReadUnits:0.125,dynamoPerMillionWriteUnits:0.625,
  logsPerGb:0.50,logBytesPerInvocation:5120,customMetrics:15,metricPerMonth:0.30,alarms:5,alarmPerMonth:0.10,
  allocatedSecretPerMonth:0.40,secretPer10000Reads:0.05,secretReadsPerUpstream:1,
  pageKb:64,detailKb:64,cacheHitSeconds:0.1,upstreamSeconds:2,quoteSeconds:4,
  searchWriteUnits:144,detailWriteUnits:270,quoteWriteUnits:64,
  exclusions:['data transfer','DynamoDB storage/PITR/restore','log retention/query','SNS delivery','Cognito','S3 artifacts','other applications','taxes','discounts/free tiers'],
  warning:'No AWS free tiers deducted; examples are assumptions, not a regional price-list quotation. Secret reads pessimistically count one per upstream dispatch; actual runtime caches for five minutes.'
});
function estimate({mau,pagesPerUser,hitPercent,detailPagesPerUser,quotesPerUser,remainingFreeCredits}){
  for(const [key,value] of Object.entries({mau,pagesPerUser,hitPercent,detailPagesPerUser,quotesPerUser,remainingFreeCredits})){
    if(!Number.isSafeInteger(value)||value<0||value>1000000||(key==='hitPercent'&&value>100)||(key==='remainingFreeCredits'&&value>1000))throw Error('INVALID_COST_ASSUMPTION');
  }
  const a=AWS_ASSUMPTIONS,searchRequests=mau*pagesPerUser,searchUpstream=Math.ceil(searchRequests*(100-hitPercent)/100),quotes=mau*quotesPerUser;
  // A quote deliberately revalidates two selected product/option snapshots in
  // this model. These are product-detail reads, not paid /lookup requests.
  const publicDetails=mau*detailPagesPerUser,detailUpstream=publicDetails+2*quotes,providerRequests=searchUpstream+detailUpstream;
  const customerApiRequests=searchRequests+publicDetails+quotes,lambdaInvocations=customerApiRequests+2*quotes;
  const paidSearchCredits=Math.max(0,searchUpstream-remainingFreeCredits);
  const computeGbSeconds=((searchRequests-searchUpstream)*a.cacheHitSeconds+providerRequests*a.upstreamSeconds+quotes*a.quoteSeconds)*a.memoryGb;
  const dynamoReadUnits=(searchRequests+searchUpstream)*Math.ceil(a.pageKb/4)+detailUpstream*Math.ceil(a.detailKb/4)+quotes*8;
  const dynamoWriteUnits=searchUpstream*a.searchWriteUnits+detailUpstream*a.detailWriteUnits+quotes*a.quoteWriteUnits;
  const usd=value=>Math.round((value+Number.EPSILON)*100)/100;
  const awsComponents={httpApi:customerApiRequests*a.httpApiPerMillionRequests/1e6,
    lambdaRequests:lambdaInvocations*a.lambdaPerMillionRequests/1e6,lambdaCompute:computeGbSeconds*a.lambdaPerGbSecond,
    dynamoReads:dynamoReadUnits*a.dynamoPerMillionReadUnits/1e6,dynamoWrites:dynamoWriteUnits*a.dynamoPerMillionWriteUnits/1e6,
    logs:lambdaInvocations*a.logBytesPerInvocation/1e9*a.logsPerGb,
    metricsAndAlarms:a.customMetrics*a.metricPerMonth+a.alarms*a.alarmPerMonth,
    secrets:a.allocatedSecretPerMonth+providerRequests*a.secretReadsPerUpstream/10000*a.secretPer10000Reads};
  return {mau,searchRequests,searchUpstream,searchCacheHitPercent:hitPercent,detailUpstream,providerRequests,customerApiRequests,lambdaInvocations,
    paidSearchCredits,remainingFreeCredits,channel3Usd:paidSearchCredits*7/1000,withoutFreeAllowanceUsd:searchUpstream*7/1000,
    averageProviderRequestsPerDay:Math.ceil(providerRequests/a.days),exceedsDocumentedDefaultDailyAverage:providerRequests>a.days*10000,
    exceedsStagedDetailMonthlyMaximum:detailUpstream>310000,paidOptInRequired:paidSearchCredits>0,enablesSpending:false,
    modeledApiResponseGb:(searchRequests*a.pageKb+publicDetails*a.detailKb)*1024/1e9,
    computeGbSeconds,dynamoReadUnits,dynamoWriteUnits,awsComponentsUsd:Object.fromEntries(Object.entries(awsComponents).map(([k,v])=>[k,usd(v)])),
    awsCoreSubtotalUsd:usd(Object.values(awsComponents).reduce((sum,v)=>sum+v,0)),awsAssumptions:a};
}
function scenarios(){
  const profiles=[{name:'best',pagesPerUser:10,hitPercent:85,detailPagesPerUser:4,quotesPerUser:1},
    {name:'base',pagesPerUser:24,hitPercent:50,detailPagesPerUser:10,quotesPerUser:2},
    {name:'stress',pagesPerUser:60,hitPercent:10,detailPagesPerUser:30,quotesPerUser:5}];
  return {schema:'anox.cost-scenarios/1',evidenceDate:'2026-10-13',type:'offline demand model, not invoice or approved allocation',
    rows:[100,1000,10000].flatMap(mau=>profiles.map(profile=>({scenario:profile.name,assumptions:{...profile,mau,remainingFreeCredits:1000},...estimate({...profile,mau,remainingFreeCredits:1000})})))};
}
if(require.main===module)process.stdout.write(JSON.stringify(scenarios(),null,2)+'\n');
module.exports={estimate,scenarios};
