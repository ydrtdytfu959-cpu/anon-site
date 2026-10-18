'use strict';

// The existing EventBridge target sends exactly {action:'warm'}. Public HTTP
// events retain their existing CJ list/detail behavior in the maintained source.
const catalog = require('./cj-handler');
const WARM_LIMIT = 20;

exports.handler = async function handler(event = {}) {
  if (event?.action !== 'warm') return catalog.handler(event);
  if (Object.keys(event).length !== 1) throw Error('INVALID_WARM_EVENT');

  // One fixed Nike page. Never accept a query, advertiser or pagination loop
  // from a schedule event, and never route this operation through Channel3.
  const result = await catalog.handler({
    requestContext: {http: {method: 'GET'}},
    rawPath: '/catalog/products',
    queryStringParameters: {limit: String(WARM_LIMIT), offset: '0'}
  });
  if (result.statusCode !== 200) throw Error('CATALOG_WARM_FAILED');
  let body;
  try {body = JSON.parse(result.body);} catch {throw Error('CATALOG_WARM_FAILED');}
  if (body?.source !== 'CJ' || body.advertiser !== 'NIKE' || !Array.isArray(body.products) ||
      body.count !== body.products.length || body.count > WARM_LIMIT) throw Error('CATALOG_WARM_FAILED');
  if (!body.count) throw Error('CATALOG_WARM_EMPTY');
  // Throwing above makes failed refreshes visible to Lambda/EventBridge. Only
  // return success after all DynamoDB batches have acknowledged their writes.
  return {ok: true, source: 'CJ', advertiser: 'NIKE', warmed: body.count};
};
