"use strict";

const POLICY_VERSION = "anox.shipping-policy/2";

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateParcel(input) {
  const parcel = {
    weightOz: input?.weightOz,
    lengthIn: input?.lengthIn,
    widthIn: input?.widthIn,
    heightIn: input?.heightIn
  };

  if (!Object.values(parcel).every(finiteNumber)) {
    throw new Error("INVALID_PARCEL");
  }

  if (
    parcel.weightOz <= 0 || parcel.weightOz > 2400 ||
    parcel.lengthIn <= 0 || parcel.lengthIn > 120 ||
    parcel.widthIn <= 0 || parcel.widthIn > 120 ||
    parcel.heightIn <= 0 || parcel.heightIn > 120
  ) {
    throw new Error("INVALID_PARCEL");
  }

  return parcel;
}

function normalizeRate(raw) {
  const amount = Number(raw?.rate);
  const amountCents = Math.round(amount * 100);
  const currency = String(raw?.currency || "").toLowerCase();
  const carrier = String(raw?.carrier || "").trim();
  const service = String(raw?.service || "").trim();
  const rateId = String(raw?.id || "").trim();

  if (
    !rateId || !carrier || !service || currency !== "usd" ||
    !Number.isFinite(amountCents) || amountCents <= 0
  ) {
    return null;
  }

  const eta = Number(raw?.delivery_days);
  const estimatedDays = Number.isInteger(eta) && eta > 0 ? eta : null;

  return {
    rateId,
    carrier,
    service,
    amountCents,
    currency,
    estimatedDays,
    deliveryDate: raw?.delivery_date || null,
    deliveryDateGuaranteed: raw?.delivery_date_guaranteed === true,
    provider: "easypost"
  };
}

function scoreRates(rates) {
  if (!Array.isArray(rates) || rates.length === 0) {
    throw new Error("NO_ELIGIBLE_RATES");
  }

  const eligible = rates.filter(rate =>
    rate && rate.currency === "usd" &&
    Number.isInteger(rate.amountCents) && rate.amountCents > 0 &&
    rate.carrier && rate.service
  );

  if (!eligible.length) {
    throw new Error("NO_ELIGIBLE_RATES");
  }

  const minPrice = Math.min(...eligible.map(rate => rate.amountCents));

  const ranked = eligible.map(rate => {
    const priceRatioScore = (minPrice / rate.amountCents) * 100;
    return {
      ...rate,
      policyVersion: POLICY_VERSION,
      policyScore: Number(priceRatioScore.toFixed(6)),
      policyComponents: {
        priceRatioScore: Number(priceRatioScore.toFixed(6))
      }
    };
  });

  ranked.sort((a, b) => {
    const byPrice = a.amountCents - b.amountCents;
    if (byPrice) return byPrice;

    const aEta = a.estimatedDays == null ? Number.POSITIVE_INFINITY : a.estimatedDays;
    const bEta = b.estimatedDays == null ? Number.POSITIVE_INFINITY : b.estimatedDays;
    const byEta = aEta - bEta;
    if (byEta) return byEta;

    return a.carrier.localeCompare(b.carrier) ||
      a.service.localeCompare(b.service) ||
      a.rateId.localeCompare(b.rateId);
  });

  const selected = {
    ...ranked[0],
    selectionReason:
      `policy=${POLICY_VERSION};criterion=lowest_price;` +
      `carrier=${ranked[0].carrier};service=${ranked[0].service}`
  };

  return {selected, ranked};
}

const ALLOWED_TRANSITIONS = new Map([
  ["FULFILLMENT_READY", new Set(["QUOTING", "CANCELLED", "FAILED"])],
  ["QUOTING", new Set(["RATES_READY", "FAILED"])],
  ["RATES_READY", new Set(["RATE_SELECTED", "FAILED"])],
  ["RATE_SELECTED", new Set(["LABEL_CREATED", "FAILED"])],
  ["LABEL_CREATED", new Set(["IN_TRANSIT", "DELIVERED", "EXCEPTION"])],
  ["IN_TRANSIT", new Set(["DELIVERED", "EXCEPTION"])],
  ["EXCEPTION", new Set(["IN_TRANSIT", "DELIVERED"])],
  ["DELIVERED", new Set()],
  ["CANCELLED", new Set()],
  ["FAILED", new Set()]
]);

function assertTransition(from, to) {
  if (from === to) return true;
  if (!ALLOWED_TRANSITIONS.get(from)?.has(to)) {
    throw new Error("INVALID_SHIPMENT_TRANSITION");
  }
  return true;
}

function normalizeTrackingStatus(providerStatus) {
  switch (String(providerStatus || "").toLowerCase()) {
    case "pre_transit": return "LABEL_CREATED";
    case "in_transit":
    case "out_for_delivery": return "IN_TRANSIT";
    case "delivered": return "DELIVERED";
    case "failure":
    case "error":
    case "return_to_sender":
    default: return "EXCEPTION";
  }
}


function createEasyPostAdapter({fetchImpl = fetch, loadApiKey}) {
  if (typeof fetchImpl !== "function" || typeof loadApiKey !== "function") {
    throw new Error("INVALID_ADAPTER_DEPENDENCIES");
  }

  let cachedKey = "";

  async function apiKey() {
    if (cachedKey) return cachedKey;
    const key = String(await loadApiKey()).trim();
    if (!key || !key.startsWith("EZTK")) {
      throw new Error("EASYPOST_NOT_IN_TEST_MODE");
    }
    cachedKey = key;
    return key;
  }

  async function request(path, {method = "GET", body} = {}) {
    const key = await apiKey();
    let response;
    try {
      response = await fetchImpl(
        `https://api.easypost.com/v2${path}`,
        {
          method,
          headers: {
            authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
            "content-type": "application/json"
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(8000)
        }
      );
    } catch {
      throw new Error("PROVIDER_UNAVAILABLE");
    }

    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw new Error(response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED_REQUEST");
    }

    if (data.mode && String(data.mode).toLowerCase() !== "test") {
      throw new Error("EASYPOST_LIVE_RESPONSE_REJECTED");
    }

    return data;
  }

  async function createShipmentQuote(input) {
    const p = input?.parcel || {};
    const data = await request("/shipments", {
      method: "POST",
      body: {
        shipment: {
          from_address: input?.fromAddress,
          to_address: input?.toAddress,
          parcel: {
            weight: p.weightOz,
            length: p.lengthIn,
            width: p.widthIn,
            height: p.heightIn
          }
        }
      }
    });

    const providerShipmentId = String(data?.id || "").trim();
    if (!providerShipmentId || !Array.isArray(data?.rates)) {
      throw new Error("PROVIDER_INVALID_RESPONSE");
    }

    const rates = data.rates.map(normalizeRate).filter(Boolean);
    if (!rates.length) {
      throw new Error("NO_ELIGIBLE_RATES");
    }

    return {providerShipmentId, rates};
  }

  async function purchaseLabel({providerShipmentId, selectedRateId}) {
    const shipmentId = String(providerShipmentId || "").trim();
    const rateId = String(selectedRateId || "").trim();
    if (!shipmentId || !rateId) {
      throw new Error("INVALID_LABEL_REQUEST");
    }

    const data = await request(`/shipments/${encodeURIComponent(shipmentId)}/buy`, {
      method: "POST",
      body: {rate:{id:rateId}}
    });

    const selected = normalizeRate(data?.selected_rate);
    const tracker = data?.tracker;
    const trackingNumber = String(tracker?.tracking_code || "").trim();
    const labelUrl = String(data?.postage_label?.label_url || "").trim();

    if (
      String(data?.id || "") !== shipmentId ||
      !selected || selected.rateId !== rateId ||
      !tracker?.id || !trackingNumber || !labelUrl
    ) {
      throw new Error("PROVIDER_INVALID_RESPONSE");
    }

    return {
      providerShipmentId:shipmentId,
      providerTrackerId:String(tracker.id),
      carrier:selected.carrier,
      service:selected.service,
      trackingNumber,
      labelUrl,
      rateAmountCents:selected.amountCents,
      rateCurrency:selected.currency
    };
  }

  function normalizeTrackingEvent(event) {
    const providerEventId = String(event?.id || "").trim();
    const providerStatus = String(event?.status || "").trim();
    const message = String(event?.description || "").trim();
    const date = new Date(event?.datetime || "");

    if (!providerEventId || !providerStatus || Number.isNaN(date.valueOf())) {
      throw new Error("PROVIDER_INVALID_EVENT");
    }

    const loc = event?.tracking_location || {};
    const location = [loc.city, loc.state, loc.country]
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join(", ");

    return {
      providerEventId,
      eventAt:date.toISOString(),
      providerStatus,
      location,
      message
    };
  }

  return {createShipmentQuote, purchaseLabel, normalizeTrackingEvent};
}


function defaultCommands() {
  return require("@aws-sdk/client-dynamodb");
}

const S = v => ({S:String(v)});
const N = v => ({N:String(v)});
const BOOL = v => ({BOOL:Boolean(v)});

function str(item, key) { return item?.[key]?.S || ""; }
function num(item, key) { return item?.[key]?.N != null ? Number(item[key].N) : null; }
function bool(item, key) { return item?.[key]?.BOOL === true; }
function jsonValue(item, key) {
  const raw = str(item, key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function shipmentIdForOrder(orderId) {
  const id = String(orderId || "").trim();
  if (!id) throw new Error("ORDER_ID_REQUIRED");
  return `SHP-${id}`;
}

function shipmentView(item) {
  if (!item) return null;
  return {
    shipmentId:str(item,"shipmentId"),
    orderId:str(item,"orderId"),
    userId:str(item,"userId"),
    provider:str(item,"provider"),
    providerShipmentId:str(item,"providerShipmentId"),
    providerTrackerId:str(item,"providerTrackerId"),
    carrier:str(item,"carrier"),
    service:str(item,"service"),
    trackingNumber:str(item,"trackingNumber"),
    status:str(item,"status"),
    mode:str(item,"mode"),
    parcelWeightOz:num(item,"parcelWeightOz"),
    parcelLengthIn:num(item,"parcelLengthIn"),
    parcelWidthIn:num(item,"parcelWidthIn"),
    parcelHeightIn:num(item,"parcelHeightIn"),
    rateCurrency:str(item,"rateCurrency"),
    rateAmountCents:num(item,"rateAmountCents"),
    estimatedDays:num(item,"estimatedDays"),
    selectedRateId:str(item,"selectedRateId"),
    policyVersion:str(item,"policyVersion"),
    policyScore:num(item,"policyScore"),
    selectionReason:str(item,"selectionReason"),
    policyComponents:jsonValue(item,"policyComponents"),
    ratesSnapshot:jsonValue(item,"ratesSnapshot"),
    labelUrl:str(item,"labelUrl"),
    labelCreatedAt:str(item,"labelCreatedAt"),
    createdAt:str(item,"createdAt"),
    updatedAt:str(item,"updatedAt"),
    sandbox:bool(item,"sandbox")
  };
}

function orderView(item) {
  if (!item) return null;
  return {
    orderId:str(item,"orderId"),
    userId:str(item,"userId"),
    paymentStatus:str(item,"paymentStatus"),
    status:str(item,"status"),
    customerEmail:str(item,"customerEmail"),
    authenticatedCheckout:bool(item,"authenticatedCheckout"),
    delivery:jsonValue(item,"delivery")
  };
}

function createRepository({ddb, tables, commands = null, now = () => new Date().toISOString()}) {
  if (!ddb || !tables?.orders || !tables?.shipments || !tables?.tracking) {
    throw new Error("INVALID_REPOSITORY_DEPENDENCIES");
  }

  const {
    GetItemCommand,
    PutItemCommand,
    UpdateItemCommand,
    QueryCommand,
    TransactWriteItemsCommand
  } = commands || defaultCommands();

  async function getShipment(shipmentId) {
    const result = await ddb.send(new GetItemCommand({
      TableName:tables.shipments,
      Key:{shipmentId:S(shipmentId)},
      ConsistentRead:true
    }));
    return shipmentView(result.Item);
  }

  async function getPaidOrder(orderId) {
    const result = await ddb.send(new GetItemCommand({
      TableName:tables.orders,
      Key:{orderId:S(orderId)},
      ConsistentRead:true
    }));
    if (!result.Item) throw new Error("ORDER_NOT_FOUND");
    const order = orderView(result.Item);
    if (order.paymentStatus !== "paid") throw new Error("ORDER_NOT_PAID");
    return order;
  }

  async function getShipmentByOrder(orderId) {
    return getShipment(shipmentIdForOrder(orderId));
  }

  async function createShipmentIfAbsent({orderId, userId, parcel}) {
    const shipmentId = shipmentIdForOrder(orderId);
    const existing = await getShipment(shipmentId);
    if (existing) return existing;

    const t = now();
    const item = {
      shipmentId:S(shipmentId),
      orderId:S(orderId),
      provider:S("easypost"),
      mode:S("sandbox"),
      sandbox:BOOL(true),
      status:S("FULFILLMENT_READY"),
      parcelWeightOz:N(parcel.weightOz),
      parcelLengthIn:N(parcel.lengthIn),
      parcelWidthIn:N(parcel.widthIn),
      parcelHeightIn:N(parcel.heightIn),
      createdAt:S(t),
      updatedAt:S(t)
    };
    if (userId) item.userId = S(userId);

    try {
      await ddb.send(new PutItemCommand({
        TableName:tables.shipments,
        Item:item,
        ConditionExpression:"attribute_not_exists(shipmentId)"
      }));
      return shipmentView(item);
    } catch (err) {
      if (err?.name !== "ConditionalCheckFailedException") throw err;
      const raced = await getShipment(shipmentId);
      if (!raced) throw err;
      return raced;
    }
  }

  async function saveQuotedRates({shipmentId, providerShipmentId, rates}) {
    const t = now();
    const snapshot = JSON.stringify(rates);
    if (Buffer.byteLength(snapshot, "utf8") > 100000) {
      throw new Error("RATES_SNAPSHOT_TOO_LARGE");
    }

    const result = await ddb.send(new UpdateItemCommand({
      TableName:tables.shipments,
      Key:{shipmentId:S(shipmentId)},
      ConditionExpression:"#status = :ready OR (#status = :rates AND providerShipmentId = :providerId)",
      UpdateExpression:"SET #status=:rates, providerShipmentId=:providerId, ratesSnapshot=:snapshot, updatedAt=:u",
      ExpressionAttributeNames:{"#status":"status"},
      ExpressionAttributeValues:{
        ":ready":S("FULFILLMENT_READY"),
        ":rates":S("RATES_READY"),
        ":providerId":S(providerShipmentId),
        ":snapshot":S(snapshot),
        ":u":S(t)
      },
      ReturnValues:"ALL_NEW"
    }));
    return shipmentView(result.Attributes);
  }

  async function saveSelectedRate({shipmentId, selected}) {
    const t = now();
    const values = {
      ":ready":S("RATES_READY"),
      ":selectedState":S("RATE_SELECTED"),
      ":rateId":S(selected.rateId),
      ":carrier":S(selected.carrier),
      ":service":S(selected.service),
      ":amount":N(selected.amountCents),
      ":currency":S(selected.currency),
      ":policyVersion":S(selected.policyVersion),
      ":policyScore":N(selected.policyScore),
      ":reason":S(selected.selectionReason || ""),
      ":components":S(JSON.stringify(selected.policyComponents || {})),
      ":u":S(t)
    };

    let update = "SET #status=:selectedState, selectedRateId=:rateId, carrier=:carrier, service=:service, rateAmountCents=:amount, rateCurrency=:currency, policyVersion=:policyVersion, policyScore=:policyScore, selectionReason=:reason, policyComponents=:components, updatedAt=:u";
    if (selected.estimatedDays != null) {
      values[":eta"] = N(selected.estimatedDays);
      update += ", estimatedDays=:eta";
    } else {
      update += " REMOVE estimatedDays";
    }

    const result = await ddb.send(new UpdateItemCommand({
      TableName:tables.shipments,
      Key:{shipmentId:S(shipmentId)},
      ConditionExpression:"(#status = :ready OR #status = :selectedState) AND attribute_not_exists(labelCreatedAt)",
      UpdateExpression:update,
      ExpressionAttributeNames:{"#status":"status"},
      ExpressionAttributeValues:values,
      ReturnValues:"ALL_NEW"
    }));
    return shipmentView(result.Attributes);
  }

  async function saveLabelIfSelected({shipmentId, label}) {
    const current = await getShipment(shipmentId);
    if (!current) throw new Error("SHIPMENT_NOT_FOUND");
    if (current.status === "LABEL_CREATED") return current;
    if (current.status !== "RATE_SELECTED") throw new Error("SHIPMENT_NOT_READY_FOR_LABEL");

    const t = now();
    try {
      const result = await ddb.send(new UpdateItemCommand({
        TableName:tables.shipments,
        Key:{shipmentId:S(shipmentId)},
        ConditionExpression:"#status = :expected AND attribute_not_exists(labelCreatedAt)",
        UpdateExpression:"SET #status=:created, providerShipmentId=:providerShipmentId, providerTrackerId=:providerTrackerId, carrier=:carrier, service=:service, trackingNumber=:tracking, labelUrl=:labelUrl, rateAmountCents=:amount, rateCurrency=:currency, labelCreatedAt=:t, updatedAt=:t",
        ExpressionAttributeNames:{"#status":"status"},
        ExpressionAttributeValues:{
          ":expected":S("RATE_SELECTED"),
          ":created":S("LABEL_CREATED"),
          ":providerShipmentId":S(label.providerShipmentId),
          ":providerTrackerId":S(label.providerTrackerId),
          ":carrier":S(label.carrier),
          ":service":S(label.service),
          ":tracking":S(label.trackingNumber),
          ":labelUrl":S(label.labelUrl),
          ":amount":N(label.rateAmountCents),
          ":currency":S(label.rateCurrency),
          ":t":S(t)
        },
        ReturnValues:"ALL_NEW"
      }));
      return shipmentView(result.Attributes);
    } catch (err) {
      if (err?.name !== "ConditionalCheckFailedException") throw err;
      const raced = await getShipment(shipmentId);
      if (raced?.status === "LABEL_CREATED") return raced;
      throw err;
    }
  }

  async function applyTrackingEvent(input) {
    const eventAtKey = `${input.eventAt}#${input.providerEventId}`;
    // Exact base-table key query preserves the existing tracking IAM boundary.
    const readReceipt = async () => (await ddb.send(new QueryCommand({TableName:tables.tracking,
      KeyConditionExpression:"shipmentId = :shipment AND eventAt = :event",
      ExpressionAttributeValues:{":shipment":S(input.shipmentId),":event":S(eventAtKey)},
      ConsistentRead:true,Limit:1}))).Items?.[0];
    if (await readReceipt()) return {duplicate:true,shipment:await getShipment(input.shipmentId)};
    const item = {
      shipmentId:S(input.shipmentId),
      eventAt:S(eventAtKey),
      eventTime:S(input.eventAt),
      providerEventId:S(input.providerEventId),
      status:S(input.status),
      location:S(input.location || ""),
      message:S(input.message || ""),
      source:S(input.source || "easypost"),
      createdAt:S(now())
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await getShipment(input.shipmentId);
      if (!current) throw new Error("SHIPMENT_NOT_FOUND");
      const status = current.status === "DELIVERED" ? "DELIVERED" : input.status;
      try { assertTransition(current.status, status); }
      catch (error) {
        // Another worker may have committed this receipt and advanced the state
        // after our first receipt query. Confirm duplicate before rejecting it.
        if (await readReceipt()) return {duplicate:true,shipment:await getShipment(input.shipmentId)};
        throw error;
      }
      try {
        // The receipt must never commit without its state change. Bind the state
        // read above so a concurrent terminal update cannot be overwritten.
        await ddb.send(new TransactWriteItemsCommand({TransactItems:[
          {Put:{TableName:tables.tracking, Item:item,
            ConditionExpression:"attribute_not_exists(shipmentId) AND attribute_not_exists(eventAt)"}},
          {Update:{TableName:tables.shipments, Key:{shipmentId:S(input.shipmentId)},
            ConditionExpression:"attribute_exists(shipmentId) AND #status = :expected",
            UpdateExpression:"SET #status=:status, updatedAt=:u",
            ExpressionAttributeNames:{"#status":"status"},
            ExpressionAttributeValues:{":expected":S(current.status),":status":S(status),":u":S(now())}}}
        ]}));
        return getShipment(input.shipmentId);
      } catch (err) {
        if (err?.name !== "TransactionCanceledException") throw err;
        if (await readReceipt()) return {duplicate:true, shipment:await getShipment(input.shipmentId)};
        if (attempt === 2) throw err;
      }
    }
  }

  return {
    getPaidOrder,
    getShipment,
    getShipmentByOrder,
    createShipmentIfAbsent,
    saveQuotedRates,
    saveSelectedRate,
    saveLabelIfSelected,
    applyTrackingEvent
  };
}


function createShippingHandler({repository, provider}) {
  if (!repository || !provider) {
    throw new Error("INVALID_HANDLER_DEPENDENCIES");
  }

  async function quoteAndSelect(event) {
    const orderId = String(event?.orderId || "").trim();
    if (!orderId) throw new Error("ORDER_ID_REQUIRED");

    const order = await repository.getPaidOrder(orderId);
    if (order.authenticatedCheckout && !order.userId) {
      throw new Error("ORDER_ACCOUNT_LINK_REQUIRED");
    }

    const parcel = validateParcel(event?.parcel);
    const shipment = await repository.createShipmentIfAbsent({
      orderId,
      userId:order.userId,
      parcel
    });

    if (["RATE_SELECTED","LABEL_CREATED","IN_TRANSIT","DELIVERED","EXCEPTION"].includes(shipment.status)) {
      return shipment;
    }

    let rates;
    let providerShipmentId = shipment.providerShipmentId;

    if (shipment.status === "RATES_READY" && Array.isArray(shipment.ratesSnapshot)) {
      rates = shipment.ratesSnapshot;
    } else {
      const quote = await provider.createShipmentQuote({
        fromAddress:event?.fromAddress,
        toAddress:event?.toAddress,
        parcel
      });
      providerShipmentId = quote.providerShipmentId;
      rates = quote.rates;
      await repository.saveQuotedRates({
        shipmentId:shipment.shipmentId,
        providerShipmentId,
        rates
      });
    }

    const {selected} = scoreRates(rates);
    return repository.saveSelectedRate({
      shipmentId:shipment.shipmentId,
      selected:{...selected, providerShipmentId}
    });
  }

  async function selectRate(event) {
    const shipmentId = String(event?.shipmentId || "").trim();
    const rateId = String(event?.rateId || "").trim();
    if (!shipmentId) throw new Error("SHIPMENT_ID_REQUIRED");
    if (!rateId) throw new Error("RATE_ID_REQUIRED");

    const shipment = await repository.getShipment(shipmentId);
    if (!shipment) throw new Error("SHIPMENT_NOT_FOUND");
    if (!["RATES_READY","RATE_SELECTED"].includes(shipment.status)) {
      throw new Error("SHIPMENT_NOT_READY_FOR_RATE_SELECTION");
    }

    const rates = Array.isArray(shipment.ratesSnapshot)
      ? shipment.ratesSnapshot
      : [];
    const rate = rates.find(candidate => candidate?.rateId === rateId);
    if (!rate) throw new Error("RATE_NOT_AVAILABLE");

    const selected = {
      ...rate,
      policyVersion: POLICY_VERSION,
      policyScore: 0,
      policyComponents:{userSelected:true},
      selectionReason:
        `policy=${POLICY_VERSION};criterion=user_selected;` +
        `carrier=${rate.carrier};service=${rate.service}`
    };

    return repository.saveSelectedRate({shipmentId, selected});
  }

  async function createLabel(event) {
    const shipmentId = String(event?.shipmentId || "").trim();
    if (!shipmentId) throw new Error("SHIPMENT_ID_REQUIRED");

    const shipment = await repository.getShipment(shipmentId);
    if (!shipment) throw new Error("SHIPMENT_NOT_FOUND");

    if (["LABEL_CREATED","IN_TRANSIT","DELIVERED","EXCEPTION"].includes(shipment.status)) {
      return shipment;
    }

    if (shipment.status !== "RATE_SELECTED") {
      throw new Error("SHIPMENT_NOT_READY_FOR_LABEL");
    }

    const label = await provider.purchaseLabel({
      providerShipmentId:shipment.providerShipmentId,
      selectedRateId:shipment.selectedRateId
    });

    return repository.saveLabelIfSelected({shipmentId, label});
  }

  async function ingestTrackingEvent(event) {
    const shipmentId = String(event?.shipmentId || "").trim();
    if (!shipmentId) throw new Error("SHIPMENT_ID_REQUIRED");

    const shipment = await repository.getShipment(shipmentId);
    if (!shipment) throw new Error("SHIPMENT_NOT_FOUND");

    const normalized = provider.normalizeTrackingEvent(event?.providerEvent);
    const status = normalizeTrackingStatus(normalized.providerStatus);

    return repository.applyTrackingEvent({
      shipmentId,
      eventAt:normalized.eventAt,
      providerEventId:normalized.providerEventId,
      status,
      location:normalized.location,
      message:normalized.message,
      source:"easypost"
    });

  }

  return async function handle(event) {
    switch (String(event?.action || "")) {
      case "QUOTE_AND_SELECT":
        return quoteAndSelect(event);
      case "SELECT_RATE":
        return selectRate(event);
      case "CREATE_LABEL":
        return createLabel(event);
      case "INGEST_TRACKING_EVENT":
        return ingestTrackingEvent(event);
      case "GET_INTERNAL_SHIPMENT": {
        const shipmentId = String(event?.shipmentId || "").trim();
        if (!shipmentId) throw new Error("SHIPMENT_ID_REQUIRED");
        const shipment = await repository.getShipment(shipmentId);
        if (!shipment) throw new Error("SHIPMENT_NOT_FOUND");
        return shipment;
      }
      default:
        throw new Error("UNKNOWN_SHIPPING_ACTION");
    }
  };
}


function parseEasyPostSecret(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || ""));
  } catch {
    throw new Error("EASYPOST_SECRET_INVALID_FORMAT");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("EASYPOST_SECRET_INVALID_FORMAT");
  }
  const key = String(parsed.apiKey || "").trim();
  if (!key.startsWith("EZTK")) {
    throw new Error("EASYPOST_NOT_IN_TEST_MODE");
  }
  return key;
}

function createEasyPostKeyLoader({sm, GetSecretValueCommand, secretId}) {
  return async function loadEasyPostKey() {
    const out = await sm.send(new GetSecretValueCommand({SecretId:secretId}));
    return parseEasyPostSecret(out?.SecretString || "");
  };
}

let cachedHandler = null;

async function buildRuntimeHandler() {
  const {
    DynamoDBClient,
    GetItemCommand,
    PutItemCommand,
    UpdateItemCommand,
    QueryCommand,
    TransactWriteItemsCommand
  } = require("@aws-sdk/client-dynamodb");
  const {
    SecretsManagerClient,
    GetSecretValueCommand
  } = require("@aws-sdk/client-secrets-manager");

  const ddb = new DynamoDBClient({});
  const sm = new SecretsManagerClient({});
  const tables = {
    orders:process.env.ORDERS_TABLE,
    shipments:process.env.SHIPMENTS_TABLE,
    tracking:process.env.TRACKING_TABLE
  };
  const secretId = process.env.EASYPOST_SECRET_ID;

  if (!tables.orders || !tables.shipments || !tables.tracking || !secretId) {
    throw new Error("SHIPPING_RUNTIME_CONFIG_MISSING");
  }

  const repository = createRepository({
    ddb,
    tables,
    commands:{
      GetItemCommand,
      PutItemCommand,
      UpdateItemCommand,
      QueryCommand,
      TransactWriteItemsCommand
    }
  });

  const provider = createEasyPostAdapter({
    loadApiKey:createEasyPostKeyLoader({sm, GetSecretValueCommand, secretId})
  });

  return createShippingHandler({repository, provider});
}

async function handler(event) {
  if (!cachedHandler) cachedHandler = await buildRuntimeHandler();
  try {
    return await cachedHandler(event || {});
  } catch (err) {
    console.error("shipping_request_failed", String(err?.message || "unknown"));
    throw err;
  }
}

exports.handler = handler;
