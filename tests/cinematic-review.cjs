'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'docs/cinematic/preview.html'),'utf8'),script=fs.readFileSync(path.join(root,'docs/cinematic/preview.js'),'utf8');
function review(url,{missing=false}={}){
 const events={},nodes={},location=new URL(url);
 function node(id,tagName='DIV',dataset={}){const attributes={},handlers={},element={id,tagName,dataset,hidden:false,textContent:'',value:'',style:{setProperty(){}},classList:{toggle(){}},addEventListener:(event,handler)=>handlers[event]=handler,setAttribute:(name,value)=>attributes[name]=value,getAttribute:name=>attributes[name],removeAttribute:name=>delete attributes[name],handlers};nodes[id]=element;return element;}
 for(const match of html.matchAll(/\bid="([^"]+)"/g))node(match[1]);
 const viewport=['mobile','desktop'].map(value=>node('viewport-'+value,'BUTTON',{viewport:value})),mode=['both','before','after'].map(value=>node('mode-'+value,'BUTTON',{mode:value}));
 for(const side of ['before','after']){const img=nodes[side+'-image'];Object.defineProperty(img,'src',{get(){return this._src;},set(value){this._src=value;this.naturalWidth=this.width;this.naturalHeight=this.height;if(missing&&side==='before')this.onerror?.();else this.onload?.();}});}
 nodes['interactive-preview'].hidden=true;nodes['local-preview-note'].hidden=false;
 const document={getElementById:id=>nodes[id],querySelector:selector=>selector==='.toolbar'?nodes.toolbar:undefined,querySelectorAll:selector=>selector==='[data-viewport]'?viewport:selector==='[data-mode]'?mode:[]};node('toolbar','FORM');
 const history={replaceState(_state,_title,hash){location.hash=hash;}};
 vm.runInNewContext(script,{document,location,history,URLSearchParams,addEventListener:(name,handler)=>events[name]=handler});
 return {nodes,events,location};
}
test('comparison deep links select real captures and reject unrecognized path values',()=>{
 const {nodes}=review('https://example.test/docs/cinematic/preview.html#scene=pdp-light&viewport=desktop&mode=after&actual=1');
 assert.equal(nodes['before-image'].src,'evidence/baseline/chromium-desktop-pdp-light.png');assert.equal(nodes['after-image'].src,'evidence/candidate/chromium-desktop-pdp-light.png');
 assert.equal(nodes['comparison-images'].dataset.mode,'after');assert.equal(nodes['actual-size'].getAttribute('aria-pressed'),'true');assert.match(nodes['comparison-status'].textContent,/matching Chromium/);
 const unsafe=review('https://example.test/#scene=../../private&viewport=../secrets&mode=__proto__');
 assert.equal(unsafe.nodes['before-image'].src,'evidence/baseline/chromium-mobile-pdp.png');assert.equal(unsafe.nodes['comparison-images'].dataset.mode,'both');
});
test('interactive preview is exposed only for loopback web origins; static file review stays usable',()=>{
 for(const url of ['http://127.0.0.1:8787/docs/cinematic/preview.html','http://localhost:8787/docs/cinematic/preview.html','http://[::1]:8787/docs/cinematic/preview.html'])assert.equal(review(url).nodes['interactive-preview'].hidden,false,url);
 for(const url of ['https://anox.app/docs/cinematic/preview.html','https://127.0.0.1.example.test/','file:///tmp/preview.html']){const {nodes}=review(url);assert.equal(nodes['interactive-preview'].hidden,true,url);assert.equal(nodes['local-preview-note'].hidden,false);assert.match(nodes['comparison-status'].textContent,/matching Chromium/);}
});
test('a missing image is disclosed as an incomplete comparison',()=>{
 const {nodes}=review('file:///tmp/preview.html',{missing:true});assert.equal(nodes['before-image'].hidden,true);assert.equal(nodes['before-error'].hidden,false);assert.equal(nodes['before-link'].getAttribute('aria-disabled'),'true');assert.match(nodes['comparison-status'].textContent,/not yet a complete visual comparison/);
 let prevented=false;nodes['before-link'].handlers.click({currentTarget:nodes['before-link'],preventDefault(){prevented=true;}});assert.equal(prevented,true);
});
test('each screen option updates both capture paths without network dependencies',()=>{
 const {nodes,location}=review('file:///tmp/preview.html');
 for(const match of html.matchAll(/<option value="([^"]+)"/g)){const scene=match[1];nodes.scene.handlers.change({target:{value:scene}});assert.equal(nodes['before-image'].src,`evidence/baseline/chromium-mobile-${scene}.png`);assert.equal(nodes['after-image'].src,`evidence/candidate/chromium-mobile-${scene}.png`);assert.equal(new URLSearchParams(location.hash.slice(1)).get('scene'),scene);}
 assert.doesNotMatch(html,/<(?:script|link)[^>]+(?:src|href)=["']https?:/i);assert.doesNotMatch(script,/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
});
