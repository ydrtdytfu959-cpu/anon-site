const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=()=>fs.readFileSync(require.resolve('../index.html'),'utf8');
function markup(state,session=true,quote={}){
 const source=html(),start=source.indexOf('function serviceRequestMarkup('),end=source.indexOf('function renderSelectionCart(',start);
 assert.ok(start>=0,'service request must be exposed in the shipped storefront');
 const render=new Function('commerceAPI','cloudAccount','tx','esc','routeLink',source.slice(start,end)+';return serviceRequestMarkup;')({state},{session},(_ar,en)=>en,v=>String(v).replaceAll('<','&lt;'),(route,label)=>'<a href="#'+route+'">'+label+'</a>');
 return render({revision:'current'},quote);
}
test('service controls require deployed capability, signed-in account and a reviewed quote',()=>{
 const state={capabilities:{serviceRequests:{create:false}},serviceRequestStatus:'idle'};
 assert.doesNotMatch(markup(state),/data-commerce-service-request/);
 state.capabilities.serviceRequests.create=true;
 assert.match(markup(state),/data-commerce-service-request/);
 assert.match(markup(state,false),/Sign in/);
 assert.match(markup(state,true,null),/data-commerce-service-request disabled/);
 assert.match(markup(state),/does not purchase|does not place/);
 assert.match(markup(state),/owner|decision/);
});
test('saved service request has a tracking link and never offers payment',()=>{
 const state={capabilities:{serviceRequests:{create:true}},serviceRequestStatus:'ready',serviceRequest:{orderId:'request-one',cartRevision:'current'}};
 const result=markup(state);
 assert.match(result,/order\?id=request-one/);assert.match(result,/No payment/);
 assert.doesNotMatch(result,/data-commerce-service-request/);
});
test('a rejected quote instructs the customer to review fresh costs before resubmitting',()=>{
 const state={capabilities:{serviceRequests:{create:true}},serviceRequestStatus:'error',serviceRequestError:'quote_expired'};
 const result=markup(state,true,null);
 assert.match(result,/Request current costs again/);assert.doesNotMatch(result,/Retry the same request/);
 assert.match(result,/data-commerce-service-request disabled/);
 state.serviceRequestRetryable=true;
 const uncertain=markup(state,true,null);
 assert.match(uncertain,/Retry the same request/);assert.doesNotMatch(uncertain,/data-commerce-service-request disabled/);
});
test('quote fee badge leaves the fee trigger pending an owner decision in both languages',()=>{
 const source=html(),start=source.indexOf('function commerceCostMarkup('),end=source.indexOf('function renderOwnedOrders(',start);
 const quote={lines:[],expiresAt:'2026-10-17T12:00:00Z',costs:{components:[{code:'anox_service_fee',label:'AnoX service fee',status:'conditional',amountMinor:500}],estimatedTotalMinor:null,verifiedPayableTotalMinor:null,potentialChargesOnArrival:[]}};
 for(const language of ['en','ar']){
  const render=new Function('tx','esc','formatUSD','dateLabel',source.slice(start,end)+';return commerceCostMarkup;')((ar,en)=>language==='en'?en:ar,String,cents=>'$'+(cents/100).toFixed(2),String);
  const result=render(quote);
  assert.doesNotMatch(result,/On success only|عند النجاح فقط/);
  assert.match(result,language==='en'?/Pending decision/:/بانتظار القرار/);
  assert.match(result,/\$5\.00/);
 }
});

test('language picker has English default and Arabic option, switching back is possible',()=>{
 const source=html(),start=source.indexOf('function languageMenuMarkup(){'),end=source.indexOf('function renderAuthShell(){',start);
 assert.ok(start>0&&end>start);
 const menu=new Function('state','esc','tx',source.slice(start,end)+';return languageMenuMarkup;');
 const english=menu({lang:'en'},String,(_ar,en)=>en)();
 assert.match(english,/<summary[^>]*><span dir="ltr">EN<\/span>/);
 assert.match(english,/data-language="ar" lang="ar" dir="ltr">AR<\/button>/);
 assert.match(english,/<details class="anox-language-menu">/);
 const arabic=menu({lang:'ar'},String,(ar,_en)=>ar)();
 assert.match(arabic,/<span dir="ltr">AR<\/span>/);
 assert.match(arabic,/data-language="en" lang="en" dir="ltr">EN<\/button>/);
 assert.equal((source.match(/\+languageMenuMarkup\(\)\+/g)||[]).length,3);
});
