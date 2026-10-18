'use strict';

// Maintained source of the verified deployed CJ-only catalog. See provenance.json
// and deployed-index.js for the exact source from the original Lambda package.
const {DynamoDBClient, GetItemCommand, BatchWriteItemCommand} = require('@aws-sdk/client-dynamodb');
const {SecretsManagerClient, GetSecretValueCommand} = require('@aws-sdk/client-secrets-manager');
const ddb = new DynamoDBClient({}), sm = new SecretsManagerClient({});
const TABLE = process.env.PRODUCTS_TABLE, SECRET = process.env.CJ_SECRET_ID;
const CID = process.env.CJ_COMPANY_ID, NIKE = process.env.NIKE_ADVERTISER_ID;
const URL = 'https://ads.api.cj.com/query';
const OFFICIAL_NIKE_ADVERTISER = '4942550';
const reply = (statusCode, body) => ({statusCode, headers: {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': statusCode === 200 ? 'public, max-age=120' : 'no-store'
}, body: JSON.stringify(body)});
let credentials = null, credentialsAt = 0;

async function auth() {
  if (credentials && Date.now() - credentialsAt < 300000) return credentials;
  const output = await sm.send(new GetSecretValueCommand({SecretId: SECRET}));
  let input;
  // JSON parser errors can contain fragments of the credential. Replace them
  // here, and never forward arbitrary SDK/provider exception text into logs.
  try {input = JSON.parse(output.SecretString || '{}');} catch {throw Error('CJ credentials unavailable');}
  if (!input || !input.token || !input.websiteId) throw Error('CJ credentials unavailable');
  credentials = {token: input.token, pid: String(input.websiteId)};
  credentialsAt = Date.now();
  return credentials;
}

function normalize(product) {
  return {
    productId: product.id, advertiserId: product.advertiserId,
    advertiserName: product.advertiserName, brand: product.brand || null,
    title: product.title || null, description: product.description || null,
    imageUrl: product.imageLink || null, productUrl: product.link || null,
    affiliateUrl: product.linkCode?.clickUrl || null, availability: product.availability || null,
    price: product.price?.amount != null ? Number(product.price.amount) : null,
    currency: product.price?.currency || null,
    salePrice: product.salePrice?.amount != null ? Number(product.salePrice.amount) : null,
    saleCurrency: product.salePrice?.currency || null, lastUpdated: product.lastUpdated || null
  };
}

function officialNikeProduct(product) {
  if (!product || product.advertiserId !== OFFICIAL_NIKE_ADVERTISER ||
      typeof product.advertiserName !== 'string' || product.advertiserName.trim().toUpperCase() !== 'NIKE' ||
      typeof product.productId !== 'string' || !product.productId ||
      typeof product.productUrl !== 'string' || product.productUrl.length > 2048) return false;
  try {
    const destination = new globalThis.URL(product.productUrl);
    return destination.protocol === 'https:' && !destination.username && !destination.password && !destination.port &&
      ['nike.com', 'www.nike.com'].includes(destination.hostname);
  } catch {return false;}
}

async function save(products) {
  for (let index = 0; index < products.length; index += 25) {
    let requests = products.slice(index, index + 25).map(product => ({PutRequest: {Item: {
      productId: {S: product.productId}, advertiserId: {S: product.advertiserId},
      lastUpdated: {S: product.lastUpdated || '1970-01-01T00:00:00.000Z'},
      syncedAt: {N: String(Date.now())}, payload: {S: JSON.stringify(product)}
    }}}));
    for (let attempt = 0; attempt < 3 && requests.length; attempt++) {
      const result = await ddb.send(new BatchWriteItemCommand({RequestItems: {[TABLE]: requests}}));
      requests = result.UnprocessedItems?.[TABLE] || [];
    }
    // The deployed source silently discarded these rows and claimed success.
    if (requests.length) throw Error('CJ cache write incomplete');
  }
}

async function search(options = {}) {
  if (NIKE !== OFFICIAL_NIKE_ADVERTISER) throw Error('CJ advertiser configuration invalid');
  const credential = await auth();
  const query = 'query Q($cid:ID!,$pid:ID!,$partners:[ID!],$keywords:[String!],$offset:Int,$limit:Int,$low:Float,$high:Float,$ids:[ID!]){shoppingProducts(companyId:$cid,partnerIds:$partners,keywords:$keywords,offset:$offset,limit:$limit,lowPrice:$low,highPrice:$high,productIds:$ids){totalCount count limit resultList{id advertiserId advertiserName title description brand imageLink link availability lastUpdated price{amount currency} salePrice{amount currency} linkCode(pid:$pid){clickUrl}}}}';
  const variables = {
    cid: CID, pid: credential.pid, partners: [NIKE], keywords: options.keywords || null,
    offset: options.offset ?? 0, limit: options.limit ?? 20, low: options.low ?? null,
    high: options.high ?? null, ids: options.ids || null
  };
  const response = await fetch(URL, {
    method: 'POST', headers: {Authorization: 'Bearer ' + credential.token,
      'Content-Type': 'application/json', Accept: 'application/json'},
    body: JSON.stringify({query, variables}), signal: AbortSignal.timeout(12000)
  });
  const text = await response.text();
  let result = null;
  try {result = JSON.parse(text);} catch {}
  if (!response.ok || result?.errors || !result?.data?.shoppingProducts) {
    console.error('CJ upstream', {status: Number.isInteger(response.status) ? response.status : 0,
      errors: Array.isArray(result?.errors) ? result.errors.length : 0});
    throw Error('CJ upstream');
  }
  return result.data.shoppingProducts;
}

exports.handler = async function handler(event = {}) {
  try {
    const method = event.requestContext?.http?.method || '';
    const path = event.rawPath || event.requestContext?.http?.path || '';
    const params = event.queryStringParameters || {};
    if (method === 'GET' && path === '/catalog/products') {
      const limit = Math.max(1, Math.min(50, parseInt(params.limit || '20', 10) || 20));
      const offset = Math.max(0, Math.min(5000, parseInt(params.offset || '0', 10) || 0));
      const query = String(params.q || '').trim().slice(0, 120);
      const low = params.minPrice == null ? null : Number(params.minPrice);
      const high = params.maxPrice == null ? null : Number(params.maxPrice);
      if (low != null && high != null && low > high) return reply(400, {error: 'minPrice must be <= maxPrice'});
      const data = await search({limit, offset, keywords: query ? [query] : null,
        low: Number.isFinite(low) ? low : null, high: Number.isFinite(high) ? high : null});
      // Bound writes even if the provider sends more rows than requested.
      const rows = (data.resultList || []).slice(0, limit), products = [], sourcePositions = [];
      for (const [index, product] of rows.entries()) {
        if (!product || typeof product !== 'object' || Array.isArray(product)) continue;
        const normalized = normalize(product);
        if (!officialNikeProduct(normalized)) continue;
        products.push(normalized);
        sourcePositions.push(offset + index);
      }
      await save(products);
      // Advance by examined provider rows, not accepted rows. Preserve original
      // absolute positions so partial-page consumers can resume without gaps.
      const rawCount = rows.length, endOffset = offset + rawCount;
      const nextOffset = rawCount > 0 && Number.isSafeInteger(data.totalCount) &&
        endOffset < data.totalCount && endOffset <= 5000 ? endOffset : null;
      return reply(200, {source: 'CJ', advertiser: 'NIKE', totalCount: data.totalCount,
        count: products.length, offset, limit, rawCount, nextOffset,
        products: products.map((product, index) => ({...product, sourceIndex: sourcePositions[index]}))});
    }
    if (method === 'GET' && path.startsWith('/catalog/products/')) {
      const id = decodeURIComponent(event.pathParameters?.productId || path.slice(18));
      const cached = await ddb.send(new GetItemCommand({TableName: TABLE, Key: {productId: {S: id}}}));
      if (cached.Item?.payload?.S && Date.now() - Number(cached.Item.syncedAt?.N || 0) < 21600000) {
        const product = JSON.parse(cached.Item.payload.S);
        if (officialNikeProduct(product) && product.productId === id) return reply(200, {source: 'cache', product});
      }
      const data = await search({ids: [id], limit: 1});
      const product = (data.resultList || [])[0];
      if (!product) return reply(404, {error: 'product not found'});
      const normalized = normalize(product);
      if (!officialNikeProduct(normalized) || normalized.productId !== id) throw Error('CJ product identity invalid');
      await save([normalized]);
      return reply(200, {source: 'CJ', product: normalized});
    }
    return reply(404, {error: 'route not found'});
  } catch {
    console.error('catalog_request_failed');
    return reply(502, {error: 'catalog upstream unavailable'});
  }
};
