'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assess}=require('../scripts/release-preflight.cjs');
const now=Date.parse('2026-10-12T18:00:00Z');
const routeKeys=['GET /commerce/capabilities','POST /commerce/quotes','POST /commerce/checkout-attempts','GET /commerce/orders','GET /commerce/orders/{orderId}','POST /commerce/orders/{orderId}/cancel','POST /commerce/orders/{orderId}/refund','GET /catalog/channel3/products/{id}'];
function baseFixture(){return{capturedAt:new Date(now).toISOString(),identity:{Account:'427064007352'},region:'us-east-2',api:{ApiId:'zmumi2wruk',CorsConfiguration:{AllowOrigins:['https://anox.app'],AllowCredentials:false,AllowHeaders:['authorization','content-type','Idempotency-Key'],AllowMethods:['GET','POST','PUT','OPTIONS']}},authorizers:[{AuthorizerId:'qcopg9',AuthorizerType:'JWT',IdentitySource:['$request.header.Authorization'],JwtConfiguration:{Issuer:'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_gUci3YuMm',Audience:['63738r9gpr126qpgp1a5cubchi']}}],routes:routeKeys.map(RouteKey=>({RouteKey,AuthorizationType:RouteKey.includes('/capabilities')||RouteKey.includes('/catalog/')?'NONE':'JWT',AuthorizerId:'qcopg9'})),lambdaAccount:{AccountLimit:{UnreservedConcurrentExecutions:105}},commerceReservedConcurrency:5,templateBytes:{catalog:60000,commerce:67130},artifact:{privateBucketVerified:true,templateUrlPlanned:true},alarmDestinationVerified:true,sourceMatchesReviewedCommit:true};}
function fixture(){
 const s=baseFixture();
 s.expectedIntegrationUris={catalog:'arn:aws:lambda:us-east-2:427064007352:function:AnoX-Channel3-Catalog',commerce:'arn:aws:lambda:us-east-2:427064007352:function:AnoX-Commerce-commerce'};
 s.integrations=Object.entries(s.expectedIntegrationUris).map(([IntegrationId,IntegrationUri])=>({IntegrationId,IntegrationUri,IntegrationType:'AWS_PROXY',IntegrationMethod:'POST',PayloadFormatVersion:'2.0'}));
 for(const r of s.routes)r.Target='integrations/'+(r.RouteKey.includes('/catalog/')?'catalog':'commerce');
 return s;
}
const options={now,reservedConcurrency:5,phase:'frontend'};
test('release preflight identifies absent backend routes without declaring source defective',()=>{const s=fixture();s.routes=[];const r=assess(s,options);assert.equal(r.ready,false);assert.ok(r.gates.some(g=>g.code==='MISSING_ROUTES'&&g.severity==='P0'));assert.equal(r.authorizesDeployment,false);});
test('reserved concurrency cannot consume the protected unreserved pool',()=>{const s=fixture();s.lambdaAccount.AccountLimit.UnreservedConcurrentExecutions=10;assert.ok(assess(s,{...options,phase:'backend'}).gates.some(g=>g.code==='CONCURRENCY_QUOTA'));s.lambdaAccount.AccountLimit.UnreservedConcurrentExecutions=104;assert.equal(assess(s,{...options,phase:'backend'}).ready,false);});
test('wrong account auth or broad CORS blocks even when all routes exist',()=>{for(const mutate of [s=>s.identity.Account='000000000000',s=>s.region='us-east-1',s=>s.authorizers[0].JwtConfiguration.Audience=['wrong'],s=>s.routes[1].AuthorizationType='NONE',s=>s.api.CorsConfiguration.AllowOrigins.push('*')]){const s=fixture();mutate(s);assert.equal(assess(s,options).ready,false);}});
test('preflight requires fresh evidence safe template delivery and reviewed identity',()=>{for(const mutate of [s=>delete s.capturedAt,s=>s.capturedAt=new Date(now-3600001).toISOString(),s=>s.capturedAt=new Date(now+1).toISOString(),s=>s.artifact.privateBucketVerified=false,s=>s.artifact.templateUrlPlanned=false,s=>s.alarmDestinationVerified=false,s=>s.sourceMatchesReviewedCommit=false,s=>s.templateBytes.catalog=1048577]){const s=fixture();mutate(s);assert.equal(assess(s,options).ready,false);}});
test('synthetic satisfied infrastructure prerequisites never authorize deployment or payments',()=>{const r=assess(fixture(),options);assert.equal(r.ready,true);assert.equal(r.authorizesDeployment,false);assert.equal(r.authorizesPayments,false);assert.deepEqual(r.gates,[]);});
test('pre-backend planning allows absent routes but not policy drift or missing quota',()=>{const s=fixture();s.routes=[];s.api.CorsConfiguration.AllowHeaders=['authorization','content-type'];assert.equal(assess(s,{...options,phase:'backend'}).ready,true);s.routes=[{RouteKey:routeKeys[1],AuthorizationType:'NONE'}];assert.ok(assess(s,{...options,phase:'backend'}).gates.some(g=>g.code==='ROUTE_AUTH'));});
test('malformed inputs and reservation options fail closed',()=>{for(const s of [null,{},[],{capturedAt:'not-a-date'}])assert.equal(assess(s,options).ready,false);for(const reservedConcurrency of [0,-1,1.5,'5',Infinity])assert.equal(assess(fixture(),{...options,reservedConcurrency}).ready,false);});
test('malformed inventories and stringified CORS lists cannot satisfy a release gate',()=>{
 for(const mutate of [s=>s.authorizers=[null],s=>s.authorizers.push(null),s=>s.routes.push(null),s=>s.api.CorsConfiguration.AllowMethods='GET POST PUT OPTIONS',s=>s.api.CorsConfiguration.AllowMethods.push(42),s=>s.api.CorsConfiguration.AllowHeaders.push(null)]){
  const s=fixture();mutate(s);assert.equal(assess(s,options).ready,false);
 }
});
test('concurrency defaults and bounds match the canonical commerce template',()=>{
 const template=require('../backend/commerce/cloudformation.json');
 assert.equal(template.Parameters.ReservedConcurrency.Default,2);
 const s=fixture();s.commerceReservedConcurrency=2;
 assert.equal(assess(s,{now}).ready,true);
 assert.equal(assess(s,{now,reservedConcurrency:6}).ready,false);
});

test('independent review rejects broad methods, wrong handlers and unapproved reservations',()=>{
 for(const mutate of [s=>s.api.CorsConfiguration.AllowMethods.push('*'),s=>s.api.CorsConfiguration.AllowHeaders.push('*'),s=>s.routes.forEach(r=>delete r.Target),s=>s.routes[1].Target='integrations/unknown',s=>s.integrations[1].IntegrationUri=s.expectedIntegrationUris.catalog,s=>s.integrations[1].PayloadFormatVersion='1.0',s=>s.integrations.push(null),s=>delete s.expectedIntegrationUris,s=>s.commerceReservedConcurrency=999,s=>s.commerceReservedConcurrency=4]){
  const s=fixture();mutate(s);assert.equal(assess(s,options).ready,false);
 }
});
