'use strict';
const get=id=>document.getElementById(id);
const sizes={desktop:[1440,960],mobile:[390,844],tablet:[768,1024],narrow:[320,780]};
function comparison(){
  const viewport=get('viewport').value,[w,h]=sizes[viewport];
  const chosen=get('screen').value,screen=chosen==='shop'?'shop-grid':chosen==='menu'?(viewport==='desktop'?'categories':'menu-expanded'):chosen;
  for(const version of ['before','after']){const img=get(version);img.src='evidence/'+version+'/chromium-'+viewport+'-'+screen+'.png';img.alt=(version==='before'?'Released baseline':'Icon candidate')+' · '+screen+' · '+viewport+' · offline fixture';img.width=w;img.height=h;}
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
