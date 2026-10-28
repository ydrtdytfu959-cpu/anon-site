'use strict';
(() => {
 const scenes={
  pdp:['Product detail','The flagship product composition, with supplied merchant information and real selection controls.','pdp-full'],
  'pdp-actions':['Product selection','Current price, source-supplied options, quantity, wishlist and a saved selection action.'],
  'pdp-light':['Product detail · light','The same product composition in the light palette, without changing the supplied photograph.'],
  'pdp-rtl':['Product detail · Arabic','Arabic labels, RTL composition and mixed-direction product data.','pdp-rtl-full'],
  'pdp-long':['Long product title','Realistic text pressure: a lengthy supplied title remains readable without clipping.'],
  'pdp-missing':['Missing imagery','A deliberate image fallback and truthful unknown offer state; no replacement product is invented.'],
  'pdp-stale':['Expired product evidence','Expired price and offer evidence cannot enable an actionable purchase state.'],
  'pdp-footwear':['Footwear presentation','A conventional product packshot within the shared product architecture.'],
  'pdp-beauty':['Beauty presentation','Small-format merchandise uses the same controls and preserves its image proportions.'],
  home:['Homepage','The storefront introduction and discovery hierarchy.','home-full'],
  'home-light':['Homepage · light','The editorial homepage in the light palette.'],
  'home-rtl':['Homepage · Arabic','Arabic navigation, reading order and discovery composition.'],
  shop:['Discovery','Source-attributed product cards, catalog controls and a responsive result grid.'],
  search:['Search','The search dialogue with existing query and category controls.'],
  wishlist:['Wishlist','Saved choices retain their source identity and existing persistence.'],
  cart:['Cart','Saved selections, explicit cost verification and disabled payment collection.','cart-full'],
  account:['Account','A synthetic preview profile, using the existing account renderer.'],
  signin:['Sign in','Authentication presentation without changing identity configuration or session rules.'],
  request:['Service inquiry','An existing inquiry form, with clear labels and no implied merchant purchase.'],
  orders:['Orders','Existing order history and honest empty states; no invented fulfillment events.'],
  assistant:['AnoX assistant','The conversation surface and input controls; no external assistant request is made.']
 };
 const state={scene:'pdp',viewport:'mobile',mode:'both',actual:false};
 const $=id=>document.getElementById(id);
 const captures={before:{folder:'baseline',label:'Before'},after:{folder:'candidate',label:'After'}};
 let generation=0;
 function readHash(){const p=new URLSearchParams(location.hash.slice(1));if(Object.hasOwn(scenes,p.get('scene')))state.scene=p.get('scene');if(['mobile','desktop'].includes(p.get('viewport')))state.viewport=p.get('viewport');if(['both','before','after'].includes(p.get('mode')))state.mode=p.get('mode');state.actual=p.get('actual')==='1';}
 function path(folder,scene){return 'evidence/'+folder+'/chromium-'+state.viewport+'-'+scene+'.png';}
 function render({save=true}={}){
  const current=++generation,[title,description,full]=scenes[state.scene],width=state.viewport==='mobile'?390:1440,height=state.viewport==='mobile'?844:960;
  $('scene').value=state.scene;$('comparison-title').textContent=title;$('scene-description').textContent=description;
  for(const button of document.querySelectorAll('[data-viewport]'))if(button.tagName==='BUTTON')button.setAttribute('aria-pressed',String(button.dataset.viewport===state.viewport));
  for(const button of document.querySelectorAll('[data-mode]'))if(button.tagName==='BUTTON')button.setAttribute('aria-pressed',String(button.dataset.mode===state.mode));
  $('actual-size').setAttribute('aria-pressed',String(state.actual));
  const grid=$('comparison-images');grid.dataset.viewport=state.viewport;grid.dataset.mode=state.mode;grid.classList.toggle('is-actual',state.actual);grid.style.setProperty('--capture-width',width+'px');
  $('full-captures').hidden=!full;$('comparison-status').textContent='Loading '+title.toLowerCase()+' · '+width+' × '+height+'…';
  let complete=0,failed=0;
  function settled(){if(current!==generation)return;if(++complete===2)$('comparison-status').textContent=failed?'One or more captures are unavailable. This state is not yet a complete visual comparison.':title+' · '+width+' × '+height+' · matching Chromium captures · synthetic fixtures';}
  for(const [key,capture] of Object.entries(captures)){
   const img=$(key+'-image'),error=$(key+'-error'),src=path(capture.folder,state.scene),link=$(key+'-link');
   error.hidden=true;img.hidden=false;img.width=width;img.height=height;img.alt=capture.label+': AnoX '+title.toLowerCase()+' at '+width+' pixels wide, using synthetic fixtures';link.href=src;link.removeAttribute('aria-disabled');
   $(key+'-detail').textContent=width+' × '+height+' · Chromium · synthetic fixtures';
   if(full)$(key+'-full').href=path(capture.folder,full);
   img.onload=()=>{if(current!==generation)return;$(key+'-detail').textContent=img.naturalWidth+' × '+img.naturalHeight+' · Chromium · synthetic fixtures';settled();};
   img.onerror=()=>{if(current!==generation)return;img.hidden=true;error.hidden=false;failed++;link.setAttribute('aria-disabled','true');settled();};
   img.src=src;
  }
  if(save){const params=new URLSearchParams({scene:state.scene,viewport:state.viewport,mode:state.mode});if(state.actual)params.set('actual','1');history.replaceState(null,'','#'+params.toString());}
 }
 $('scene').addEventListener('change',e=>{state.scene=e.target.value;render();});
 $('viewport-controls').addEventListener('click',e=>{const button=e.target.closest('[data-viewport]');if(button){state.viewport=button.dataset.viewport;render();}});
 $('mode-controls').addEventListener('click',e=>{const button=e.target.closest('[data-mode]');if(button){state.mode=button.dataset.mode;render();}});
 $('actual-size').addEventListener('click',()=>{state.actual=!state.actual;render();});
 document.querySelector('.toolbar').addEventListener('submit',e=>e.preventDefault());
 for(const key of Object.keys(captures))$(key+'-link').addEventListener('click',e=>{if(e.currentTarget.getAttribute('aria-disabled')==='true')e.preventDefault();});
 if(['127.0.0.1','localhost','[::1]'].includes(location.hostname)&&['http:','https:'].includes(location.protocol)){$('interactive-preview').hidden=false;$('local-preview-note').hidden=true;}
 addEventListener('hashchange',()=>{readHash();render({save:false});});
 readHash();render({save:false});
})();
