(function exposeAnoXCommerce(root, factory) {
  const library = factory();
  if (typeof module === 'object' && module.exports) module.exports = library;
  else if (!root.AnoXAnalytics?.isMetricsFrame) root.AnoXCommerce = library;
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const CART_KEY = 'anox:selection-cart:v1';
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const integer = (value,min,max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const fail = code => Object.assign(Error(code), {code});
  const copy = value => JSON.parse(JSON.stringify(value));
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
  const cleanUnicode = value => !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value);
  function safeText(value, max = 200) { return typeof value === 'string' ? value.slice(0,max) : ''; }
  function https(value, hosts) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && (!hosts || hosts.includes(url.hostname)) ? url.href : ''; } catch { return ''; }
  }
  function optionsOf(value = {}) {
    if (!object(value) || Object.keys(value).length > 8) throw fail('invalid_selection');
    return Object.fromEntries(Object.keys(value).sort().map(name => {
      if (!name || name.length > 60 || !cleanUnicode(name) || ['__proto__','constructor','prototype'].includes(name) || typeof value[name] !== 'string' || !value[name].length || value[name].length > 80 || !cleanUnicode(value[name])) throw fail('invalid_selection');
      return [name,value[name]];
    }));
  }
  function selection(value) {
    if (!object(value) || value.provider !== 'channel3' || typeof value.productId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.productId) || !integer(value.quantity,1,20)) throw fail('invalid_selection');
    const data = object(value.display) ? value.display : {}, rawDomain=value.merchantDomain ?? data.merchantDomain;
    if(typeof rawDomain!=='string'||rawDomain.length>253)throw fail('invalid_selection');
    const merchantDomain=rawDomain.toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(merchantDomain)) throw fail('invalid_selection');
    if (value.condition != null && !['new','used'].includes(value.condition)) throw fail('invalid_selection');
    const condition = value.condition ?? null;
    return {provider:'channel3',productId:value.productId,merchantDomain,condition,options:optionsOf(value.options),quantity:value.quantity,
      offerUrl:https(value.offerUrl,['buy.trychannel3.com']),display:{title:safeText(data.title),merchantDomain,currency:'USD',priceCents:integer(data.priceCents,0,1e8)?data.priceCents:null,
        imageUrl:https(data.imageUrl,['cdn.trychannel3.com']),stock:null,maxCommissionRate:typeof data.maxCommissionRate === 'number' && Number.isFinite(data.maxCommissionRate) && data.maxCommissionRate >= 0 && data.maxCommissionRate <= 1 ? data.maxCommissionRate : null}};
  }
  function lineKey(line) { return JSON.stringify([line.provider,line.productId,line.merchantDomain,line.condition,optionsOf(line.options)]); }
  function createCart({storage,locks,crypto:random=globalThis.crypto,onChange=()=>{}} = {}) {
    const state = {lines:Object.freeze([]),revision:'',persistent:!!storage && !!locks?.request,notice:''};
    let queue=Promise.resolve(),resetGeneration=0;
    const newId = () => { if (typeof random?.randomUUID !== 'function') throw fail('secure_random_unavailable'); return random.randomUUID(); };
    function decode(raw) {
      if (!raw) return {lines:[],revision:''};
      if (raw.length > 131072) throw fail('cart_storage_invalid');
      const saved=JSON.parse(raw);if (!object(saved) || saved.schema !== 'anox.selection-cart/1' || !Array.isArray(saved.lines) || saved.lines.length > 50 || typeof saved.revision !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(saved.revision)) throw fail('cart_storage_invalid');
      const seen=new Set(),lines=[];
      for (const rawLine of saved.lines) { try { const line=selection(rawLine),key=lineKey(line);if (seen.has(key)) continue;seen.add(key);lines.push(line); } catch { state.notice='cart_restoration_incomplete'; } }
      return {lines,revision:saved.revision};
    }
    function read() { return decode(storage?.getItem(CART_KEY)); }
    function apply(next) { state.lines=freeze(copy(next.lines));state.revision=next.revision; }
    function changed() { try { onChange(state); } catch {} }
    function reload({cleared=false}={}) {
      if(cleared){resetGeneration++;apply({lines:[],revision:''});}
      if (state.persistent) { try { apply(read()); } catch { state.persistent=false;state.notice='cart_session_only'; } }
      changed();return state;
    }
    if (storage) { try { apply(read()); } catch { state.persistent=false;state.notice='cart_session_only'; } }
    if (!state.persistent) state.notice='cart_session_only';
    function mutate(work) {
      const generation=resetGeneration;
      const run=async()=>{
        const commit=()=>{
          if(generation!==resetGeneration)throw fail('cart_changed');
          let before={lines:copy(state.lines),revision:state.revision};
          if (state.persistent) { try { before=read(); } catch { state.persistent=false;state.notice='cart_session_only'; } }
          const lines=work(copy(before.lines));if (lines.length>50) throw fail('cart_line_limit');
          const next={schema:'anox.selection-cart/1',revision:newId(),lines};
          if (state.persistent) { try { const raw=JSON.stringify(next);storage.setItem(CART_KEY,raw);if (storage.getItem(CART_KEY)!==raw) throw Error('write_unverified'); } catch { state.persistent=false;state.notice='cart_session_only'; } }
          apply(next);changed();return state;
        };
        if (!state.persistent) return commit();
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
        try { return await locks.request(CART_KEY,{mode:'exclusive',signal:controller.signal},commit); } finally { clearTimeout(timer); }
      };
      const pending=queue.then(run);queue=pending.catch(()=>{});return pending;
    }
    function forget(){
      resetGeneration++;
      const commit=()=>{storage?.removeItem(CART_KEY);if(storage?.getItem(CART_KEY)!=null)throw fail('cart_erase_failed');apply({lines:[],revision:''});state.persistent=!!storage&&!!locks?.request;state.notice=state.persistent?'':'cart_session_only';changed();return state;};
      const run=async()=>{if(!locks?.request)return commit();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{return await locks.request(CART_KEY,{mode:'exclusive',signal:controller.signal},commit);}finally{clearTimeout(timer);}};
      const pending=queue.then(run);queue=pending.catch(()=>{});return pending;
    }
    function checkedLine(lines,key,expected) {
      const index=lines.findIndex(line=>lineKey(line)===key);
      if (index<0 || expected && JSON.stringify(lines[index])!==JSON.stringify(selection(expected))) throw fail('cart_changed');
      return index;
    }
    return Object.freeze({state,key:CART_KEY,reload,forget,
      add(value){return mutate(lines=>{const line=selection(value),index=lines.findIndex(existing=>lineKey(existing)===lineKey(line));if (index<0) lines.push(line);else {line.quantity+=lines[index].quantity;if (line.quantity>20) throw fail('cart_quantity_limit');lines[index]=line;}return lines;});},
      update(key,patch,expected){return mutate(lines=>{const index=checkedLine(lines,key,expected),next=selection({...lines[index],...patch});const duplicate=lines.findIndex((line,i)=>i!==index&&lineKey(line)===lineKey(next));if (duplicate>=0){next.quantity+=lines[duplicate].quantity;if(next.quantity>20)throw fail('cart_quantity_limit');lines.splice(duplicate,1);const source=lines.findIndex(line=>lineKey(line)===key);lines[source]=next;}else lines[index]=next;return lines;});},
      remove(key,expected){return mutate(lines=>{lines.splice(checkedLine(lines,key,expected),1);return lines;});},
      clear(){return mutate(()=>[]);}
    });
  }
  const identifier=(value,max=160)=>typeof value==='string'&&new RegExp('^[A-Za-z0-9_-]{1,'+max+'}$').test(value);
  const bounded=(value,max=1000)=>typeof value==='string'&&value.length>0&&value.length<=max&&cleanUnicode(value);
  const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value));
  function blockersShape(value){return Array.isArray(value)&&value.length>0&&value.length<=50&&value.every(b=>object(b)&&identifier(b.code,100)&&bounded(b.message,1000));}
  function componentShape(c){return object(c)&&identifier(c.code,100)&&bounded(c.label,200)&&c.currency==='USD'&&['verified','estimated','unknown','conditional'].includes(c.status)&&(c.status==='unknown'?c.amountMinor===null:integer(c.amountMinor,0,1e12))&&(bounded(c.source,300)||c.status==='unknown'&&c.source===null)&&(c.note===undefined||typeof c.note==='string'&&c.note.length<=1000);}
  function quoteShape(envelope,revision,now,expectedLines){
    const q=envelope?.quote,costs=q?.costs,invalid=()=>{throw fail('invalid_quote');};
    if(!object(envelope)||envelope.schemaVersion!==1||!object(q)||!identifier(q.quoteId)||!/^([a-f0-9]{64})$/.test(q.cartHash||'')||q.destination?.country!=='DZ'||q.cartRevision!==revision||!identifier(q.cartRevision,80)||q.currency!=='USD'||!iso(q.createdAt)||!iso(q.expiresAt)||Date.parse(q.createdAt)>now+5000||Date.parse(q.expiresAt)<=now||Date.parse(q.expiresAt)<=Date.parse(q.createdAt)||Date.parse(q.expiresAt)-Date.parse(q.createdAt)>30000)invalid();
    if(!object(costs)||!Array.isArray(costs.components)||!costs.components.length||costs.components.length>30||!costs.components.every(componentShape)||new Set(costs.components.map(c=>c.code)).size!==costs.components.length||!Array.isArray(costs.potentialChargesOnArrival)||costs.potentialChargesOnArrival.length>20||!costs.potentialChargesOnArrival.every(componentShape))invalid();
    const fee=costs.components.filter(c=>c.code==='anox_service_fee');
    if(fee.length!==1||fee[0].amountMinor!==500||fee[0].status!=='conditional'||costs.estimatedTotalMinor!==null||costs.verifiedPayableTotalMinor!==null||!object(q.checkout)||q.checkout.enabled!==false||!blockersShape(q.checkout.blockers))invalid();
    // This release has no supported purchase provider. A total or payment capability
    // requires a separately reviewed contract; a response flag cannot activate it.
    if(!Array.isArray(q.lines)||!q.lines.length||q.lines.length>10||expectedLines&&q.lines.length!==expectedLines.length)invalid();
    q.lines.forEach((line,i)=>{
      let normalized;try{normalized=selection(line);}catch{invalid();}
      if(line.currency!=='USD'||!bounded(line.title,500)||!integer(line.unitPriceMinor,0,1e12)||!integer(line.lineTotalMinor,0,1e12)||line.lineTotalMinor!==line.unitPriceMinor*line.quantity||!['InStock','OutOfStock','unknown'].includes(line.availability)||!iso(line.validatedAt)||Date.parse(line.validatedAt)>now+10000||Date.parse(q.expiresAt)>Date.parse(line.validatedAt)+30000||!object(line.selection)||line.selection.valid!==true||!object(line.offer)||line.offer.domain!==line.merchantDomain||!(line.offer.url===null||https(line.offer.url,['buy.trychannel3.com']))||!(line.offer.maxCommissionRate===null||typeof line.offer.maxCommissionRate==='number'&&Number.isFinite(line.offer.maxCommissionRate)&&line.offer.maxCommissionRate>=0&&line.offer.maxCommissionRate<=1))invalid();
      if(expectedLines&&(lineKey(normalized)!==lineKey(expectedLines[i])||line.quantity!==expectedLines[i].quantity))invalid();
    });
    const products=costs.components.find(c=>c.code==='products');
    const subtotal=q.lines.reduce((sum,line)=>sum+BigInt(line.lineTotalMinor),0n);
    if(!products||products.status!=='estimated'||BigInt(products.amountMinor??-1)!==subtotal)invalid();
    return freeze(copy(q));
  }
  function capabilitiesShape(value){
    if(!object(value)||value.schemaVersion!==1||value.quote?.enabled!==true||value.quote.limits?.maxLines!==10||value.quote.limits.maxDistinctProducts!==5||value.quote.limits.maxQuantityPerLine!==20||value.serviceFee?.amountMinor!==500||value.serviceFee.currency!=='USD'||!['successful_order','owner_decision_pending'].includes(value.serviceFee.appliesOn)||value.serviceFee.collectionEnabled===true||value.checkout?.enabled!==false||!blockersShape(value.checkout.blockers)||value.orders?.read!==true||value.orders.cancel!==false||value.orders.refund!==false)throw fail('invalid_capabilities');
    const serviceRequests=value.serviceRequests;
    if(serviceRequests!==undefined&&(!object(serviceRequests)||typeof serviceRequests.create!=='boolean'||serviceRequests.read!==true||serviceRequests.paymentRequired!==false||value.serviceFee.appliesOn!=='owner_decision_pending'||value.serviceFee.collectionEnabled!==false))throw fail('invalid_capabilities');
    return freeze({...copy(value),serviceFee:{currency:'USD',amountMinor:500,appliesOn:'owner_decision_pending',collectionEnabled:false},serviceRequests:serviceRequests?copy(serviceRequests):{create:false,read:false,paymentRequired:false}});
  }
  function quoteLimits(cart){
    const blockers=[];
    if(cart.lines.length>10)blockers.push({code:'quote_too_many_lines',message:'A quote supports up to 10 selections. Remove selections before requesting costs.'});
    if(new Set(cart.lines.map(line=>JSON.stringify([line.productId,optionsOf(line.options)]))).size>5)blockers.push({code:'quote_too_many_products',message:'A quote supports up to 5 distinct product and option combinations. Reduce the selection before requesting costs.'});
    return blockers;
  }
  function serviceRequestShape(envelope,expected){
    const r=envelope?.serviceRequest,invalid=()=>{throw fail('invalid_service_request');};
    if(envelope?.schemaVersion!==1||!object(r)||r.kind!=='service_request'||!identifier(r.orderId,80)||r.status!=='received'||!iso(r.createdAt)||!iso(r.updatedAt)||!identifier(r.quoteId,80)||!identifier(r.cartRevision,80)||typeof r.cartHash!=='string'||!/^[a-f0-9]{64}$/.test(r.cartHash)||r.currency!=='USD'||r.totalMinor!==null||r.destination?.country!=='DZ'||r.payment?.status!=='not_requested'||r.fulfillment?.status!=='not_requested'||!Array.isArray(r.fulfillment.tracking)||r.fulfillment.tracking.length!==0||r.merchantOrderReference!==null||r.capabilities?.cancel!==false||r.capabilities?.refund!==false)invalid();
    if(r.serviceFee?.amountMinor!==500||r.serviceFee.currency!=='USD'||r.serviceFee.appliesOn!=='owner_decision_pending'||r.serviceFee.collectionEnabled!==false)invalid();
    if(expected&&['quoteId','cartRevision','cartHash'].some(key=>r[key]!==expected[key]))invalid();
    const costs=r.costs;
    if(!object(costs)||costs.estimatedTotalMinor!==null||costs.verifiedPayableTotalMinor!==null||!Array.isArray(costs.components)||!costs.components.length||costs.components.length>30||!costs.components.every(componentShape)||new Set(costs.components.map(c=>c.code)).size!==costs.components.length||!Array.isArray(costs.potentialChargesOnArrival)||costs.potentialChargesOnArrival.length>20||!costs.potentialChargesOnArrival.every(componentShape))invalid();
    const fee=costs.components.find(c=>c.code==='anox_service_fee');
    if(!fee||fee.amountMinor!==500||fee.status!=='conditional'||!Array.isArray(r.lines)||r.lines.length<1||r.lines.length>10)invalid();
    const lines=r.lines.map(line=>{
      let normalized;try{normalized=selection(line);}catch{invalid();}
      if(line.currency!=='USD'||!bounded(line.title,500)||!integer(line.unitPriceMinor,0,1e12)||!integer(line.lineTotalMinor,0,1e12)||line.lineTotalMinor!==line.unitPriceMinor*line.quantity||line.availability!=='unknown'||line.priceStatus!=='historical_estimate'||!iso(line.capturedAt)||line.capturedAt!==line.validatedAt||!iso(line.validatedAt)||Date.parse(line.validatedAt)>Date.parse(r.createdAt)+10000||!object(line.offer)||line.offer.domain!==line.merchantDomain||line.offer.url!==null||line.selection?.valid!==true||line.offer.maxCommissionRate!==null)invalid();
      return {provider:normalized.provider,productId:normalized.productId,merchantDomain:normalized.merchantDomain,condition:normalized.condition,options:normalized.options,quantity:normalized.quantity,title:line.title,unitPriceMinor:line.unitPriceMinor,lineTotalMinor:line.lineTotalMinor,currency:'USD',priceStatus:'historical_estimate',capturedAt:line.capturedAt,availability:'unknown',validatedAt:line.validatedAt,offer:{domain:line.offer.domain,url:line.offer.url,maxCommissionRate:line.offer.maxCommissionRate},selection:{valid:true}};
    });
    const products=costs.components.find(c=>c.code==='products');
    if(!products||products.status!=='estimated'||BigInt(products.amountMinor??-1)!==lines.reduce((sum,line)=>sum+BigInt(line.lineTotalMinor),0n))invalid();
    return freeze({orderId:r.orderId,kind:'service_request',status:'received',createdAt:r.createdAt,updatedAt:r.updatedAt,quoteId:r.quoteId,cartRevision:r.cartRevision,cartHash:r.cartHash,currency:'USD',totalMinor:null,amountMinor:null,destination:{country:'DZ'},lines,costs:copy(costs),serviceFee:copy(r.serviceFee),payment:{status:'not_requested'},fulfillment:{status:'not_requested',tracking:[]},merchantOrderReference:null,capabilities:{cancel:false,refund:false}});
  }
  function orderShape(envelope){
    const o=envelope?.order;
    if(o?.kind==='service_request')return serviceRequestShape({schemaVersion:envelope.schemaVersion,serviceRequest:o});
    if(envelope?.schemaVersion!==1||!object(o)||!identifier(o.orderId)||!iso(o.createdAt)||o.currency!=='USD'||!integer(o.totalMinor,0,1e12)||!['pending','confirmed','fulfilling','shipped','delivered','canceled','failed'].includes(o.status)||!object(o.payment)||!['pending','processing','succeeded','failed','canceled','partially_refunded','refunded'].includes(o.payment.status)||o.capabilities?.cancel!==false||o.capabilities?.refund!==false)throw fail('invalid_order');
    const fulfillment=object(o.fulfillment)?o.fulfillment:null;
    if(fulfillment&&fulfillment.status!==undefined&&!['pending','unfulfilled','processing','partially_fulfilled','fulfilling','fulfilled','shipped','in_transit','out_for_delivery','delivered','exception','returned','canceled','unknown'].includes(fulfillment.status))throw fail('invalid_order');
    return freeze({orderId:o.orderId,createdAt:o.createdAt,status:o.status,payment:{status:o.payment.status},capabilities:{cancel:false,refund:false},fulfillment:fulfillment?{status:fulfillment.status||'unknown',tracking:(Array.isArray(fulfillment.tracking)?fulfillment.tracking:[]).slice(0,20).map(t=>({carrier:safeText(t?.carrier,80),trackingNumber:safeText(t?.trackingNumber,160),url:https(t?.url)}))}:null,merchantOrderReference:safeText(o.merchantOrderReference,200),amountMinor:o.totalMinor,currency:o.currency==='USD'?'USD':null});
  }
  function ordersShape(envelope){
    if(envelope?.schemaVersion!==1||!Array.isArray(envelope.orders)||envelope.orders.length>100||!(envelope.nextCursor===null||identifier(envelope.nextCursor)))throw fail('invalid_order');
    return freeze({orders:envelope.orders.map(order=>orderShape({schemaVersion:1,order})),nextCursor:envelope.nextCursor});
  }
  function createClient({auth,fetch:transport=globalThis.fetch,crypto:random=globalThis.crypto,now=Date.now}={}) {
    const state={quote:null,quoteStatus:'idle',error:'',capabilities:null,serviceRequest:null,serviceRequestStatus:'idle',serviceRequestError:'',serviceRequestRetryable:false};
    const account=()=>typeof auth.sessionVersion==='function'?auth.sessionVersion():0;
    let epoch=0,pending=null,requestBody='',requestId='',capabilityPending=null,owner=account(),servicePending=null,serviceBody='',serviceId='';
    function invalidate(){epoch++;state.serviceRequest=null;state.serviceRequestStatus='idle';state.serviceRequestError='';state.serviceRequestRetryable=false;servicePending=null;serviceBody='';serviceId='';state.quote=null;state.quoteStatus='idle';state.error='';pending=null;requestBody='';requestId='';owner=account();}
    function currentQuote(cart){if(owner!==account()){invalidate();return null;}const q=state.quote;return q&&q.cartRevision===cart.revision&&Date.parse(q.expiresAt)>now()&&(!auth.state||auth.state.session)?q:null;}
    function requestQuote(cart){
      if(owner!==account())invalidate();
      let lines;try{lines=cart.lines.map(raw=>{const line=selection(raw);return {provider:line.provider,productId:line.productId,merchantDomain:line.merchantDomain,condition:line.condition,quantity:line.quantity,options:line.options};});}catch(error){return Promise.reject(error);}
      if(!lines.length||!identifier(cart.revision,80))return Promise.reject(fail('invalid_selection'));
      if(quoteLimits({lines}).length){state.error='quote_too_large';state.quoteStatus='error';return Promise.reject(fail('quote_too_large'));}
      const revision=cart.revision,body=JSON.stringify({cartRevision:revision,lines,destination:{country:'DZ'},currency:'USD'});
      if(pending&&body===requestBody)return pending;
      if(body!==requestBody){invalidate();requestBody=body;}
      if(state.quote||!requestId){if(typeof random?.randomUUID!=='function')return Promise.reject(fail('secure_random_unavailable'));requestId=random.randomUUID();}
      const ticket=epoch,accountVersion=account();state.quote=null;state.quoteStatus='loading';state.error='';
      const key=requestId;
      const task=Promise.resolve().then(()=>{if(ticket!==epoch)return null;if(accountVersion!==account()||cart.revision!==revision){invalidate();return null;}return auth.api('/commerce/quotes',{method:'POST',body,idempotencyKey:key});}).then(value=>{
        if(ticket!==epoch)return null;if(accountVersion!==account()||cart.revision!==revision){invalidate();return null;}
        const result=quoteShape(value,revision,now(),lines);state.quote=result;state.quoteStatus='ready';return result;
      }).catch(error=>{if(ticket===epoch&&accountVersion===account()){state.quoteStatus='error';state.error=error.code||'quote_unavailable';if(['quote_expired','quote_invalid','invalid_quote'].includes(error.code))requestId='';}throw error;});
      pending=task;const settled=()=>{if(pending===task)pending=null;};task.then(settled,settled);return task;
    }
    function requestService(cart){
      if(owner!==account())invalidate();
      if(state.capabilities?.serviceRequests?.create!==true)return Promise.reject(fail('service_requests_unavailable'));
      if(state.serviceRequest&&state.serviceRequest.cartRevision===cart.revision)return Promise.resolve(state.serviceRequest);
      const quote=currentQuote(cart);
      // An uncertain POST retry must retain its key even if the quote expires in
      // transit. The server replays completed requests before rechecking expiry.
      let input;
      if(serviceBody&&JSON.parse(serviceBody).cartRevision===cart.revision)input=JSON.parse(serviceBody);
      else if(quote)input={quoteId:quote.quoteId,cartRevision:quote.cartRevision,cartHash:quote.cartHash};
      else return Promise.reject(fail('quote_expired'));
      const body=JSON.stringify(input);
      if(servicePending&&body===serviceBody)return servicePending;
      if(body!==serviceBody){serviceBody=body;serviceId='';}
      if(!serviceId){if(typeof random?.randomUUID!=='function')return Promise.reject(fail('secure_random_unavailable'));serviceId=random.randomUUID();}
      const ticket=epoch,accountVersion=account(),revision=cart.revision;
      state.serviceRequestStatus='loading';state.serviceRequestError='';state.serviceRequestRetryable=false;
      const key=serviceId;
      const task=Promise.resolve().then(()=>{if(ticket!==epoch)return null;if(accountVersion!==account()||cart.revision!==revision){invalidate();return null;}return auth.api('/commerce/service-requests',{method:'POST',body,idempotencyKey:key});}).then(value=>{
        if(ticket!==epoch)return null;
        if(accountVersion!==account()||cart.revision!==revision){invalidate();return null;}
        const result=serviceRequestShape(value,input);state.serviceRequest=result;state.serviceRequestStatus='ready';state.serviceRequestRetryable=false;return result;
      }).catch(error=>{
        if(ticket===epoch&&accountVersion===account()){
          state.serviceRequestStatus='error';state.serviceRequestError=error.code||'service_request_unavailable';
          // These exact server responses occur before any service record commit.
          // A network failure, 5xx, in-flight operation or conflict is ambiguous
          // and must keep its original body/key for an idempotent retry.
          const rejectedStatus={quote_expired:409,quote_not_found:404,cart_changed:409};
          if(Object.hasOwn(rejectedStatus,error.code)&&error.status===rejectedStatus[error.code]&&serviceBody===body&&serviceId===key){
            serviceBody='';serviceId='';
            if(state.quote?.quoteId===input.quoteId){state.quote=null;state.quoteStatus='idle';requestId='';}
          }
          state.serviceRequestRetryable=Boolean(serviceBody&&serviceId);
        }
        throw error;
      });
      servicePending=task;const settled=()=>{if(servicePending===task)servicePending=null;};task.then(settled,settled);return task;
    }
    async function capabilities(){
      if(state.capabilities)return state.capabilities;if(capabilityPending)return capabilityPending;
      capabilityPending=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{
        const response=await transport(auth.config.apiBase+'/commerce/capabilities',{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
        const reader=response.body?.getReader();if(!response.ok||!reader)throw fail('capabilities_unavailable');let raw='',bytes=0;const decoder=new TextDecoder();
        for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>32768){await reader.cancel();throw fail('invalid_capabilities');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
        state.capabilities=capabilitiesShape(JSON.parse(raw));return state.capabilities;
      }finally{clearTimeout(timer);controller.abort();}})();
      try{return await capabilityPending;}finally{capabilityPending=null;}
    }
    return Object.freeze({state,invalidate,currentQuote,requestQuote,requestService,capabilities,canCheckout:()=>false});
  }
  return Object.freeze({createCart,lineKey,selection,optionsOf,createClient,quoteShape,capabilitiesShape,quoteLimits,serviceRequestShape,orderShape,ordersShape});
});
