(function exposeCatalogLive(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AnoXLiveCatalog = api;
})(typeof globalThis === "object" ? globalThis : this, function createCatalogLive() {
  "use strict";

  const API_BASE = "https://zmumi2wruk.execute-api.us-east-2.amazonaws.com/catalog";
  const IMAGE_HOSTS = new Set(["static.nike.com"]);
  const DEFAULT_LIMIT = 24;

  const stringValue = value => typeof value === "string" ? value.trim() : "";
  const firstValue = (...values) => values.find(value => value !== undefined && value !== null && value !== "");

  function numberValue(value) {
    if (value && typeof value === "object") return numberValue(firstValue(value.amount, value.value, value.price));
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const normalized = String(value ?? "").replace(/[^0-9.-]/g, "");
    const parsed = normalized ? Number(normalized) : NaN;
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function cents(value) {
    const amount = numberValue(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return amount >= 10000 ? Math.round(amount) : Math.round(amount * 100);
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
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function safeHttpsUrl(value) {
    try {
      const url = new URL(stringValue(value));
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch {
      return "";
    }
  }

  function trustedImageUrl(value) {
    const url = safeHttpsUrl(value);
    if (!url) return "";
    try {
      return IMAGE_HOSTS.has(new URL(url).hostname.toLowerCase()) ? url : "";
    } catch {
      return "";
    }
  }

  function imageCandidates(raw) {
    const values = [raw.image, raw.imageUrl, raw.thumbnail, raw.thumbnailUrl, raw.primaryImage];
    const images = Array.isArray(raw.images) ? raw.images : [];
    for (const image of images) values.push(typeof image === "string" ? image : image?.url || image?.src || image?.imageUrl);
    return [...new Set(values.map(trustedImageUrl).filter(Boolean))];
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
    const explicit = numberValue(firstValue(raw.stock, raw.inventory, raw.quantity, raw.availableQuantity));
    if (Number.isFinite(explicit)) return Math.max(0, Math.floor(explicit));
    const state = stringValue(firstValue(raw.availability, raw.availabilityStatus, raw.stockStatus, raw.status)).toLowerCase();
    if (/out|unavailable|sold/.test(state)) return 0;
    return /in|available|stock|limited/.test(state) || raw.inStock === true || raw.available === true ? 1 : 0;
  }

  function variantsFor(raw, stock) {
    if (Array.isArray(raw.variants) && raw.variants.length) {
      return raw.variants.slice(0, 120).map((variant, index) => ({
        color: stringValue(firstValue(variant.color, variant.colorName, raw.color)) || "Default",
        size: stringValue(firstValue(variant.size, variant.sizeName)) || "One size",
        stock: Math.max(0, Math.floor(numberValue(firstValue(variant.stock, variant.quantity, variant.inventory)) || 0)),
        index
      }));
    }
    const sizes = Array.isArray(raw.sizes) ? raw.sizes.map(stringValue).filter(Boolean).slice(0, 30) : [];
    return (sizes.length ? sizes : ["One size"]).map(size => ({ color: "Default", size, stock }));
  }

  function normalizeNikeProduct(raw, index = 0, fetchedAt = new Date().toISOString()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const rawBrand = stringValue(firstValue(raw.brand, raw.brandName, "Nike"));
    if (rawBrand && rawBrand.toLowerCase() !== "nike") return null;
    const name = localized(firstValue(raw.name, raw.title, raw.productName), "Nike product");
    const id = safeKey(firstValue(raw.id, raw.productId, raw.sku), `nike-${index + 1}`);
    const slug = safeKey(firstValue(raw.slug, raw.handle, name.en), id).toLowerCase();
    const originalPriceCents = cents(firstValue(raw.compareAtPrice, raw.originalPrice, raw.listPrice, raw.regularPrice, raw.price));
    const salePriceCents = cents(firstValue(raw.salePrice, raw.discountPrice, raw.currentPrice, raw.finalPrice));
    const priceCents = salePriceCents !== null && (originalPriceCents === null || salePriceCents < originalPriceCents) ? salePriceCents : originalPriceCents;
    if (priceCents === null) return null;
    const stock = stockFor(raw);
    const updatedAt = normalizedDate(firstValue(raw.updatedAt, raw.lastUpdated, raw.modifiedAt, raw.updated, raw.createdAt, fetchedAt)) || fetchedAt;
    const merchantUrl = safeHttpsUrl(firstValue(raw.productUrl, raw.url, raw.link, raw.merchantUrl));
    const media = imageCandidates(raw).map(url => ({ url, alt: name, width: 420, height: 390 }));
    const variants = variantsFor(raw, stock);
    const effectiveStock = variants.reduce((total, variant) => total + variant.stock, 0);
    return {
      id,
      slug,
      name,
      brand: "Nike",
      category: categoryFor(raw),
      kind: kindFor(raw),
      priceCents,
      compareAtPriceCents: originalPriceCents !== null && originalPriceCents > priceCents ? originalPriceCents : null,
      weightGrams: Math.max(1, Math.floor(numberValue(firstValue(raw.weightGrams, raw.weight, 500)) || 500)),
      stock: effectiveStock,
      variants,
      media,
      description: localized(firstValue(raw.description, raw.details, name), name.en),
      updatedAt,
      availability: effectiveStock > 0 ? "in_stock" : "out_of_stock",
      source: {
        merchantUrl,
        verifiedAt: updatedAt,
        availabilityVerifiedAt: updatedAt,
        availability: "verified"
      },
      purchasable: false
    };
  }

  function rawItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.products)) return payload.products;
    if (Array.isArray(payload.results)) return payload.results;
    if (Array.isArray(payload.data)) return payload.data;
    if (payload.data && typeof payload.data === "object") return rawItems(payload.data);
    return [];
  }

  function buildCatalogUrl({ q = "", limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const params = [`limit=${encodeURIComponent(Math.max(1, Math.floor(limit)))}`, `offset=${encodeURIComponent(Math.max(0, Math.floor(offset)))}`];
    if (stringValue(q)) params.unshift(`q=${encodeURIComponent(stringValue(q))}`);
    return `${API_BASE}/products?${params.join("&")}`;
  }

  function parseCatalogPage(payload, { q = "", limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const items = rawItems(payload).map((item, index) => normalizeNikeProduct(item, offset + index)).filter(Boolean);
    const totalValue = numberValue(payload && typeof payload === "object" ? firstValue(payload.total, payload.totalCount, payload.count) : NaN);
    const total = Number.isFinite(totalValue) ? Math.max(items.length, Math.floor(totalValue)) : offset + items.length;
    const pageLimit = Math.max(1, Math.floor(numberValue(payload && typeof payload === "object" ? payload.limit : NaN) || limit));
    const suppliedNext = payload && typeof payload === "object" ? payload.nextOffset : undefined;
    const nextOffset = suppliedNext === null ? null : Number.isFinite(numberValue(suppliedNext)) ? Math.floor(numberValue(suppliedNext)) : (offset + items.length < total ? offset + pageLimit : null);
    return { q: stringValue(q), limit: pageLimit, offset, items, total, nextOffset };
  }

  async function fetchPage(options = {}) {
    const response = await fetch(buildCatalogUrl(options), { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: options.signal });
    if (!response.ok) throw new Error(`catalog_http_${response.status}`);
    return parseCatalogPage(await response.json(), options);
  }

  async function getProduct(productId, options = {}) {
    const id = encodeURIComponent(String(productId || ""));
    const response = await fetch(`${API_BASE}/products/${id}`, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: options.signal });
    if (!response.ok) throw new Error(`catalog_product_http_${response.status}`);
    const payload = await response.json();
    const record = payload && typeof payload === "object" && payload.data && !Array.isArray(payload.data) ? payload.data : payload;
    return normalizeNikeProduct(record, 0);
  }

  return Object.freeze({ API_BASE, IMAGE_HOSTS, buildCatalogUrl, getProduct, normalizeNikeProduct, parseCatalogPage, fetchPage });
});
