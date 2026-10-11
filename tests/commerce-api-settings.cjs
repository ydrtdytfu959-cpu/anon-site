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
