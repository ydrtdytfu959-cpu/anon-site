'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const S=value=>({S:String(value)});
const failure=name=>Object.assign(Error(name),{name});
function fixture({fault='',status='LABEL_CREATED'}={}){
 const state={shipment:{shipmentId:S('fixture-shipment'),orderId:S('fixture-order'),status:S(status)},events:new Map(),writes:0,transactions:0,reads:[],fault};
 const commands=Object.fromEntries(['GetItemCommand','PutItemCommand','UpdateItemCommand','QueryCommand','TransactWriteItemsCommand'].map(name=>[name,class {constructor(input){this.input=input;this.name=name;}}]));
 const key=item=>item.shipmentId.S+'|'+item.eventAt.S;
 const ddb={async send(command){
  const p=command.input;
  if(command.name==='GetItemCommand'){
   state.reads.push(p);assert.equal(p.ConsistentRead,true);
   if(state.fault==='receipt-race'&&state.reads.length===2){
    state.fault='';state.shipment.status=S('IN_TRANSIT');
    const receipt={shipmentId:S('fixture-shipment'),eventAt:S('2026-10-23T00:00:00.000Z#fixture-event'),status:S('LABEL_CREATED')};
    state.events.set(key(receipt),receipt);
   }
   return {Item:structuredClone(p.TableName==='tracking'?state.events.get(key(p.Key)):state.shipment)};
  }
  if(command.name==='QueryCommand'){
   assert.equal(p.TableName,'tracking');assert.equal(p.ConsistentRead,true);assert.equal(p.Limit,1);
   assert.equal(p.KeyConditionExpression,'shipmentId = :shipment AND eventAt = :event');
   const row=state.events.get(key({shipmentId:p.ExpressionAttributeValues[':shipment'],eventAt:p.ExpressionAttributeValues[':event']}));
   return {Items:row?[structuredClone(row)]:[]};
  }
  if(command.name==='PutItemCommand'){
   if(state.events.has(key(p.Item)))throw failure('ConditionalCheckFailedException');
   state.events.set(key(p.Item),structuredClone(p.Item));return {};
  }
  if(command.name==='UpdateItemCommand'){
   if(state.fault==='before'){state.fault='';throw failure('ProvisionedThroughputExceededException');}
   if(state.fault==='race'){state.fault='';state.shipment.status=S('DELIVERED');}
   state.shipment.status=p.ExpressionAttributeValues[':status'];state.writes++;return {Attributes:structuredClone(state.shipment)};
  }
  assert.equal(command.name,'TransactWriteItemsCommand');state.transactions++;
  assert.equal(p.TransactItems.length,2);
  const put=p.TransactItems[0].Put,update=p.TransactItems[1].Update;
  assert.equal(put.TableName,'tracking');assert.equal(update.TableName,'shipments');
  assert.equal(put.ConditionExpression,'attribute_not_exists(shipmentId) AND attribute_not_exists(eventAt)');
  assert.equal(update.ConditionExpression,'attribute_exists(shipmentId) AND #status = :expected');
  if(state.fault==='before'){state.fault='';throw failure('ProvisionedThroughputExceededException');}
  if(state.fault==='race'){state.fault='';state.shipment.status=S('DELIVERED');}
  if(state.events.has(key(put.Item))||state.shipment.status.S!==update.ExpressionAttributeValues[':expected'].S)throw failure('TransactionCanceledException');
  state.events.set(key(put.Item),structuredClone(put.Item));state.shipment.status=update.ExpressionAttributeValues[':status'];state.writes++;
  if(state.fault==='after'){state.fault='';throw failure('TimeoutError');}
  return {};
 }};
 const ctx={exports:{},require(){throw Error('Unexpected SDK or network access');}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend/legacy-shipping/index.js'),'utf8')+'\nexports.test={createRepository,createShippingHandler};',ctx);
 const repository=ctx.exports.test.createRepository({ddb,tables:{orders:'orders',shipments:'shipments',tracking:'tracking'},commands});
 const provider={normalizeTrackingEvent(event){return {providerEventId:event.id,providerStatus:event.status,eventAt:'2026-10-23T00:00:00.000Z',message:'fixture',location:''};}};
 return {state,handler:ctx.exports.test.createShippingHandler({repository,provider})};
}
const event=(status='in_transit')=>({action:'INGEST_TRACKING_EVENT',shipmentId:'fixture-shipment',providerEvent:{id:'fixture-event',status}});
test('tracking receipt and advancement fail together, so a retry can complete',async()=>{
 const {state,handler}=fixture({fault:'before'});
 await assert.rejects(handler(event()),/ProvisionedThroughputExceededException/);
 assert.equal(state.events.size,0,'failed advancement must not consume the receipt');assert.equal(state.shipment.status.S,'LABEL_CREATED');
 await handler(event());assert.equal(state.events.size,1);assert.equal(state.shipment.status.S,'IN_TRANSIT');assert.equal(state.writes,1);
});
test('concurrent delivery cannot be overwritten by an older in-transit update',async()=>{
 const {state,handler}=fixture({fault:'race'});
 await handler(event());assert.equal(state.shipment.status.S,'DELIVERED');assert.equal(state.events.size,1);assert.equal(state.transactions,2);
});
test('ambiguous transaction success is safe to replay without a second advancement',async()=>{
 const {state,handler}=fixture({fault:'after'});
 await assert.rejects(handler(event()),/TimeoutError/);assert.equal(state.events.size,1);assert.equal(state.shipment.status.S,'IN_TRANSIT');
 const replay=await handler(event());assert.equal(replay.duplicate,true);assert.equal(state.writes,1);
});
test('duplicate and late events preserve delivered state and invalid transitions do not write',async()=>{
 const {state,handler}=fixture({status:'DELIVERED'});
 await handler(event());const duplicate=await handler(event());assert.equal(duplicate.duplicate,true);assert.equal(state.shipment.status.S,'DELIVERED');assert.equal(state.events.size,1);
 const cancelled=fixture({status:'CANCELLED'});await assert.rejects(cancelled.handler(event()),/INVALID_SHIPMENT_TRANSITION/);assert.equal(cancelled.state.events.size,0);assert.equal(cancelled.state.writes,0);
});
test('a previously recorded event stays idempotent after later shipment progress',async()=>{
 const {state,handler}=fixture();await handler(event('pre_transit'));
 state.shipment.status=S('IN_TRANSIT');
 const replay=await handler(event('pre_transit'));assert.equal(replay.duplicate,true);assert.equal(state.shipment.status.S,'IN_TRANSIT');assert.equal(state.events.size,1);
});
test('receipt committed between initial receipt query and state read is still recognized as a duplicate',async()=>{
 const {state,handler}=fixture({fault:'receipt-race'});
 const replay=await handler(event('pre_transit'));assert.equal(replay.duplicate,true);assert.equal(state.shipment.status.S,'IN_TRANSIT');assert.equal(state.events.size,1);assert.equal(state.transactions,0);
});
