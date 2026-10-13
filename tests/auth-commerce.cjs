'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createClient,config}=require('../auth.js');
const body={cartRevision:'revision-one',lines:[{provider:'channel3',productId:'prod',merchantDomain:'merchant.example',condition:'new',quantity:1,options:{Size:'M'}}],destination:{country:'DZ'},currency:'USD'};
function client(fetch){const saved=JSON.stringify({idToken:'id-token',accessToken:'access-token',refreshToken:'refresh-token',expiresAt:Date.now()+3600000});return createClient({storage:{getItem:()=>saved,setItem(){},removeItem(){}},fetch});}

test('authenticated quote transport sends only scoped bearer, validated body and idempotency key',async()=>{
  const requests=[],auth=client(async(url,options)=>{requests.push({url,options});return Response.json({quoteId:'q-1'});});
  assert.deepEqual(await auth.api('/commerce/quotes',{method:'POST',body:JSON.stringify(body),idempotencyKey:'quote-key-12345678'}),{quoteId:'q-1'});
  assert.equal(requests[0].url,config.apiBase+'/commerce/quotes');assert.equal(requests[0].options.headers.Authorization,'Bearer id-token');
  assert.equal(requests[0].options.headers['Idempotency-Key'],'quote-key-12345678');assert.deepEqual(JSON.parse(requests[0].options.body),body);
  assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.redirect,'error');
});
test('commerce transport rejects foreign paths, manipulated prices and missing idempotency before network',async()=>{
  let count=0;const auth=client(async()=>{count++;return Response.json({});});
  for(const [path,options] of [
    ['https://evil.example/commerce/quotes',{method:'POST',body:'{}'}],
    ['/commerce/orders/../../me',{}],
    ['/commerce/quotes',{method:'POST',body:JSON.stringify(body)}],
    ['/commerce/quotes',{method:'POST',body:JSON.stringify({...body,price:1}),idempotencyKey:'test-key-123456789'}],
    ['/commerce/quotes',{method:'POST',body:JSON.stringify({...body,lines:[{...body.lines[0],unitPriceMinor:1}]}),idempotencyKey:'test-key-123456789'}]
  ]) await assert.rejects(auth.api(path,options));
  assert.equal(count,0);
});
test('commerce response after logout cannot resurrect protected quote or order data',async()=>{
  let respond,started;const begun=new Promise(resolve=>started=resolve);
  const auth=client(()=>{started();return new Promise(resolve=>respond=resolve);});
  const pending=auth.api('/commerce/orders/order-1');await begun;auth.signOut(false);respond(Response.json({orderId:'order-1'}));
  await assert.rejects(pending,{code:'STALE_SESSION'});assert.equal(auth.state.session,null);
});

test('commerce option validation rejects lone surrogates and C1 controls before transport',async()=>{
 let count=0;const auth=client(async()=>{count++;return Response.json({});});
 for(const options of [{Size:'\ud800'},{Size:'\udfff'},{'\u0085Size':'M'},{Size:'M\u009f'}])await assert.rejects(auth.api('/commerce/quotes',{method:'POST',body:JSON.stringify({...body,lines:[{...body.lines[0],options}]}),idempotencyKey:'test-key-123456789'}),{code:'INVALID_BODY'});
 assert.equal(count,0);
});

test('authenticated commerce transport rejects undeployed read contracts and server quote overlimits before network',async()=>{
 let count=0;const auth=client(async()=>{count++;return Response.json({});});
 for(const path of ['/commerce/quotes/q1','/commerce/checkout-attempts/a1','/checkout','/checkout-auth','/webhook','/payments','/payment'])await assert.rejects(auth.api(path),{code:'INVALID_PATH'});
 for(const path of ['/checkout','/checkout-auth','/webhook','/payments','/payment'])await assert.rejects(auth.api(path,{method:'POST',body:'{}'}),{code:'INVALID_PATH'});
 for(const lines of [Array.from({length:11},(_,i)=>({...body.lines[0],merchantDomain:'merchant'+i+'.example'})),Array.from({length:6},(_,i)=>({...body.lines[0],productId:'prod'+i}))])await assert.rejects(auth.api('/commerce/quotes',{method:'POST',body:JSON.stringify({...body,lines}),idempotencyKey:'test-key-123456789'}),{code:'INVALID_BODY'});
 assert.equal(count,0);
});
