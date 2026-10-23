'use strict';
const get=id=>document.getElementById(id);
const sizes={desktop:[1440,960],mobile:[390,844],tablet:[768,1024],narrow:[320,780]};
function comparison(){
  const viewport=get('viewport').value,[w,h]=sizes[viewport];
  const chosen=get('screen').value,screen=chosen==='shop'?'shop-grid':chosen==='menu'?(viewport==='desktop'?'categories':'menu-expanded'):chosen;
  for(const version of ['before','after']){const img=get(version);img.src='evidence/'+(version==='before'?get('baseline').value:'after')+'/chromium-'+viewport+'-'+screen+'.png';img.alt=(version==='before'?(get('baseline').value==='v1'?'First refinement':'Released baseline'):'Signature 2.0')+' · '+screen+' · '+viewport+' · offline fixture';img.width=w;img.height=h;}
  get('comparison').style.aspectRatio=w+'/'+h;get('comparison').style.maxWidth=viewport==='desktop'?'100%':w+'px';get('open-after').href=get('after').src;
}
get('screen').addEventListener('change',comparison);get('viewport').addEventListener('change',comparison);
get('reveal').addEventListener('input',()=>get('comparison').style.setProperty('--reveal',(100-Number(get('reveal').value))+'%'));
get('theme').addEventListener('click',()=>{const light=document.documentElement.dataset.theme!=='light';document.documentElement.dataset.theme=light?'light':'dark';get('theme').textContent=light?'Switch to dark':'Switch to light';});
get('size').addEventListener('change',()=>document.documentElement.style.setProperty('--review-icon-size',get('size').value+'px'));
for(const name of Object.keys(AnoXIcons.paths)){const cell=document.createElement('div');cell.className='glyph';cell.innerHTML=AnoXIcons.render(name);const label=document.createElement('p');label.textContent=name;cell.append(label);get('atlas').append(cell);}
for(const [id,name] of [['sample-search','search'],['sample-heart','heart'],['sample-disabled','send'],['sample-account','user']])get(id).innerHTML=AnoXIcons.render(name);
get('sample-heart').addEventListener('click',()=>{const selected=get('sample-heart').getAttribute('aria-pressed')!=='true';get('sample-heart').setAttribute('aria-pressed',String(selected));get('state-feedback').textContent=selected?'Saved preview selected. No customer data was written.':'Saved preview cleared. No customer data was written.';});
get('sample-search').addEventListener('click',()=>{get('screen').value='search';comparison();get('comparison').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});});

const focusDetails={
 'desktop-header-controls':[280,140,'The 38px graphite control has a lit upper edge and a darker inset base. The assistant gains a distinct rim; search stays quieter.'],
 'mobile-header-controls':[390,200,'The same hierarchy at mobile scale. Touch targets remain at least 44px; typography and branding are preserved.'],
 'mobile-navigation':[390,80,'The active destination gains a full, framed control shape. The navigation keeps its existing layout height.'],
 'desktop-category-controls':[360,320,'Distinct category silhouettes sit on quiet inset tiles. Search categories are easier to identify at a glance.'],
 'mobile-category-controls':[358,320,'Original category artwork remains legible in the mobile search panel.'],
 'desktop-wishlist-rest':[104,104,'A floating circular control with a directional edge and bounded 8px backdrop blur.'],
 'desktop-wishlist-selected':[104,104,'A porcelain surface and filled heart make the saved state unmistakable without relying on color alone.'],
 'mobile-product-actions':[358,100,'The text-led cart action remains dominant; the heart receives the same tactile control treatment.'],
 'desktop-header-controls-light':[280,140,'Light surfaces use the same optical construction with a darker edge and soft inner light.'],
 'mobile-header-controls-light':[390,200,'Light-mode mobile controls preserve clear boundaries and readable glyphs.']
};
function focusComparison(){
 const key=get('focus-screen').value,[w,h,caption]=focusDetails[key],version=get('baseline').value,scale=Number(get('magnification').value);
 for(const side of ['before','after']){const img=get('focus-'+side);img.src='evidence/focus/'+(side==='before'?version:'after')+'/chromium-'+key+'.png';img.alt=(side==='after'?'Signature 2.0':version==='v1'?'First refinement':'Released baseline')+' · '+key+' · offline fixture crop';img.width=w;img.height=h;img.style.width=(w*scale)+'px';}
 get('focus-caption').textContent=caption+' '+(scale===1?'Shown at native size, reduced only to fit narrow screens.':'Detail magnification: 200%, reduced only to fit the available width.');
 get('focus-before-label').textContent=version==='v1'?'First refinement':'Released baseline';
 get('before-label').textContent=version==='v1'?'FIRST REFINEMENT':'RELEASED BASELINE';
}
get('baseline').addEventListener('change',()=>{comparison();focusComparison();});
get('focus-screen').addEventListener('change',focusComparison);get('magnification').addEventListener('change',focusComparison);
comparison();focusComparison();
