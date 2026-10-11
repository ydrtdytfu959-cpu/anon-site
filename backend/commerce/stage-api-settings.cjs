'use strict';
// Local-only planning tool. It never calls AWS and has no deployment mode.
const fs = require('node:fs');
const path = require('node:path');
function stageApiSettings(api, stage) {
  const cors = api?.CorsConfiguration;
  if (!/^[a-z0-9]{10}$/.test(api?.ApiId || '') || typeof stage?.StageName !== 'string' || !stage.StageName || !cors || !Array.isArray(cors.AllowOrigins) || cors.AllowOrigins.length !== 1 || cors.AllowOrigins[0] !== 'https://anox.app' || !Array.isArray(cors.AllowMethods) || !['GET', 'POST', 'OPTIONS'].every(method => cors.AllowMethods.includes(method)) || !Array.isArray(cors.AllowHeaders)) throw Error('Verified API/stage metadata with the existing https://anox.app CORS policy is required. Review configuration drift before preparing changes.');
  const add = (values, additions) => {
    const result = [...values]; for (const addition of additions) if (!result.some(value => value.toLowerCase() === addition.toLowerCase())) result.push(addition); return result;
  };
  const CorsConfiguration = { ...structuredClone(cors), AllowHeaders: add(cors.AllowHeaders, ['Idempotency-Key']), ExposeHeaders: add(cors.ExposeHeaders || [], ['Idempotency-Replayed', 'Retry-After']) };
  const RouteSettings = structuredClone(stage.RouteSettings || {});
  const limits = { 'GET /commerce/capabilities': [10, 20], 'POST /commerce/quotes': [2, 4], 'POST /commerce/checkout-attempts': [2, 4], 'GET /commerce/orders': [5, 10], 'GET /commerce/orders/{orderId}': [5, 10], 'POST /commerce/orders/{orderId}/cancel': [2, 4], 'POST /commerce/orders/{orderId}/refund': [2, 4] };
  for (const [route, [rate, burst]] of Object.entries(limits)) RouteSettings[route] = { ...RouteSettings[route], ThrottlingRateLimit: rate, ThrottlingBurstLimit: burst };
  return { apiUpdate: { ApiId: api.ApiId, CorsConfiguration }, stageUpdate: { ApiId: api.ApiId, StageName: stage.StageName, RouteSettings }, apiRollback: { ApiId: api.ApiId, CorsConfiguration: structuredClone(cors) }, stageRollback: { ApiId: api.ApiId, StageName: stage.StageName, RouteSettings: structuredClone(stage.RouteSettings || {}) } };
}
if (require.main === module) {
  const [apiPath, stagePath, outputDirectory] = process.argv.slice(2);
  if (!apiPath || !stagePath || !outputDirectory) throw Error('Usage: node stage-api-settings.cjs <api.json> <stage.json> <output-directory>');
  const result = stageApiSettings(JSON.parse(fs.readFileSync(apiPath, 'utf8')), JSON.parse(fs.readFileSync(stagePath, 'utf8')));
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [name, value] of Object.entries(result)) fs.writeFileSync(path.join(outputDirectory, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write('Wrote local API/stage change and rollback inputs. No AWS operation was executed.\n');
}
module.exports = { stageApiSettings };
