const test = require('node:test');
const assert = require('node:assert/strict');
const { stageApiSettings } = require('../backend/commerce/stage-api-settings.cjs');
test('staged API updates preserve existing CORS origins methods and unrelated route limits', () => {
  const cors = { AllowOrigins: ['https://anox.app'], AllowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'], AllowHeaders: ['content-type', 'authorization'], MaxAge: 300, AllowCredentials: false };
  const api = { ApiId: 'zmumi2wruk', CorsConfiguration: cors }, stage = { StageName: '$default', RouteSettings: { 'GET /orders': { ThrottlingRateLimit: 100, ThrottlingBurstLimit: 200 }, 'POST /commerce/quotes': { DetailedMetricsEnabled: true } } };
  const copy = structuredClone({ api, stage }), result = stageApiSettings(api, stage);
  assert.deepEqual(result.apiUpdate.CorsConfiguration.AllowOrigins, cors.AllowOrigins); assert.deepEqual(result.apiUpdate.CorsConfiguration.AllowMethods, cors.AllowMethods); assert.equal(result.apiUpdate.CorsConfiguration.AllowCredentials, false);
  assert.deepEqual(result.stageUpdate.RouteSettings['GET /orders'], stage.RouteSettings['GET /orders']); assert.equal(result.stageUpdate.RouteSettings['POST /commerce/quotes'].DetailedMetricsEnabled, true);
  assert.ok(result.apiUpdate.CorsConfiguration.AllowHeaders.includes('Idempotency-Key')); assert.equal(result.stageUpdate.RouteSettings['POST /commerce/quotes'].ThrottlingRateLimit, 2);
  assert.deepEqual(result.apiRollback.CorsConfiguration, cors); assert.deepEqual({ api, stage }, copy);
});
test('staging refuses missing or unexpected live metadata instead of guessing CORS origins', () => {
  for (const api of [{}, { ApiId: 'zmumi2wruk', CorsConfiguration: { AllowOrigins: ['*'] } }, { ApiId: 'zmumi2wruk', CorsConfiguration: { AllowOrigins: ['https://anox.app', 'https://other.example'] } }]) assert.throws(() => stageApiSettings(api, { StageName: '$default' }));
});
test('planning refuses broadened credentials methods headers and malformed stage metadata', () => {
  const valid = { ApiId: 'zmumi2wruk', CorsConfiguration: { AllowOrigins: ['https://anox.app'], AllowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'], AllowHeaders: ['content-type', 'authorization'], AllowCredentials: false } };
  for (const change of [a => a.CorsConfiguration.AllowCredentials = true, a => a.CorsConfiguration.AllowMethods.push('*'), a => a.CorsConfiguration.AllowMethods.push('DELETE'), a => a.CorsConfiguration.AllowHeaders.push('*'), a => a.CorsConfiguration.ExposeHeaders = ['*'], a => a.CorsConfiguration.AllowHeaders.push(null)]) {
    const api = structuredClone(valid); change(api); assert.throws(() => stageApiSettings(api, { StageName: '$default' }));
  }
  for (const stage of [{ StageName: '$default', RouteSettings: [] }, { StageName: '$default', RouteSettings: { 'GET /orders': null } }]) assert.throws(() => stageApiSettings(valid, stage));
});
test('service-request writes receive bounded route throttles without broadening CORS', () => {
 const api={ApiId:'zmumi2wruk',CorsConfiguration:{AllowOrigins:['https://anox.app'],AllowMethods:['GET','POST','PUT','OPTIONS'],AllowHeaders:['content-type','authorization'],AllowCredentials:false}};
 const result=stageApiSettings(api,{StageName:'$default'});
 assert.deepEqual(result.stageUpdate.RouteSettings['POST /commerce/service-requests'],{ThrottlingRateLimit:2,ThrottlingBurstLimit:4});
});
