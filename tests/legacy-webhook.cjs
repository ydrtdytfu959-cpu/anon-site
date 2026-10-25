'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function setup({status='PAYMENT_PENDING',paymentStatus='unpaid',marker=false}={}){
 const calls=[],writes=[],key='isolated-webhook-signing-fixture';let secrets=0;
 const order={orderId:{S:'order-one'},stripeSessionId:{S:'session-one'},amountTotal:{N:'100'},currency:{S:'usd'},status:{S:status},paymentStatus:{S:paymentStatus}};
 class GetItemCommand{constructor(input){this.input=input;}}
 class PutItemCommand{constructor(input){this.input=input;}}
 class TransactWriteItemsCommand{constructor(input){this.input=input;}}
 class DynamoDBClient{async send(command){calls.push(command);if(command instanceof GetItemCommand)return {Item:command.input.TableName==='orders'?structuredClone(order):marker?{paymentId:{S:'existing'}}:undefined};writes.push(command);return {};}}
 class SecretsManagerClient{async send(){secrets++;return {SecretString:JSON.stringify({webhookSecret:key})};}}
 const context={exports:{},Buffer,console:{log(){},warn(){},error(){}},process:{env:{ORDERS_TABLE:'orders',PAYMENTS_TABLE:'payments',STRIPE_SECRET_ID:'fixture'}},require:name=>name==='crypto'?crypto:name==='@aws-sdk/client-dynamodb'?{DynamoDBClient,GetItemCommand,PutItemCommand,TransactWriteItemsCommand}:{SecretsManagerClient,GetSecretValueCommand:class{}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../backend/legacy-webhook/index.js'),'utf8'),context);
 const event=(type='checkout.session.completed',patch={})=>{
  const data={id:'event-one',type,livemode:false,data:{object:{id:'session-one',object:'checkout.session',metadata:{anox_order_id:'order-one'},client_reference_id:'order-one',amount_total:100,currency:'usd',payment_status:'paid',...patch}}};
  const body=JSON.stringify(data),at=Math.floor(Date.now()/1000);return {body,headers:{'stripe-signature':'t='+at+',v1='+crypto.createHmac('sha256',key).update(at+'.'+body).digest('hex')}};
 };
 return {handle:context.exports.handler,event,calls,writes,secrets:()=>secrets};
}
test('later matching payment events preserve already settled fulfillment state and retain an event record',async()=>{
 const f=setup({status:'SHIPPED',paymentStatus:'paid'}),r=await f.handle(f.event());
 assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).ignored,true);
 assert.equal(f.writes.length,1);assert.ok(f.writes[0].input.Item,'only the event marker is written');assert.equal(f.writes[0].input.Item.status.S,'ignored_stale');
});
test('late pending notification cannot reopen failed or expired checkout',async()=>{
 for(const status of ['PAYMENT_FAILED','CHECKOUT_EXPIRED']){
  const f=setup({status}),r=await f.handle(f.event('checkout.session.completed',{payment_status:'unpaid'}));
  assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).ignored,true);assert.ok(f.writes.every(w=>w.input.Item));
 }
});
test('valid settlement remains atomic and is bound to the observed order state',async()=>{
 const f=setup(),r=await f.handle(f.event());assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).state,'paid');
 const tx=f.writes[0].input.TransactItems;assert.equal(tx.length,3);assert.match(tx[2].Update.ConditionExpression,/#s=:previousState/);assert.equal(tx[2].Update.ExpressionAttributeValues[':previousState'].S,'PAYMENT_PENDING');
});
test('unsigned input avoids secret retrieval and raw-body alteration cannot reach data writes',async()=>{
 const f=setup();assert.equal((await f.handle({body:'{}',headers:{}})).statusCode,400);assert.equal(f.secrets(),0);
 const altered=f.event();altered.body+=' ';assert.equal((await f.handle(altered)).statusCode,400);assert.equal(f.calls.length,0);
});
test('replays and amount mismatches cannot update payment or order records',async()=>{
 const replay=setup({marker:true});assert.equal(JSON.parse((await replay.handle(replay.event())).body).duplicate,true);assert.equal(replay.writes.length,0);
 const wrong=setup();assert.equal(JSON.parse((await wrong.handle(wrong.event('checkout.session.completed',{amount_total:101}))).body).rejected,true);assert.ok(wrong.writes.every(w=>w.input.Item));
});
test('reviewed legacy template update preserves all configuration and rejects source drift',()=>{
 const {prepare}=require('../backend/legacy-webhook/prepare-template.cjs');
 const before={Resources:{PaymentWebhookFunction:{Type:'AWS::Lambda::Function',Properties:{Handler:'index.handler',Code:{ZipFile:'previous source'},Environment:{Variables:{MODE:'sandbox'}}}},Unrelated:{Type:'fixture'}}};
 const expectedSourceSha256=crypto.createHash('sha256').update('previous source').digest('hex');
 const next=prepare(before,{expectedSourceSha256,source:'reviewed source'});
 assert.equal(before.Resources.PaymentWebhookFunction.Properties.Code.ZipFile,'previous source');
 assert.equal(next.Resources.PaymentWebhookFunction.Properties.Code.ZipFile,'reviewed source');
 next.Resources.PaymentWebhookFunction.Properties.Code.ZipFile='previous source';assert.deepEqual(next,before);
 assert.throws(()=>prepare(before,{expectedSourceSha256:'0'.repeat(64)}));
});
