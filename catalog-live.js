(function exposeCatalogLive(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AnoXLiveCatalog = api;
})(typeof globalThis === "object" ? globalThis : this, function createCatalogLive() {
  "use strict";

  const API_BASE = "https://zmumi2wruk.execute-api.us-east-2.amazonaws.com/catalog";
  const CHANNEL3_API_BASE = "https://zmumi2wruk.execute-api.us-east-2.amazonaws.com/catalog/search";
  const IMAGE_HOSTS = Object.freeze(["static.nike.com","cdn.trychannel3.com"]);
  const provider = Object.freeze({id:"nike-live", merchant:"Nike", mode:"live", transport:"api", sourceType:"affiliate-feed", authorization:Object.freeze({status:"unverified",evidence:null}), approvedLive:false, imageHosts:Object.freeze(["static.nike.com"]), merchantHosts:Object.freeze(["nike.com","www.nike.com"]), staleAfterMs:86400000});
  const channel3Provider = Object.freeze({id:"channel3-live", merchant:"Channel3", mode:"live", transport:"api", pagination:"cursor", timeoutMs:18000, sourceType:"catalog-api", authorization:Object.freeze({status:"provider-terms",evidence:"Channel3 customer output"}), approvedLive:false, imageHosts:Object.freeze(["cdn.trychannel3.com"]), merchantHosts:Object.freeze(["buy.trychannel3.com"]), staleAfterMs:86400000});
  const CHANNEL3_SECTIONS = Object.freeze(["featured","men","women","shoes","clothing","beauty","accessories","sports","brands"]);
  const MAX_BYTES=2*1024*1024;
  let retryAt=0;
  const DEFAULT_LIMIT = 24;

  const stringValue = value => typeof value === "string" ? value.trim() : "";
  const firstValue = (...values) => values.find(value => value !== undefined && value !== null && value !== "");

  function numberValue(value) {
    if(typeof value==="number")return Number.isFinite(value)?value:NaN;
    if(typeof value!=="string"||!/^\d+(?:\.\d+)?$/.test(value.trim()))return NaN;
    return Number(value);
  }
  // The existing endpoint contract uses USD major units. Never guess cents by magnitude.
  function cents(value) {
    const amount=numberValue(value), minor=Math.round(amount*100);
    return amount>=0 && amount<=1e6 && Number.isSafeInteger(minor) && Math.abs(amount*100-minor)<1e-6 ? minor : null;
  }

  function localized(value, fallback = "Nike product") {
    if (value && typeof value === "object") {
      const ar = stringValue(firstValue(value.ar, value.arabic, value.nameAr));
      const en = stringValue(firstValue(value.en, value.english, value.nameEn));
      return { ar: ar || en || fallback, en: en || ar || fallback };
    }
    const text = stringValue(value) || fallback;
    return { ar: text, en: text };
  }

  function normalizedDate(value) {
    if(typeof value!=="string"||!value.trim())return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function safeHttpsUrl(value) {
    try {
      const url = new URL(stringValue(value));
      return url.protocol === "https:" && !url.username && !url.password && !url.port ? url.href : "";
    } catch {
      return "";
    }
  }

  function trustedImageUrl(value) {
    const url = safeHttpsUrl(value);
    if (!url) return "";
    try {
      return IMAGE_HOSTS.includes(new URL(url).hostname.toLowerCase()) ? url : "";
    } catch {
      return "";
    }
  }

  function imageCandidates(raw) {
    const values = [raw.image, raw.imageUrl, raw.thumbnail, raw.thumbnailUrl, raw.primaryImage];
    const images = Array.isArray(raw.images) ? raw.images : [];
    for (const image of images.slice(0,8)) values.push(typeof image === "string" ? image : image?.url || image?.src || image?.imageUrl);
    return [...new Set(values.map(trustedImageUrl).filter(Boolean))].slice(0,8);
  }

  function safeKey(value, fallback) {
    const key = stringValue(value).replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    return key || fallback;
  }

  function categoryFor(raw) {
    const value = stringValue(firstValue(raw.category, raw.categoryName, raw.productType)).toLowerCase();
    if (value.includes("shoe") || value.includes("run") || value.includes("foot")) return "Shoes";
    if (value.includes("sport") || value.includes("training")) return "Sports";
    if (value.includes("access")) return "Accessories";
    return "Fashion";
  }

  function kindFor(raw) {
    const value = safeKey(firstValue(raw.kind, raw.productType, raw.category), "product").toLowerCase();
    return /^[a-z][a-z0-9-]{0,29}$/.test(value) ? value : "product";
  }

  function stockFor(raw) {
    const value=numberValue(firstValue(raw.stock,raw.quantity,raw.availableQuantity));
    return Number.isSafeInteger(value)&&value>=0&&value<=100000?value:0;
  }
  function availabilityFor(raw) {
    const value=stringValue(firstValue(raw.availability,raw.availabilityStatus,raw.stockStatus)).toLowerCase().replace(/[_-]/g," ");
    if(["in stock","available","limited availability"].includes(value))return "in_stock";
    if(["out of stock","unavailable","sold out"].includes(value))return "out_of_stock";
    return "unknown";
  }
  function variantsFor(raw) {
    if(!Array.isArray(raw.variants))return [];
    const seen=new Set();
    return raw.variants.slice(0,120).flatMap(v=>{
      if(!v||typeof v!=="object")return [];
      const color=stringValue(v.color),size=stringValue(v.size),key=JSON.stringify([color,size]);
      if(!color||!size||color.length>80||size.length>80||seen.has(key))return [];
      seen.add(key);return [{color,size,stock:stockFor(v)}];
    });
  }

  function normalizeNikeProduct(raw, index = 0, fetchedAt = new Date().toISOString()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const rawBrand = stringValue(firstValue(raw.brand, raw.brandName));
    if(stringValue(raw.currency).toUpperCase()!=="USD")return null;
    if(raw.salePrice!=null&&raw.saleCurrency&&stringValue(raw.saleCurrency).toUpperCase()!=="USD")return null;
    if (rawBrand.toLowerCase() !== "nike") return null;
    const name = localized(firstValue(raw.name, raw.title, raw.productName), "");
    if(!name.en||name.en.length>200||name.ar.length>200)return null;
    const id = stringValue(firstValue(raw.id, raw.productId, raw.sku));
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))return null;
    const slug = id; // stable identity allows direct-load hydration without guessing a title
    const originalPriceCents = cents(firstValue(raw.compareAtPrice, raw.originalPrice, raw.listPrice, raw.regularPrice, raw.price));
    const salePriceCents = cents(firstValue(raw.salePrice, raw.discountPrice, raw.currentPrice, raw.finalPrice));
    const priceCents = salePriceCents !== null && (originalPriceCents === null || salePriceCents < originalPriceCents) ? salePriceCents : originalPriceCents;
    if (priceCents === null) return null;
    const stock = stockFor(raw);
    const updatedAt = normalizedDate(firstValue(raw.updatedAt, raw.lastUpdated, raw.modifiedAt));
    if(updatedAt&&Date.parse(updatedAt)>Date.now()+60000)return null;
    const merchantUrl = safeHttpsUrl(firstValue(raw.productUrl, raw.url, raw.link, raw.merchantUrl));
    if(!merchantUrl||!provider.merchantHosts.includes(new URL(merchantUrl).hostname.toLowerCase()))return null;
    const media = imageCandidates(raw).map(url => ({ url, alt: name, width: 420, height: 390 }));
    const knownVariants=variantsFor(raw);
    const variants = knownVariants.length?knownVariants:[{color:"Unspecified",size:"Unspecified",stock:0}];
    const effectiveStock = variants.reduce((total, variant) => total + variant.stock, 0);
    return {
      id,
      slug,
      name,
      brand: "Nike",
      category: categoryFor(raw),
      kind: kindFor(raw),
      currency:"USD",
      priceCents,
      compareAtPriceCents: originalPriceCents !== null && originalPriceCents > priceCents ? originalPriceCents : null,
      weightGrams: Number.isSafeInteger(raw.weightGrams)&&raw.weightGrams>0&&raw.weightGrams<=1000000?raw.weightGrams:0,
      variantDetailsKnown:knownVariants.length>0,
      stock: effectiveStock,
      variants,
      media,
      description: localized(firstValue(raw.description, raw.details, name), name.en),
      updatedAt,
      availability: availabilityFor(raw),
      source: {
        merchantUrl,
        verifiedAt: updatedAt||fetchedAt, // compatibility provenance field, not an authorization claim
        fetchedAt, authorization:"unverified", sourceType:"affiliate-feed",
        availabilityVerifiedAt: null,
        availability: updatedAt?"reported":"unknown"
      },
      purchasable: false
    };
  }

  function rawItems(payload) {
    if(Array.isArray(payload))return payload;
    if(!payload||typeof payload!=="object")throw Error("catalog_payload");
    for(const key of ["items","products","results","data"])if(Array.isArray(payload[key]))return payload[key];
    throw Error("catalog_payload");
  }
  function optionsValid({q="",limit=DEFAULT_LIMIT,offset=0}={}) {
    if(typeof q!=="string"||q.length>500||!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw Error("catalog_options");
    return {q:q.trim(),limit,offset};
  }
  function buildCatalogUrl(options={}) {
    const {q,limit,offset}=optionsValid(options);
    const params=[`limit=${limit}`,`offset=${offset}`];if(q)params.unshift(`q=${encodeURIComponent(q)}`);
    return `${API_BASE}/products?${params.join("&")}`;
  }
  function parseCatalogPage(payload, options={}) {
    const {q,limit,offset}=optionsValid(options),raw=rawItems(payload);
    if(raw.length>100||raw.length>limit)throw Error("catalog_record_limit");
    const fetchedAt=new Date().toISOString(),items=raw.map((x,i)=>normalizeNikeProduct(x,offset+i,fetchedAt)).filter(Boolean);
    const totalValue=numberValue(firstValue(payload.totalCount,payload.total,payload.count));
    const total=Number.isSafeInteger(totalValue)&&totalValue>=0&&totalValue<=10000000?Math.max(offset+raw.length,totalValue):offset+raw.length;
    let nextOffset=payload.nextOffset===null?null:payload.nextOffset===undefined?(raw.length&&offset+raw.length<total?offset+raw.length:null):numberValue(payload.nextOffset);
    if(nextOffset!==null&&(!Number.isSafeInteger(nextOffset)||nextOffset<=offset||nextOffset>100000||!raw.length))throw Error("catalog_pagination");
    return {q,limit,offset,items,total,nextOffset,invalidCount:raw.length-items.length,fetchedAt};
  }
  async function readJson(url,signal,timeoutMs=8000) {
    if(signal?.aborted)throw Error("catalog_aborted");
    if(Date.now()<retryAt)throw Error("catalog_rate_limited");
    const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,timeoutMs);
    signal?.addEventListener("abort",abort,{once:true});
    try{
      const response=await fetch(url,{credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer",redirect:"error",signal:controller.signal});
      if(response.status===429){const header=response.headers.get("retry-after"),seconds=Number(header);retryAt=Date.now()+Math.min(300000,Math.max(1000,Number.isFinite(seconds)?seconds*1000:(Date.parse(header)-Date.now())||30000));throw Error("catalog_rate_limited");}
      if(!response.ok)throw Error(`catalog_http_${response.status}`);
      if(!/application\/(?:[a-z0-9.-]+\+)?json/i.test(response.headers.get("content-type")||"")||Number(response.headers.get("content-length"))>MAX_BYTES)throw Error("catalog_payload_limit");
      const reader=response.body?.getReader();if(!reader)throw Error("catalog_payload");
      let size=0,body="";const decoder=new TextDecoder();
      for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error("catalog_payload_limit");}body+=decoder.decode(value,{stream:true});}
      body+=decoder.decode();return JSON.parse(body);
    } finally {clearTimeout(timer);signal?.removeEventListener("abort",abort);controller.abort();}
  }

  async function fetchPage(options={}) {return parseCatalogPage(await readJson(buildCatalogUrl(options),options.signal),options);}
  async function getProduct(productId,options={}) {
    if(typeof productId!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(productId))throw Error("catalog_identity");
    const payload=await readJson(`${API_BASE}/products/${encodeURIComponent(productId)}`,options.signal);
    const record=payload?.product||payload?.data||payload;
    const product=normalizeNikeProduct(record);if(!product||product.id!==productId)throw Error("catalog_identity");return product;
  }


  function channel3Category(raw) {
    const path=Array.isArray(raw?.category?.path)?raw.category.path.map(entry=>stringValue(entry?.title)).filter(Boolean):[];
    const value=[stringValue(raw?.category?.title),...path].join(" ").toLowerCase();
    if(/shoe|sneaker|boot|footwear/.test(value))return "Shoes";
    if(/beauty|cosmetic|skin|fragrance|makeup/.test(value))return "Beauty";
    if(/accessor|bag|watch|jewel|eyewear/.test(value))return "Accessories";
    if(/sport|fitness|training|outdoor/.test(value))return "Sports";
    return "Fashion";
  }
  function channel3Brand(raw){
    const brands=Array.isArray(raw?.brands)?raw.brands:[];
    return stringValue(brands.find(entry=>stringValue(entry?.name))?.name)||"Brand";
  }
  // A product is in the public catalog only when its source declares one of
  // four approved brands, or a fresh offer identifies an approved retailer.
  // Titles and search terms are NEVER evidence of brand or retailer identity.
  const APPROVED_BRANDS=Object.freeze({nike:"Nike",adidas:"Adidas",levis:"Levi's",elf:"e.l.f. Cosmetics",elfcosmetics:"e.l.f. Cosmetics"});
  // Strict direct retailer attribution, not any marketplace carrying a branded item.
  // Buy links are Channel3-managed HTTPS redirects, never an invented store URL.
  const OFFICIAL_STORES=Object.freeze({
    Nike:["nike.com","www.nike.com"],
    Adidas:["adidas.com","www.adidas.com"],
    "Levi's":["levi.com","www.levi.com"],
    "e.l.f. Cosmetics":["elfcosmetics.com","www.elfcosmetics.com"],
    Sephora:["sephora.com","www.sephora.com"],
    "TJ Maxx":["tjmaxx.tjx.com","www.tjmaxx.tjx.com","tjmaxx.com","www.tjmaxx.com"]
  });
  const FEATURED_SOURCES=Object.freeze([
    ["Nike","Nike"],["Adidas","adidas"],["Levi's","Levi's"],
    ["e.l.f. Cosmetics","e.l.f. cosmetics"],["Sephora","Sephora"],["TJ Maxx","TJ Maxx"]
  ]);
  const SECTION_QUERIES=Object.freeze({
    men:"Levi's men",women:"Nike women",shoes:"adidas",clothing:"Levi's",
    beauty:"e.l.f. cosmetics",accessories:"Nike accessories",sports:"Nike sports",brands:"Sephora"
  });
  const OFFICIAL_DOMAINS=new Set(Object.values(OFFICIAL_STORES).flat());
  function officialOffers(raw) {
    return (Array.isArray(raw?.offers)?raw.offers:[]).filter(offer=>{
      const domain=stringValue(offer?.domain).toLowerCase();
      const url=safeHttpsUrl(offer?.url);
      return OFFICIAL_DOMAINS.has(domain)&&url&&new URL(url).hostname.toLowerCase()==="buy.trychannel3.com";
    });
  }
  function approvedBrand(raw){
    for(const entry of (Array.isArray(raw?.brands)?raw.brands:[]).slice(0,16)){
      const name=stringValue(entry?.name).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g,"");
      if(Object.hasOwn(APPROVED_BRANDS,name))return APPROVED_BRANDS[name];
    }
    return null;
  }
  function approvedRetailerOffers(raw){return officialOffers(raw).filter(o=>
    OFFICIAL_STORES.Sephora.includes(stringValue(o.domain).toLowerCase())||
    OFFICIAL_STORES["TJ Maxx"].includes(stringValue(o.domain).toLowerCase())
  );}
  function approvedSellerDomains(raw) {
    const brand=approvedBrand(raw);
    const fromOffers=officialOffers(raw).map(o=>stringValue(o.domain).toLowerCase());
    const fromCache=(Array.isArray(raw?.sellerDomains)?raw.sellerDomains:[])
      .slice(0,6).map(v=>stringValue(v).toLowerCase()).filter(d=>OFFICIAL_DOMAINS.has(d));
    const retail=[...OFFICIAL_STORES.Sephora,...OFFICIAL_STORES["TJ Maxx"]];
    return [...new Set([...fromOffers,...fromCache])].filter(d=>
      (brand&&OFFICIAL_STORES[brand].includes(d))||retail.includes(d));
  }
  function approvedOfficialOffers(raw){
    const allowed=new Set(approvedSellerDomains(raw));
    return officialOffers(raw).filter(o=>allowed.has(stringValue(o.domain).toLowerCase()));
  }
  function normalizeChannel3Product(raw,index=0,fetchedAt=new Date().toISOString()){
    if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
    const id=stringValue(raw.id),title=stringValue(raw.title);if(!/^[A-Za-z0-9_-]{1,80}$/.test(id)||!title||title.length>200)return null;
    const sellers=approvedSellerDomains(raw);
    if(!sellers.length)return null;
    const retailer=sellers[0];
    const label=Object.entries(OFFICIAL_STORES).find(([,domains])=>domains.includes(retailer))?.[0];
    if(!label)return null;
    // Ignore volatile fields even from an older backend during rollout.
    const name=localized(title,title);
    const media=(Array.isArray(raw.images)?raw.images:[]).slice(0,1).flatMap(image=>{const url=trustedImageUrl(firstValue(image?.cleaned_url,image?.url));if(!url)return [];return [{url,alt:localized(stringValue(image?.alt_text)||title,title),width:420,height:390}];});
    const category=channel3Category(raw),kind=safeKey(firstValue(raw?.category?.slug,raw?.category?.title,category),"product").toLowerCase();
    return {id,slug:id,name,brand:label,category,kind:/^[a-z][a-z-]{0,29}$/.test(kind)?kind:"product",currency:"USD",priceCents:null,presentationOnly:true,
      compareAtPriceCents:null,weightGrams:0,variantDetailsKnown:false,stock:null,variants:[],media,
      description:localized(firstValue(raw.description,Array.isArray(raw.key_features)?raw.key_features.join(". "):"",title),title),updatedAt:fetchedAt,
      availability:"unknown",
      source:{merchantUrl:null,merchantDomain:null,verifiedAt:null,fetchedAt,availabilityVerifiedAt:null,availability:"unknown",sourceType:"catalog-api"},
      purchasable:false};
  }
  function catalogError(code, status) {
    const error = new Error(code);
    error.code = code;
    if (status !== undefined) error.status = status;
    return error;
  }

  function channel3Cursor(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !value.length || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) {
      throw catalogError("catalog_cursor_invalid");
    }
    // A lone surrogate cannot be serialized without changing the opaque token.
    try { encodeURIComponent(value); } catch { throw catalogError("catalog_cursor_invalid"); }
    return value;
  }

  function channel3Options({ q = "", section = "", limit = DEFAULT_LIMIT, cursor = null, filters = {} } = {}) {
    if (typeof q !== "string" || /[\u0000-\u001f\u007f]/.test(q) ||
        typeof section !== "string" || !Number.isSafeInteger(limit) || limit < 1 || limit > 24) {
      throw catalogError("catalog_options");
    }
    try { encodeURIComponent(q); } catch { throw catalogError("catalog_options"); }
    q = q.normalize("NFC").trim().replace(/\s+/gu, " ");
    if (q.length > 100) throw catalogError("catalog_options");
    if (q && section || section && !CHANNEL3_SECTIONS.includes(section)) throw catalogError("catalog_options");
    if (!q) section = section || "featured";
    if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw catalogError("catalog_options");
    const allowed = { availability: ["InStock", "OutOfStock"], conditions: ["new", "used"] }, clean = {};
    for (const key of Object.keys(filters).sort()) {
      const values = filters[key];
      if (!Object.hasOwn(allowed, key) || !Array.isArray(values) || !values.length || values.length > 2 ||
          values.some(value => !allowed[key].includes(value))) throw catalogError("catalog_options");
      clean[key] = [...new Set(values)].sort();
    }
    return { q, section, limit, cursor: channel3Cursor(cursor), filters: clean };
  }

  function buildChannel3Url(options = {}) {
    const { q, section, limit, cursor, filters } = channel3Options(options);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    else if(section!=="featured") params.set("q",SECTION_QUERIES[section]);
    else params.set("section", section);
    params.set("limit", String(limit));
    if (cursor !== null) params.set("page_token", cursor);
    if (Object.keys(filters).length) params.set("filters", JSON.stringify(filters));
    return CHANNEL3_API_BASE + "?" + params.toString();
  }

  function parseChannel3Page(payload, options = {}) {
    const { q, section, limit } = channel3Options(options);
    const data = payload?.data;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.provider !== "channel3" ||
        !data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.products) ||
        !Object.hasOwn(data, "next_page_token")) throw catalogError("catalog_payload");
    const raw = data.products;
    if (raw.length > limit) throw catalogError("catalog_record_limit");
    const nextCursor = channel3Cursor(data.next_page_token);
    const fetchedAt = normalizedDate(payload.fetchedAt), expiresAt = normalizedDate(payload.expiresAt), now = Date.now();
    if (!fetchedAt || !expiresAt || Date.parse(fetchedAt) > now + 60000 ||
        Date.parse(expiresAt) <= Date.parse(fetchedAt) ||
        Date.parse(expiresAt) - Date.parse(fetchedAt) > (q ? 300000 : 600000)) throw catalogError("catalog_payload");
    if (Date.parse(expiresAt) <= now) throw catalogError("catalog_expired");
    const items = raw.map((item, index) => normalizeChannel3Product(item, index, fetchedAt)).filter(Boolean);
    return { q, section, limit, items, total: null, nextCursor, fetchedAt, expiresAt, invalidCount: raw.length - items.length };
  }

  function parseMixedCursor(value){
    if(value===null)return Array(6).fill(null);
    let obj;try{obj=JSON.parse(value);}catch{throw catalogError("catalog_cursor_invalid",400);}
    if(!record(obj)||obj.v!==1||!Array.isArray(obj.c)||obj.c.length!==6||
       obj.c.some(v=>v!==null&&(typeof v!=="string"||v.length>1024)))throw catalogError("catalog_cursor_invalid",400);
    return obj.c;
  }
  function shuffleRoundRobin(groups){
    const order=groups.map((_,i)=>i);
    for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    const items=[];for(let pos=0;pos<4;pos++)for(const i of order)if(groups[i][pos])items.push(groups[i][pos]);
    return items;
  }
  async function fetchMixedPage(normalized,signal){
    const cursors=parseMixedCursor(normalized.cursor);
    const groups=Array(6).fill(null).map(()=>[]);
    const next=cursors.slice();let errors=0,firstDate=null,lastDate=null;
    // Three simultaneous reads at most; two bounded waves, no unbounded prefetch.
    for(let start=0;start<6;start+=3){
      const results=await Promise.allSettled(FEATURED_SOURCES.slice(start,start+3).map(async([,query],offset)=>{
        const i=start+offset;
        if(cursors[i]==="")return null;
        const url=buildChannel3Url({q:query,limit:4,cursor:cursors[i],filters:normalized.filters});
        const page=parseChannel3Page(await readJson(url,signal,channel3Provider.timeoutMs),{q:query,limit:4});
        return page;
      }));
      results.forEach((res,k)=>{
        const i=start+k;
        if(res.status==="rejected"){errors++;next[i]=cursors[i];return;}
        if(!res.value){next[i]="";return;}
        groups[i]=res.value.items;
        next[i]=res.value.nextCursor??"";
        firstDate=firstDate&&Date.parse(firstDate)<Date.parse(res.value.fetchedAt)?firstDate:res.value.fetchedAt;
        lastDate=lastDate&&Date.parse(lastDate)<Date.parse(res.value.expiresAt)?lastDate:res.value.expiresAt;
      });
    }
    if(signal?.aborted){const aborted=new Error("catalog_aborted");aborted.name="AbortError";throw aborted;}
    if(errors===6)throw catalogError("catalog_unavailable",503);
    const items=shuffleRoundRobin(groups);
    // Keep partially successful results; never invent a cursor when all six are exhausted.
    const nextCursor=next.every(v=>v==="")?null:JSON.stringify({v:1,c:next});
    return {q:"",section:"featured",limit:normalized.limit,items,total:null,nextCursor,
      fetchedAt:firstDate||new Date().toISOString(),expiresAt:lastDate||new Date(Date.now()+60000).toISOString(),
      invalidCount:0,partialErrors:errors};
  }
  async function fetchChannel3Page(options = {}) {
    const normalized = channel3Options(options);
    try {
      if(!normalized.q&&normalized.section==="featured")return await fetchMixedPage(normalized,options.signal);
      return parseChannel3Page(await readJson(buildChannel3Url(normalized), options.signal, channel3Provider.timeoutMs), normalized);
    } catch (error) {
      // The backend classifies unusable continuations without exposing provider diagnostics.
      if (normalized.cursor !== null && error.message === "catalog_http_400") throw catalogError("catalog_cursor_invalid", 400);
      if (normalized.cursor !== null && error.message === "catalog_http_410") throw catalogError("catalog_cursor_expired", 410);
      throw error;
    }
  }

  const detailIdentity = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function detailSelection(input = {}) {
    if (!record(input) || Object.keys(input).length > 8) throw catalogError("catalog_options");
    const output = {};
    for (const name of Object.keys(input).sort()) {
      const value = input[name];
      if (!name.trim() || name.length > 60 || ["__proto__", "constructor", "prototype"].includes(name) || typeof value !== "string" || !value.trim() || value.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(name + value)) throw catalogError("catalog_options");
      try {encodeURIComponent(name); encodeURIComponent(value);} catch {throw catalogError("catalog_options");}
      output[name] = value;
    }
    return output;
  }
  function buildChannel3DetailUrl(productId, options = {}) {
    if (!detailIdentity(productId)) throw catalogError("catalog_identity");
    const params = new URLSearchParams();
    for (const [name, label] of Object.entries(detailSelection(options))) params.set("option_" + name, label);
    return API_BASE + "/channel3/products/" + productId + (params.size ? "?" + params.toString() : "");
  }
  function detailList(value, max) {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value) || value.length > max) throw catalogError("catalog_payload");
    return value;
  }
  function detailString(value, max, required = false) {
    if (value === null || value === undefined) {if (required) throw catalogError("catalog_payload"); return null;}
    if (typeof value !== "string" || value.length > max || required && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw catalogError("catalog_payload");
    try {encodeURIComponent(value);} catch {throw catalogError("catalog_payload");}
    return value;
  }
  function detailUrl(value, hostname) {
    if (typeof value !== "string" || value.length > 2048) return "";
    const url = safeHttpsUrl(value);
    return url && new URL(url).hostname === hostname ? url : "";
  }
  const detailAvailability = value => value === "InStock" ? "in_stock" : value === "OutOfStock" ? "out_of_stock" : "unknown";
  function detailCents(value) {
    if (typeof value !== "number" || value < 0 || value > 1e6 || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value))) return null;
    const [whole, decimal = ""] = String(value).split(".");
    return Number(BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0")));
  }
  function detailMeasurements(value) {
    if (!record(value)) return null;
    return Object.fromEntries(["length", "width", "height", "weight"].map(name => {
      const field = value[name], units = name === "weight" ? ["mg", "g", "kg", "oz", "lb"] : ["mm", "cm", "m", "in", "ft"];
      return [name, record(field) && typeof field.number === "number" && Number.isFinite(field.number) && field.number > 0 && field.number <= 1e9 && units.includes(field.unit) ? {number:field.number, unit:field.unit} : null];
    }));
  }
  function parseChannel3Detail(payload, productId, {options = {}} = {}) {
    const requested = detailSelection(options), raw = payload?.data?.product;
    if (!detailIdentity(productId) || !record(payload) || payload.provider !== "channel3" || !record(raw) || raw.id !== productId || !["fresh", "presentation_only"].includes(payload.status)) throw catalogError("catalog_payload");
    const fresh = payload.status === "fresh", fetchedAt = normalizedDate(payload.fetchedAt), expiresAt = normalizedDate(payload.expiresAt), time = Date.now();
    if (!fetchedAt || !expiresAt || Date.parse(fetchedAt) > time + 60000 || Date.parse(expiresAt) <= Date.parse(fetchedAt) || Date.parse(expiresAt) - Date.parse(fetchedAt) > (fresh ? 30000 : 3600000) || payload.error !== (fresh ? null : "DETAIL_REFRESH_UNAVAILABLE")) throw catalogError("catalog_payload");
    if (Date.parse(expiresAt) <= time) throw catalogError("catalog_expired");
    const title = detailString(raw.title, 200, true), names = new Set();
    if (raw.variants != null && !record(raw.variants)) throw catalogError("catalog_payload");
    const variantOptions = detailList(raw.variants?.options, 8).map(option => {
      if (!record(option) || typeof option.name !== "string" || names.has(option.name)) throw catalogError("catalog_payload");
      detailSelection({[option.name]:"value"}); names.add(option.name); const labels = new Set();
      return {name:option.name, values:detailList(option.values, 120).map(value => {
        if (!record(value) || labels.has(value.label) || typeof value.exists !== "boolean") throw catalogError("catalog_payload");
        detailSelection({[option.name]:value.label}); labels.add(value.label);
        return {label:value.label, exists:value.exists, availability:fresh ? detailAvailability(value.available) : "unknown", thumbnailUrl:detailUrl(value.thumbnail_url, "cdn.trychannel3.com") || null, productId:detailIdentity(value.product_id) ? value.product_id : null};
      })};
    });
    const selectedNames = new Set(), selected = detailList(raw.variants?.selected, 8).map(value => {
      const option = record(value) && variantOptions.find(option => option.name === value.name);
      if (!option || selectedNames.has(value.name) || !option.values.some(entry => entry.label === value.label)) throw catalogError("catalog_payload");
      selectedNames.add(value.name); return {name:value.name, label:value.label};
    });
    const effective = new Map(selected.map(value => [value.name, value.label]));
    const selectionMismatch = Object.entries(requested).filter(([name, label]) => effective.get(name) !== label).map(([name, requested]) => ({name, requested, effective:effective.get(name) ?? null}));
    if (JSON.stringify(selectionMismatch) !== JSON.stringify(payload.selectionMismatch)) throw catalogError("catalog_selection_mismatch");
    const attributes = raw.structured_attributes ?? {};
    if (!record(attributes) || Object.keys(attributes).length > 64) throw catalogError("catalog_payload");
    const structuredAttributes = {};
    for (const [name, values] of Object.entries(attributes)) {
      if (!name.trim() || name.length > 80 || ["__proto__", "constructor", "prototype"].includes(name)) throw catalogError("catalog_payload");
      structuredAttributes[name] = detailList(values, 64).map(value => detailString(value, 1000, true));
    }
    const official=approvedOfficialOffers(raw);
    if(fresh?!official.length:!approvedSellerDomains(raw).length)throw catalogError("catalog_not_approved",403);
    const offers = detailList(official, 64).filter(record).flatMap(offer => {
      const url = detailUrl(offer.url, "buy.trychannel3.com"), merchantDomain = typeof offer.domain === "string" ? offer.domain.toLowerCase() : "";
      if (!fresh || !url || merchantDomain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(merchantDomain)) return [];
      const currency = offer.price?.currency === "USD" ? "USD" : null;
      return [{merchantDomain, url, priceCents:currency ? detailCents(offer.price.price) : null, compareAtPriceCents:currency ? detailCents(offer.price.compare_at_price) : null, currency,
        availability:detailAvailability(offer.availability), condition:["new", "used"].includes(offer.condition) ? offer.condition : null,
        maxCommissionRate:typeof offer.max_commission_rate === "number" && offer.max_commission_rate >= 0 && offer.max_commission_rate <= 1 ? offer.max_commission_rate : null, dimensions:detailMeasurements(offer.dimensions)}];
    });
    const category = record(raw.category) ? {slug:detailString(raw.category.slug, 100), title:detailString(raw.category.title, 100), path:detailList(raw.category.path, 16).filter(record).map(part => ({slug:detailString(part.slug, 100), title:detailString(part.title, 100)}))} : null;
    return {schema:"anox.product-detail/1", provider:"channel3", id:productId, slug:productId, title, description:detailString(raw.description, 60000),
      brands:detailList(raw.brands, 16).filter(record).map(brand => ({id:detailString(brand.id, 200, true), name:detailString(brand.name, 100, true)})),
      images:detailList(raw.images, 64).filter(record).flatMap(image => {const url = detailUrl(image.url, "cdn.trychannel3.com"); return url ? [{url, altText:detailString(image.alt_text, 500) || title, isMainImage:image.is_main_image === true, shotType:detailString(image.shot_type, 40)}] : [];}),
      category, gender:["male", "female"].includes(raw.gender) ? raw.gender : null, age:["newborn", "infant", "toddler", "kids", "adult"].includes(raw.age) ? raw.age : null,
      materials:detailList(raw.materials, 64).map(value => detailString(value, 2000, true)), keyFeatures:detailList(raw.key_features, 64).map(value => detailString(value, 2000, true)), structuredAttributes,
      offers, variants:{options:variantOptions, selected}, stock:null, purchasable:false, freshness:{status:payload.status, fetchedAt, expiresAt}, selectionMismatch, error:payload.error};
  }
  async function getChannel3Product(productId, {options = {}, signal} = {}) {
    const selected = detailSelection(options);
    return parseChannel3Detail(await readJson(buildChannel3DetailUrl(productId, selected), signal, channel3Provider.timeoutMs), productId, {options:selected});
  }

  return Object.freeze({ provider, nikeProvider: provider, channel3Provider, API_BASE, CHANNEL3_API_BASE, IMAGE_HOSTS, buildCatalogUrl, buildChannel3Url, getProduct, normalizeNikeProduct, normalizeChannel3Product, parseCatalogPage, parseChannel3Page, fetchPage, fetchChannel3Page, buildChannel3DetailUrl, parseChannel3Detail, getChannel3Product });
});
