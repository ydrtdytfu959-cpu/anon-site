'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createClient,config}=require('../auth.js');
const body={cartRevision:'revision-one',lines:[{provider:'channel3',productId:'prod',merchantDomain:'merchant.example',condition:'new',quantity:1,options:{Size:'M'}}],destination:{country:'DZ'},currency:'USD'};
function client(fetch){const saved=JSON.stringify({idToken:'id-token',accessToken:'access-token',refreshToken:'refresh-token',expiresAt:Date.now()+3600000});return createClient({storage:{getItem:()=>saved,setItem(){},removeItem(){}},fetch});}

test('service request uses authenticated idempotent transport with no financial fields',async()=>{
 const requests=[],auth=client(async(url,options)=>{requests.push({url,options});return Response.json({schemaVersion:1});});
 const input={quoteId:'quote-one',cartRevision:'revision-one',cartHash:'a'.repeat(64)},options={method:'POST',body:JSON.stringify(input),idempotencyKey:'service-key-12345678'};
 await auth.api('/commerce/service-requests',options);
 assert.equal(requests.length,1);assert.equal(requests[0].options.headers.Authorization,'Bearer id-token');
 assert.equal(requests[0].options.headers['Idempotency-Key'],options.idempotencyKey);
 for(const patch of [{amount:500},{paid:true},{cartHash:'bad'}])await assert.rejects(auth.api('/commerce/service-requests',{...options,body:JSON.stringify({...input,...patch})}),{code:'INVALID_BODY'});
 await assert.rejects(auth.api('/commerce/service-requests',{...options,idempotencyKey:undefined}));
 assert.equal(requests.length,1);
});

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
test('client rejects identifiers, cart bindings and merchant labels outside the backend contract',async()=>{
 let count=0;const auth=client(async()=>{count++;return Response.json({});});
 const key='test-key-123456789',validAttempt={quoteId:'quote-one',cartRevision:'revision-one',cartHash:'a'.repeat(64)};
 for(const path of ['/commerce/orders/'+'a'.repeat(81),'/commerce/orders?cursor='+'a'.repeat(81)])await assert.rejects(auth.api(path),{code:'INVALID_PATH'});
 await assert.rejects(auth.api('/commerce/orders/'+'a'.repeat(81)+'/cancel',{method:'POST',body:'{}',idempotencyKey:key}),{code:'INVALID_PATH'});
 for(const patch of [{quoteId:'a'.repeat(81)},{cartHash:'z'.repeat(64)},{cartHash:'a'.repeat(63)}])await assert.rejects(auth.api('/commerce/checkout-attempts',{method:'POST',body:JSON.stringify({...validAttempt,...patch}),idempotencyKey:key}),{code:'INVALID_BODY'});
 await assert.rejects(auth.api('/commerce/quotes',{method:'POST',body:JSON.stringify({...body,lines:[{...body.lines[0],merchantDomain:'a'.repeat(64)+'.example'}]}),idempotencyKey:key}),{code:'INVALID_BODY'});
 assert.equal(count,0);
 await auth.api('/commerce/checkout-attempts',{method:'POST',body:JSON.stringify(validAttempt),idempotencyKey:key});assert.equal(count,1);
});
test('commerce body size uses UTF-8 bytes rather than JavaScript character count',async()=>{
 let count=0;const auth=client(async()=>{count++;return Response.json({});});
 const options=Object.fromEntries(Array.from({length:8},(_,i)=>['选'.repeat(59)+i,'值'.repeat(80)]));
 const lines=Array.from({length:10},(_,i)=>({...body.lines[0],merchantDomain:'merchant'+i+'.example',options}));
 const raw=JSON.stringify({...body,lines});assert.ok(raw.length<32768);assert.ok(Buffer.byteLength(raw)>32768);
 await assert.rejects(auth.api('/commerce/quotes',{method:'POST',body:raw,idempotencyKey:'test-key-123456789'}),{code:'INVALID_BODY'});assert.equal(count,0);
});
test('commerce transport matches the exact 32000-byte backend body limit',async()=>{
 let count=0;const auth=client(async()=>{count++;return Response.json({});});
 const raw=JSON.stringify(body).padEnd(32001,' ');
 await assert.rejects(auth.api('/commerce/quotes',{method:'POST',body:raw,idempotencyKey:'test-key-123456789'}),{code:'INVALID_BODY'});assert.equal(count,0);
 await auth.api('/commerce/quotes',{method:'POST',body:raw.slice(0,32000),idempotencyKey:'test-key-123456789'});assert.equal(count,1);
});
test('quote admission rejects duplicate selections regardless of quantity or option key order',async()=>{
 let count=0;const auth=client(async()=>{count++;return Response.json({});});
 const first={...body.lines[0],options:{Size:'M',Color:'Blue'}};
 const duplicate={...first,quantity:3,options:{Color:'Blue',Size:'M'}};
 const send=lines=>auth.api('/commerce/quotes',{method:'POST',body:JSON.stringify({...body,lines}),idempotencyKey:'test-key-123456789'});
 await assert.rejects(send([first,duplicate]),{code:'INVALID_BODY'});assert.equal(count,0);
 await send([first,{...duplicate,merchantDomain:'other.example'}]);
 await send([first,{...duplicate,condition:'used'}]);assert.equal(count,2,'distinct merchant and condition selections remain valid');
});
