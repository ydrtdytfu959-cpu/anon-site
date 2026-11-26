
"use strict";
const crypto=require("crypto");
const {DynamoDBClient,GetItemCommand,PutItemCommand,TransactWriteItemsCommand}=require("@aws-sdk/client-dynamodb");
const {SecretsManagerClient,GetSecretValueCommand}=require("@aws-sdk/client-secrets-manager");

const ddb=new DynamoDBClient({});
const sm=new SecretsManagerClient({});
const ORDERS=process.env.ORDERS_TABLE;
const PAYMENTS=process.env.PAYMENTS_TABLE;
const SECRET_ID=process.env.STRIPE_SECRET_ID;
const SIGNATURE_TOLERANCE_SECONDS=300;
const SUPPORTED=new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired"
]);

let cachedWebhookSecret="";

const S=v=>({S:String(v)});
const N=v=>({N:String(v)});
const B=v=>({BOOL:!!v});
const now=()=>new Date().toISOString();
const response=(statusCode,body)=>({
  statusCode,
  headers:{"content-type":"application/json","cache-control":"no-store"},
  body:JSON.stringify(body)
});

function header(event,name){
  const h=event?.headers||{};
  const wanted=name.toLowerCase();
  for(const [k,v] of Object.entries(h)){
    if(String(k).toLowerCase()===wanted)return String(v||"");
  }
  return "";
}

async function webhookSecret(){
  if(cachedWebhookSecret)return cachedWebhookSecret;
  const out=await sm.send(new GetSecretValueCommand({SecretId:SECRET_ID}));
  const raw=out.SecretString||"";
  if(!raw)throw new Error("STRIPE_SECRET_EMPTY");
  const parsed=JSON.parse(raw);
  if(!parsed.webhookSecret)throw new Error("STRIPE_WEBHOOK_SECRET_MISSING");
  cachedWebhookSecret=String(parsed.webhookSecret);
  return cachedWebhookSecret;
}

// Reject malformed or oversized input before retrieving a credential.
const MAX_BODY_BYTES=256000;
function parseRequest(event){
  const signature=header(event,"stripe-signature");
  if(!signature||signature.length>4096)throw Error("INVALID_STRIPE_SIGNATURE");
  const timestamps=[],signatures=[];
  for(const part of signature.split(",")){
    const i=part.indexOf("=");
    if(i<0)continue;
    const key=part.slice(0,i).trim(),value=part.slice(i+1).trim();
    if(key==="t")timestamps.push(value);
    if(key==="v1"&&/^[a-f0-9]{64}$/i.test(value))signatures.push(value);
  }
  if(timestamps.length!==1||!/^\d{10,12}$/.test(timestamps[0])||!signatures.length)throw Error("INVALID_STRIPE_SIGNATURE");
  if(Math.abs(Math.floor(Date.now()/1000)-Number(timestamps[0]))>SIGNATURE_TOLERANCE_SECONDS)throw Error("STALE_STRIPE_SIGNATURE");
  if(typeof event?.body!=="string"||event.body.length>Math.ceil(MAX_BODY_BYTES/3)*4)throw Error("INVALID_BODY");
  let raw;
  if(event.isBase64Encoded===true){
    raw=Buffer.from(event.body,"base64");
    if(raw.toString("base64")!==event.body)throw Error("INVALID_BODY");
  }else raw=Buffer.from(event.body,"utf8");
  if(!raw.length||raw.length>MAX_BODY_BYTES)throw Error("INVALID_BODY");
  return {raw,timestamp:timestamps[0],signatures};
}
function verifySignature({raw,timestamp,signatures},secret){
  const expected=crypto.createHmac("sha256",secret).update(timestamp+".","utf8").update(raw).digest();
  if(!signatures.some(sig=>crypto.timingSafeEqual(Buffer.from(sig,"hex"),expected)))throw Error("INVALID_STRIPE_SIGNATURE");
}

function sval(item,key){return item?.[key]?.S||""}
function nval(item,key){
  const raw=item?.[key]?.N;
  if(raw===undefined)return null;
  const value=Number(raw);
  return Number.isFinite(value)?value:null;
}

async function getEventMarker(eventId){
  const r=await ddb.send(new GetItemCommand({
    TableName:PAYMENTS,
    Key:{paymentId:S("stripe_event#"+eventId)},
    ConsistentRead:true
  }));
  return r.Item||null;
}

async function recordRejected(event,session,orderId,status,reason){
  const id=String(event?.id||"").trim();
  if(!id)return;
  const item={
    paymentId:S("stripe_event#"+id),
    recordType:S("stripe_event"),
    provider:S("stripe"),
    eventId:S(id),
    eventType:S(String(event.type||"unknown")),
    status:S(status),
    reason:S(reason),
    createdAt:S(now()),
    livemode:B(!!event.livemode),
    expiresAt:N(Math.floor(Date.now()/1000)+34560000)
  };
  if(orderId)item.orderId=S(orderId);
  if(session?.id)item.stripeSessionId=S(session.id);
  try{
    await ddb.send(new PutItemCommand({
      TableName:PAYMENTS,
      Item:item,
      ConditionExpression:"attribute_not_exists(paymentId)"
    }));
  }catch(e){
    if(e.name!=="ConditionalCheckFailedException")throw e;
  }
}

function stateFor(eventType,session){
  const paymentStatus=String(session?.payment_status||"");
  if(eventType==="checkout.session.async_payment_succeeded")return "paid";
  if(eventType==="checkout.session.async_payment_failed")return "failed";
  if(eventType==="checkout.session.expired")return "expired";
  if(eventType==="checkout.session.completed"){
    return (paymentStatus==="paid"||paymentStatus==="no_payment_required")?"paid":"pending";
  }
  return "ignored";
}

function paymentUpdate(session,event,orderId,next,ts){
  const names={"#s":"status","#rt":"recordType"};
  const values={
    ":rt":S("payment"),
    ":provider":S("stripe"),
    ":oid":S(orderId),
    ":sid":S(session.id),
    ":state":S(next),
    ":amt":N(session.amount_total),
    ":cur":S(String(session.currency).toLowerCase()),
    ":eid":S(event.id),
    ":etype":S(event.type),
    ":now":S(ts),
    ":live":B(!!event.livemode)
  };
  const sets=[
    "#rt=:rt","provider=:provider","orderId=:oid","stripeSessionId=:sid","#s=:state",
    "amount=:amt","currency=:cur","latestEventId=:eid","latestEventType=:etype",
    "updatedAt=:now","createdAt=if_not_exists(createdAt,:now)","livemode=:live"
  ];
  if(typeof session.payment_intent==="string"&&session.payment_intent){
    values[":pi"]=S(session.payment_intent);
    sets.push("stripePaymentIntentId=:pi");
  }
  if(next==="paid")sets.push("paidAt=if_not_exists(paidAt,:now)");
  if(next==="failed")sets.push("failedAt=if_not_exists(failedAt,:now)");
  if(next==="expired")sets.push("expiredAt=if_not_exists(expiredAt,:now)");
  return {
    TableName:PAYMENTS,
    Key:{paymentId:S("stripe_session#"+session.id)},
    UpdateExpression:"SET "+sets.join(","),
    ExpressionAttributeNames:names,
    ExpressionAttributeValues:values
  };
}

function orderUpdate(session,event,orderId,next,ts,observed){
  const names={"#s":"status"};
  const values={
    ":sid":S(session.id),
    ":amt":N(session.amount_total),
    ":cur":S(String(session.currency).toLowerCase()),
    ":eid":S(event.id),
    ":now":S(ts)
  };
  const sets=["stripeEventId=:eid","updatedAt=:now"];
  let condition="stripeSessionId=:sid AND amountTotal=:amt AND currency=:cur";
  // Bind the write to the state read for this event, including concurrent fulfillment.
  if(observed?.status?.S){values[":previousState"]=S(observed.status.S);condition+=" AND #s=:previousState";}
  else condition+=" AND attribute_not_exists(#s)";
  if(observed?.paymentStatus?.S){values[":previousPayment"]=S(observed.paymentStatus.S);condition+=" AND paymentStatus=:previousPayment";}
  else condition+=" AND attribute_not_exists(paymentStatus)";
  if(next!=="paid") values[":paid"]=S("paid");
  if(typeof session.payment_intent==="string"&&session.payment_intent){
    values[":pi"]=S(session.payment_intent);
    sets.push("stripePaymentIntentId=:pi");
  }
  if(next==="paid"){
    values[":orderStatus"]=S("PAYMENT_CONFIRMED");
    values[":paymentStatus"]=S("paid");
    sets.push("#s=:orderStatus","paymentStatus=:paymentStatus","paidAt=if_not_exists(paidAt,:now)");
  }else if(next==="pending"){
    values[":orderStatus"]=S("PAYMENT_PENDING");
    values[":paymentStatus"]=S(String(session.payment_status||"unpaid"));
    sets.push("#s=:orderStatus","paymentStatus=:paymentStatus");
    condition+=" AND (attribute_not_exists(paymentStatus) OR paymentStatus<>:paid)";
  }else if(next==="failed"){
    values[":orderStatus"]=S("PAYMENT_FAILED");
    values[":paymentStatus"]=S("failed");
    sets.push("#s=:orderStatus","paymentStatus=:paymentStatus","paymentFailedAt=:now");
    condition+=" AND (attribute_not_exists(paymentStatus) OR paymentStatus<>:paid)";
  }else if(next==="expired"){
    values[":orderStatus"]=S("CHECKOUT_EXPIRED");
    values[":paymentStatus"]=S("unpaid");
    sets.push("#s=:orderStatus","paymentStatus=:paymentStatus","checkoutExpiredAt=:now");
    condition+=" AND (attribute_not_exists(paymentStatus) OR paymentStatus<>:paid)";
  }
  return {
    TableName:ORDERS,
    Key:{orderId:S(orderId)},
    UpdateExpression:"SET "+sets.join(","),
    ConditionExpression:condition,
    ExpressionAttributeNames:names,
    ExpressionAttributeValues:values
  };
}

exports.handler=async event=>{
  let request,parsed,secret;
  try{request=parseRequest(event);}
  catch{console.warn("stripe_webhook_invalid_request");return response(400,{ok:false,error:"INVALID_WEBHOOK"});}
  try{secret=await webhookSecret();}
  catch{console.error("stripe_webhook_secret_unavailable");return response(503,{ok:false,error:"SERVICE_UNAVAILABLE"});}
  try{
    verifySignature(request,secret);
    const decoded=request.raw.toString("utf8");
    if(!Buffer.from(decoded,"utf8").equals(request.raw))throw Error("INVALID_UTF8");
    parsed=JSON.parse(decoded);
  }catch{
    console.warn("stripe_webhook_rejected");
    return response(400,{ok:false,error:"INVALID_WEBHOOK"});
  }

  if(parsed?.livemode!==false){
    console.warn("stripe_webhook_wrong_mode",{eventId:parsed?.id||"",livemode:parsed?.livemode});
    return response(400,{ok:false,error:"WRONG_MODE"});
  }

  const eventId=String(parsed?.id||"").trim();
  const eventType=String(parsed?.type||"").trim();
  if(!eventId||!eventType)return response(400,{ok:false,error:"INVALID_EVENT"});
  if(!SUPPORTED.has(eventType))return response(200,{ok:true,ignored:true});

  if(await getEventMarker(eventId))return response(200,{ok:true,duplicate:true});

  const session=parsed?.data?.object||{};
  const metaOrder=String(session?.metadata?.anox_order_id||"").trim();
  const refOrder=String(session?.client_reference_id||"").trim();
  const orderId=metaOrder||refOrder;

  if(!session?.id||session.object!=="checkout.session"||!orderId){
    await recordRejected(parsed,session,orderId,"rejected","MISSING_SESSION_OR_ORDER");
    return response(200,{ok:false,rejected:true});
  }
  if(metaOrder&&refOrder&&metaOrder!==refOrder){
    await recordRejected(parsed,session,orderId,"rejected","ORDER_REFERENCE_MISMATCH");
    return response(200,{ok:false,rejected:true});
  }
  if(!Number.isInteger(session.amount_total)||session.amount_total<0||!session.currency){
    await recordRejected(parsed,session,orderId,"rejected","INVALID_AMOUNT_OR_CURRENCY");
    return response(200,{ok:false,rejected:true});
  }

  const orderResult=await ddb.send(new GetItemCommand({
    TableName:ORDERS,
    Key:{orderId:S(orderId)},
    ConsistentRead:true
  }));
  const order=orderResult.Item;
  if(!order){
    await recordRejected(parsed,session,orderId,"rejected","ORDER_NOT_FOUND");
    return response(200,{ok:false,rejected:true});
  }

  const expectedSession=sval(order,"stripeSessionId");
  const expectedAmount=nval(order,"amountTotal");
  const expectedCurrency=sval(order,"currency").toLowerCase();
  if(expectedSession!==session.id||expectedAmount!==session.amount_total||expectedCurrency!==String(session.currency).toLowerCase()){
    await recordRejected(parsed,session,orderId,"rejected","ORDER_INTEGRITY_MISMATCH");
    console.error("stripe_order_integrity_mismatch",{eventId,orderId});
    return response(200,{ok:false,rejected:true});
  }

  const next=stateFor(eventType,session);
  if(isStaleTransition(order,next)){
    await recordRejected(parsed,session,orderId,"ignored_stale","ORDER_STATE_PRESERVED");
    return response(200,{ok:true,ignored:true});
  }
  const ts=now();
  const eventItem={
    paymentId:S("stripe_event#"+eventId),
    recordType:S("stripe_event"),
    provider:S("stripe"),
    eventId:S(eventId),
    eventType:S(eventType),
    orderId:S(orderId),
    stripeSessionId:S(session.id),
    status:S("processed"),
    createdAt:S(ts),
    livemode:B(false),
    expiresAt:N(Math.floor(Date.now()/1000)+34560000)
  };

  try{
    await ddb.send(new TransactWriteItemsCommand({
      TransactItems:[
        {Put:{TableName:PAYMENTS,Item:eventItem,ConditionExpression:"attribute_not_exists(paymentId)"}},
        {Update:paymentUpdate(session,parsed,orderId,next,ts)},
        {Update:orderUpdate(session,parsed,orderId,next,ts,order)}
      ]
    }));
  }catch(e){
    if(e.name==="TransactionCanceledException"){
      if(await getEventMarker(eventId))return response(200,{ok:true,duplicate:true});
      const reread=(await ddb.send(new GetItemCommand({
        TableName:ORDERS,
        Key:{orderId:S(orderId)},
        ConsistentRead:true
      }))).Item;
      if(reread&&isStaleTransition(reread,next)){
        await recordRejected(parsed,session,orderId,"ignored_stale","ORDER_STATE_PRESERVED");
        return response(200,{ok:true,ignored:true});
      }
    }
    console.error("stripe_webhook_processing_failed",{eventId,orderId,name:e.name});
    return response(500,{ok:false,error:"PROCESSING_FAILED"});
  }

  console.log("stripe_webhook_processed",{eventId,eventType,orderId,state:next});
  return response(200,{ok:true,eventId,orderId,state:next});
};

function isStaleTransition(order,next){
  return sval(order,"paymentStatus")==="paid" || (next==="pending" &&
    (sval(order,"paymentStatus")==="failed" || ["PAYMENT_FAILED","CHECKOUT_EXPIRED"].includes(sval(order,"status"))));
}
