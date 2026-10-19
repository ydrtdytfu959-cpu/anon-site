'use strict';
// Local-only planning tool. It never calls AWS and has no deployment mode.
const fs = require('node:fs');
const path = require('node:path');
function stageApiSettings(api, stage) {
  const cors = api?.CorsConfiguration;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
  if (!/^[a-z0-9]{10}$/.test(api?.ApiId || '') || stage?.StageName !== '$default' || !cors || JSON.stringify(cors.AllowOrigins) !== JSON.stringify(['https://anox.app']) || cors.AllowCredentials !== false || !strings(cors.AllowMethods) || JSON.stringify([...cors.AllowMethods].sort()) !== JSON.stringify(['GET', 'OPTIONS', 'POST', 'PUT']) || !strings(cors.AllowHeaders) || !['content-type', 'authorization'].every(header => cors.AllowHeaders.some(value => value.toLowerCase() === header)) || cors.AllowHeaders.some(value => !['content-type', 'authorization', 'idempotency-key'].includes(value.toLowerCase())) || (cors.ExposeHeaders !== undefined && (!strings(cors.ExposeHeaders) || cors.ExposeHeaders.some(value => !['idempotency-replayed', 'retry-after'].includes(value.toLowerCase())))) || (stage.RouteSettings !== undefined && (!record(stage.RouteSettings) || !Object.values(stage.RouteSettings).every(record)))) throw Error('Verified API/stage metadata with the existing https://anox.app CORS policy is required. Review configuration drift before preparing changes.');
  const add = (values, additions) => {
    const result = [...values]; for (const addition of additions) if (!result.some(value => value.toLowerCase() === addition.toLowerCase())) result.push(addition); return result;
  };
  const CorsConfiguration = { ...structuredClone(cors), AllowHeaders: add(cors.AllowHeaders, ['Idempotency-Key']), ExposeHeaders: add(cors.ExposeHeaders || [], ['Idempotency-Replayed', 'Retry-After']) };
  const RouteSettings = structuredClone(stage.RouteSettings || {});
  const limits = { 'GET /commerce/capabilities': [10, 20], 'POST /commerce/quotes': [2, 4], 'POST /commerce/checkout-attempts': [2, 4], 'POST /commerce/service-requests': [2, 4], 'GET /commerce/orders': [5, 10], 'GET /commerce/orders/{orderId}': [5, 10], 'POST /commerce/orders/{orderId}/cancel': [2, 4], 'POST /commerce/orders/{orderId}/refund': [2, 4] };
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
