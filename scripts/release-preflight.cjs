#!/usr/bin/env node
'use strict';
// Offline prerequisite assessment only: no AWS client, upload, deployment,
// payment capability, or authority to override an independent release review.
const fs=require('node:fs');
const ROUTES=Object.freeze(['GET /commerce/capabilities','POST /commerce/quotes','POST /commerce/checkout-attempts','GET /commerce/orders','GET /commerce/orders/{orderId}','POST /commerce/orders/{orderId}/cancel','POST /commerce/orders/{orderId}/refund','GET /catalog/channel3/products/{id}']);
function assess(input,{now=Date.now(),reservedConcurrency=2,phase='frontend'}={}){
 const s=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 const gates=[],add=(code,severity,message)=>gates.push({code,severity,message});
 const timestamp=typeof s.capturedAt==='string'?Date.parse(s.capturedAt):NaN;
 if(!Number.isFinite(now)||!Number.isFinite(timestamp)||timestamp>now||now-timestamp>3600000)add('STALE_EVIDENCE','P1','Capture current metadata within one hour of independent deployment review.');
 if(!['backend','frontend'].includes(phase)||!Number.isSafeInteger(reservedConcurrency)||reservedConcurrency<1||reservedConcurrency>5)add('INVALID_PLAN','P0','A valid phase and reviewed reserved-concurrency allocation of 1–5 are required.');
 if(s.identity?.Account!=='427064007352'||s.region!=='us-east-2'||s.api?.ApiId!=='zmumi2wruk')add('WRONG_TARGET','P0','Account, region and existing API must match the reviewed target.');
 const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const authorizers=Array.isArray(s.authorizers)?s.authorizers:[];
 if(!authorizers.every(record)||!Array.isArray(s.routes)||!s.routes.every(record)||!Array.isArray(s.integrations)||!s.integrations.every(record))add('INVALID_INVENTORY','P0','Authorizer, route and integration inventories must contain valid metadata records.');
 const authorities=authorizers.filter(x=>record(x)&&x.AuthorizerId==='qcopg9'),a=authorities.length===1?authorities[0]:null;
 if(a?.AuthorizerType!=='JWT'||JSON.stringify(a.IdentitySource)!==JSON.stringify(['$request.header.Authorization'])||a.JwtConfiguration?.Issuer!=='https://cognito-idp.us-east-2.amazonaws.com/us-east-2_gUci3YuMm'||JSON.stringify(a.JwtConfiguration?.Audience)!==JSON.stringify(['63738r9gpr126qpgp1a5cubchi']))add('JWT_AUTHORITY','P0','Verify the exact existing JWT issuer, audience and Authorization-header source.');
 const cors=s.api?.CorsConfiguration;
 const strings=x=>Array.isArray(x)&&x.every(value=>typeof value==='string');
 if(JSON.stringify(cors?.AllowOrigins)!==JSON.stringify(['https://anox.app'])||cors?.AllowCredentials!==false||!strings(cors?.AllowMethods)||JSON.stringify([...cors.AllowMethods].sort())!==JSON.stringify(['GET','OPTIONS','POST','PUT']))add('CORS_POLICY','P0','Origin/credentials/method drift must be reviewed; never broaden origin as a workaround.');
 const headers=strings(cors?.AllowHeaders)?cors.AllowHeaders.map(h=>h.toLowerCase()):[];
 if(!['authorization','content-type'].every(h=>headers.includes(h))||(phase==='frontend'&&!headers.includes('idempotency-key'))||headers.some(h=>!['authorization','content-type','idempotency-key'].includes(h)))add('CORS_HEADERS','P0','The frontend requires the approved Idempotency-Key preflight policy without unrelated header changes.');
 const routes=Array.isArray(s.routes)?s.routes.filter(record):[],missing=[];
 const integrations=Array.isArray(s.integrations)?s.integrations.filter(record):[];
 const expected=s.expectedIntegrationUris;
 if(expected?.catalog!=='arn:aws:lambda:us-east-2:427064007352:function:AnoX-Channel3-Catalog'||typeof expected?.commerce!=='string'||!/^arn:aws:lambda:us-east-2:427064007352:function:[A-Za-z0-9_-]+-commerce$/.test(expected.commerce))add('INTEGRATION_PLAN','P0','Record independently reviewed exact catalog and namespaced commerce Lambda ARNs.');
 for(const key of ROUTES){
  const matching=routes.filter(r=>r.RouteKey===key),r=matching[0];
  if(!r){missing.push(key);continue;}
  const privateRoute=!key.includes('/capabilities')&&!key.includes('/catalog/');
  if(matching.length!==1||r.AuthorizationType!==(privateRoute?'JWT':'NONE')||(privateRoute&&r.AuthorizerId!=='qcopg9'))add('ROUTE_AUTH','P0','Unexpected authorization on '+key+'.');
  const targets=integrations.filter(i=>r.Target==='integrations/'+i.IntegrationId),integration=targets.length===1?targets[0]:null;
  if(!integration||integration.IntegrationUri!==expected?.[key.includes('/catalog/')?'catalog':'commerce']||integration.IntegrationType!=='AWS_PROXY'||integration.IntegrationMethod!=='POST'||integration.PayloadFormatVersion!=='2.0')add('ROUTE_INTEGRATION','P0','Verify route target and Lambda integration contract on '+key+'.');
 }
 if(phase==='frontend'&&missing.length)add('MISSING_ROUTES','P0','Backend deployment and verification must precede frontend release: '+missing.join(', '));
 if(phase==='backend'){
  const available=s.lambdaAccount?.AccountLimit?.UnreservedConcurrentExecutions;
  if(!Number.isSafeInteger(available)||available-reservedConcurrency<100)add('CONCURRENCY_QUOTA','P0','Additional reservation must leave at least100 unreserved executions; request separately approved quota capacity first.');
 }else if(s.commerceReservedConcurrency!==reservedConcurrency)add('CONCURRENCY_RESERVATION','P0','Verify the commerce function has exactly its approved reservation after deployment.');
 for(const name of ['catalog','commerce']){
  const size=s.templateBytes?.[name];
  if(!Number.isSafeInteger(size)||size<1||size>1048576)add('TEMPLATE_SIZE','P0','Missing/invalid '+name+' template size or beyond1MiB.');
  else if(size>51200&&(s.artifact?.privateBucketVerified!==true||s.artifact?.templateUrlPlanned!==true))add('TEMPLATE_DELIVERY','P0','Review a private S3 TemplateURL for '+name+'; no upload is performed by this tool.');
 }
 if(s.sourceMatchesReviewedCommit!==true)add('SOURCE_IDENTITY','P0','Independently verify commit, template hashes and existing production rollback identity before release.');
 if(s.alarmDestinationVerified!==true)add('ALARM_DELIVERY','P1','Approve and test the alarm destination; an alarm without delivery is not a notification.');
 return{scope:'infrastructure prerequisites only; operator-supplied evidence is not an AWS verification or commercial approval',phase,ready:gates.length===0,authorizesDeployment:false,authorizesPayments:false,gates};
}
if(require.main===module){try{if(process.argv.length<3||process.argv.length>4)throw Error('Usage: node scripts/release-preflight.cjs metadata.json [backend|frontend]');const r=assess(JSON.parse(fs.readFileSync(process.argv[2],'utf8')),{phase:process.argv[3]||'frontend'});process.stdout.write(JSON.stringify(r,null,2)+'\n');if(!r.ready)process.exitCode=2;}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}}
module.exports={assess,ROUTES};
