(function(root,factory){const lib=factory();if(typeof module==='object'&&module.exports)module.exports=lib;else{if(root.AnoXAnalytics?.isMetricsFrame)return;let storage;try{storage=root.sessionStorage;}catch{}root.AnoXAuth=lib.createClient({storage,fetch:root.fetch.bind(root),onChange:()=>root.dispatchEvent(new Event('anox-auth-change'))});root.addEventListener('storage',e=>{if(e.key==='anox:logout:v1'||e.key===null)root.AnoXAuth.signOut(false);});root.AnoXAuth.onLogout(()=>{try{root.localStorage.setItem('anox:logout:v1',String(Date.now()));}catch{}});}})(typeof window==='object'?window:null,function(){
  'use strict';
  const config=Object.freeze({region:'us-east-2',clientId:'63738r9gpr126qpgp1a5cubchi',cognitoEndpoint:'https://cognito-idp.us-east-2.amazonaws.com/',apiBase:'https://zmumi2wruk.execute-api.us-east-2.amazonaws.com',sessionKey:'anox:auth:v1'});
  const text=(v,n=160)=>typeof v==='string'?v.slice(0,n):'';
  const fail=code=>Object.assign(Error(code),{code});
  function sessionShape(s){return s&&['idToken','accessToken','refreshToken'].every(k=>typeof s[k]==='string'&&s[k].length>0&&s[k].length<=20000)&&Number.isFinite(s.expiresAt)&&s.expiresAt>0?{idToken:s.idToken,accessToken:s.accessToken,refreshToken:s.refreshToken,expiresAt:s.expiresAt}:null;}
  function createClient({storage,fetch:transport=globalThis.fetch,onChange=()=>{}}={}){
    const state={session:null,user:null,orders:[],busy:false,error:'',loadStatus:'idle'};
    let generation=0,refreshing=null,loadPromise=null,logoutNotice=()=>{};
    try{state.session=sessionShape(JSON.parse(storage?.getItem(config.sessionKey)||'null'));}catch{}
    function write(value){state.session=value;try{if(value)storage?.setItem(config.sessionKey,JSON.stringify(value));else storage?.removeItem(config.sessionKey);}catch{}}
    const change=()=>{try{onChange();}catch{}};
    function clear(){generation++;refreshing=null;loadPromise=null;write(null);state.user=null;state.orders=[];state.busy=false;state.error='';state.loadStatus='idle';change();}
    async function json(url,options={}){
      const timeout=options.timeoutMs===18000?18000:12000;delete options.timeoutMs;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
      try{
        const r=await transport(url,{...options,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal});
        const reader=r.body?.getReader();let bytes=0,body='';if(!reader)throw fail('INVALID_RESPONSE');const decoder=new TextDecoder();
        for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2*1024*1024){await reader.cancel();throw fail('INVALID_RESPONSE');}body+=decoder.decode(value,{stream:true});}body+=decoder.decode();
        let data;try{data=JSON.parse(body);}catch{throw fail('INVALID_RESPONSE');}
        if(!data||typeof data!=='object'||Array.isArray(data))throw fail('INVALID_RESPONSE');
        if(!r.ok){const code=text(data.__type||data.code||data.error?.code||data.error,100).split('#').pop();throw Object.assign(fail(/^[A-Za-z0-9_]+$/.test(code)?code:'HTTP_'+r.status),{status:r.status});}
        return data;
      }finally{clearTimeout(timer);controller.abort();}
    }
    async function cognito(action,body){const allowed=['InitiateAuth','SignUp','ConfirmSignUp','ResendConfirmationCode','ForgotPassword','ConfirmForgotPassword','RevokeToken'];if(!allowed.includes(action))throw fail('INVALID_ACTION');return json(config.cognitoEndpoint,{method:'POST',headers:{'Content-Type':'application/x-amz-json-1.1','X-Amz-Target':'AWSCognitoIdentityProviderService.'+action},body:JSON.stringify(body)});}
    function from(result,prior=''){const a=result?.AuthenticationResult,ttl=Number(a?.ExpiresIn);const value=sessionShape({idToken:a?.IdToken,accessToken:a?.AccessToken,refreshToken:a?.RefreshToken||prior,expiresAt:Date.now()+Math.min(86400,Number.isFinite(ttl)&&ttl>0?ttl:3600)*1000-30000});if(!value)throw fail('INVALID_RESPONSE');return value;}
    function refresh(){
      if(refreshing)return refreshing;
      const session=state.session,epoch=generation;if(!session?.refreshToken)return Promise.reject(fail('UNAUTHORIZED'));
      const pending=(async()=>{const result=await cognito('InitiateAuth',{AuthFlow:'REFRESH_TOKEN_AUTH',ClientId:config.clientId,AuthParameters:{REFRESH_TOKEN:session.refreshToken}});if(epoch!==generation||state.session!==session)throw fail('STALE_SESSION');const next=from(result,session.refreshToken);write(next);return next;})();
      refreshing=pending;const done=()=>{if(refreshing===pending)refreshing=null;};pending.then(done,done);return pending;
    }
    async function validSession(){if(!state.session)return null;if(state.session.expiresAt>Date.now()+15000)return state.session;const epoch=generation;try{return await refresh();}catch(e){if(epoch===generation&&['NotAuthorizedException','UNAUTHORIZED'].includes(e.code))clear();throw e;}}
    async function signIn(email,password){clear();const epoch=generation;const result=await cognito('InitiateAuth',{AuthFlow:'USER_PASSWORD_AUTH',ClientId:config.clientId,AuthParameters:{USERNAME:email.trim().toLowerCase(),PASSWORD:password}});if(epoch!==generation)throw fail('STALE_SESSION');if(result.ChallengeName)throw fail('UNSUPPORTED_AUTH_CHALLENGE');write(from(result));change();}
    const signUp=(email,password)=>cognito('SignUp',{ClientId:config.clientId,Username:email.trim().toLowerCase(),Password:password,UserAttributes:[{Name:'email',Value:email.trim().toLowerCase()}]});
    const confirm=(email,code)=>cognito('ConfirmSignUp',{ClientId:config.clientId,Username:email.trim().toLowerCase(),ConfirmationCode:String(code).trim()});
    const resend=email=>cognito('ResendConfirmationCode',{ClientId:config.clientId,Username:email.trim().toLowerCase()});
    const forgot=email=>cognito('ForgotPassword',{ClientId:config.clientId,Username:email.trim().toLowerCase()});
    const reset=(email,code,password)=>cognito('ConfirmForgotPassword',{ClientId:config.clientId,Username:email.trim().toLowerCase(),ConfirmationCode:String(code).trim(),Password:password});
    function commerceBody(path, raw) {
      let data;try{data=JSON.parse(raw);}catch{throw fail('INVALID_BODY');}
      const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
      const only=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
      const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
      if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>32000)throw fail('INVALID_BODY');
      if(path==='/commerce/quotes'){
        if(!only(data,['cartRevision','lines','destination','currency'])||(!identifier(data.cartRevision)||data.cartRevision.length>80)||data.currency!=='USD'||!only(data.destination,['country'])||data.destination.country!=='DZ'||!Array.isArray(data.lines)||!data.lines.length||data.lines.length>10)throw fail('INVALID_BODY');
        for(const line of data.lines){
          if(!only(line,['provider','productId','merchantDomain','condition','quantity','options'])||line.provider!=='channel3'||!identifier(line.productId)||line.productId.length>80||typeof line.merchantDomain!=='string'||line.merchantDomain.length>253||!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(line.merchantDomain)||!['new','used',null].includes(line.condition)||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>20||!object(line.options)||Object.keys(line.options).length>8)throw fail('INVALID_BODY');
          for(const [key,value] of Object.entries(line.options))if(!key||key.length>60||['__proto__','constructor','prototype'].includes(key)||typeof value!=='string'||!value||value.length>80||/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(key+value))throw fail('INVALID_BODY');
        }
        const selections=data.lines.map(line=>[line.productId,Object.keys(line.options).sort().map(key=>[key,line.options[key]])]);
        if(new Set(selections.map(selection=>JSON.stringify(selection))).size>5)throw fail('INVALID_BODY');
        const identities=data.lines.map((line,i)=>JSON.stringify([line.provider,...selections[i],line.merchantDomain,line.condition]));
        if(new Set(identities).size!==identities.length)throw fail('INVALID_BODY');
      }else if(path==='/commerce/checkout-attempts'||path==='/commerce/service-requests'){
        if(!only(data,['quoteId','cartRevision','cartHash'])||!identifier(data.quoteId)||(!identifier(data.cartRevision)||data.cartRevision.length>80)||typeof data.cartHash!=='string'||!/^[a-f0-9]{64}$/.test(data.cartHash))throw fail('INVALID_BODY');
      }else if(!only(data,[]))throw fail('INVALID_BODY');
      return JSON.stringify(data);
    }
    async function api(path,options={},retry=true){
      const method=options.method||'GET',commerce=typeof path==='string'&&path.startsWith('/commerce/');
      const read=method==='GET'&&(/^(?:\/commerce\/orders\/[A-Za-z0-9_-]{1,80}|\/commerce\/orders(?:\?cursor=[A-Za-z0-9_-]{1,80})?)$/.test(path));
      const post=method==='POST'&&(path==='/commerce/quotes'||path==='/commerce/checkout-attempts'||path==='/commerce/service-requests'||/^\/commerce\/orders\/[A-Za-z0-9_-]{1,80}\/(?:cancel|refund)$/.test(path));
      if(commerce?!(read||post):!['/me','/orders'].includes(path)||!(method==='GET'||path==='/me'&&method==='PUT'))throw fail('INVALID_PATH');
      const headers={};let body;
      if(post){if(typeof options.idempotencyKey!=='string'||!/^[-A-Za-z0-9_]{16,128}$/.test(options.idempotencyKey))throw fail('INVALID_IDEMPOTENCY_KEY');body=commerceBody(path,options.body);headers['Content-Type']='application/json';headers['Idempotency-Key']=options.idempotencyKey;}
      if(method==='PUT'){let data;try{data=JSON.parse(options.body);}catch{throw fail('INVALID_BODY');}if(!data||Object.keys(data).some(k=>k!=='displayName')||typeof data.displayName!=='string'||data.displayName.length>160)throw fail('INVALID_BODY');headers['Content-Type']='application/json';body=JSON.stringify(data);}
      const epoch=generation,session=await validSession();if(epoch!==generation||!session)throw fail('UNAUTHORIZED');headers.Authorization='Bearer '+session.idToken;
      try{const data=await json(config.apiBase+path,{method,headers,body,...(path==='/commerce/quotes'&&method==='POST'?{timeoutMs:18000}:{})});if(epoch!==generation)throw fail('STALE_SESSION');return data;}
      catch(e){if(epoch===generation&&retry&&e.status===401){await refresh();return api(path,options,false);}throw e;}
    }
    function normalizeOrders(items){return (Array.isArray(items)?items:[]).slice(0,100).filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).map(x=>({orderId:text(x.orderId||x.id,160),createdAt:text(x.createdAt,50),status:text(x.status,80),paymentStatus:text(x.paymentStatus,80),amountTotal:Number.isSafeInteger(x.amountTotal)&&x.amountTotal>=0&&x.amountTotal<=1e12?x.amountTotal:null,currency:typeof x.currency==='string'&&['USD','DZD'].includes(x.currency.toUpperCase())?x.currency.toUpperCase():null}));}
    async function loadAccount(force=false){
      if(!state.session)return;if(loadPromise)return loadPromise;if(!force&&['ready','error'].includes(state.loadStatus))return;
      const epoch=generation;state.busy=true;state.loadStatus='loading';state.error='';
      const pending=(async()=>{try{const [me,orders]=await Promise.all([api('/me'),api('/orders')]);if(epoch!==generation)return;state.user=me.user&&typeof me.user==='object'?{displayName:text(me.user.displayName),email:text(me.user.email)}:{};state.orders=normalizeOrders(orders.orders);state.loadStatus='ready';}catch(e){if(epoch===generation){state.error=e.code||'UNAVAILABLE';state.loadStatus='error';}}finally{if(epoch===generation){state.busy=false;change();}}})();
      loadPromise=pending;await pending;if(loadPromise===pending)loadPromise=null;
    }
    function signOut(revoke=true){const token=state.session?.refreshToken;clear();if(revoke){logoutNotice();if(token)void cognito('RevokeToken',{Token:token,ClientId:config.clientId}).catch(()=>{});}}
    return Object.freeze({config,state,sessionVersion:()=>generation,cancelPending(){if(!state.session)generation++;},refresh,validSession,signIn,signUp,confirm,resend,forgot,reset,api,loadAccount,signOut,onLogout(fn){logoutNotice=fn;}});
  }
  return Object.freeze({config,createClient});
});
