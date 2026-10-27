'use strict';
// Synthetic data for offline UI review only. Never imported by the storefront.
const fixture=require('../channel3-detail.cjs');
const CLOCK=Date.parse('2026-10-25T12:00:00.000Z');
const retailers={Nike:['Nike','nike.com','nike'],adidas:['adidas','adidas.com','adidas'],Sephora:['Sephora Collection','sephora.com','sephora'],"Levi's":["Levi's",'levi.com','levis'],'TJ Maxx':['Other','tjmaxx.tjx.com','tjmaxx'],'e.l.f. cosmetics':['e.l.f. Cosmetics','elfcosmetics.com','elf']};
const image='https://cdn.trychannel3.com/cinematic-fixture/jacket.svg';
function searchProduct(query,n){const [brand,domain,tag]=retailers[query]||retailers.Nike;return {id:`cinematic-${tag}-${n}`,title:`Preview technical jacket ${n+1}`,brands:[{id:tag,name:brand}],category:{slug:'clothing',title:'Clothing'},images:[{url:image}],offers:[{url:`https://buy.trychannel3.com/cinematic-fixture-${tag}-${n}`,domain,availability:'InStock',condition:'new',price:{price:220.50,currency:'USD'}}]};}
function detail(id,options={},now=CLOCK){
 const d=fixture.product({id,title:id==='cinematic-long'?'Preview technical field jacket with an exceptionally long descriptive product title — weather-ready layering for everyday movement':'Technical field jacket · preview',description:'Original synthetic product and artwork for interface review only. This is not merchandise, a retailer offer, or a product recommendation.\n\nThis deliberately realistic description tests long-form product content, reading rhythm, and the separation of supplied information from purchasing capabilities.',brands:[{id:'nike',name:'Nike'}],images:[0,1,2].map(n=>({url:image+'?view='+n,alt_text:'Original synthetic technical jacket · fixture view '+(n+1),is_main_image:n===0})),category:{slug:'clothing',title:'Clothing'},offers:[{domain:'nike.com',url:'https://buy.trychannel3.com/cinematic-fixture',price:{price:220.50,currency:'USD'},availability:'InStock',condition:'new',dimensions:{weight:{number:.65,unit:'kg'}}}],variants:{options:[{name:'Color',values:[{label:'Graphite',exists:true,available:'InStock'},{label:'Stone',exists:true,available:'InStock'}]},{name:'Size',values:[{label:'S',exists:true,available:'InStock'},{label:'M',exists:true,available:'InStock'},{label:'L',exists:true,available:'InStock'},{label:'XL',exists:true,available:'OutOfStock'}]}],selected:[{name:'Color',label:options.Color||'Graphite'},{name:'Size',label:options.Size||'M'}]},materials:['Synthetic fixture fabric'],key_features:['Preview construction details','Accessible option selection'],structured_attributes:{color:['Graphite']}});
 if(id==='cinematic-footwear'||id==='cinematic-beauty'){
  const beauty=id==='cinematic-beauty';d.title=beauty?'Studio formula · beauty preview':'Everyday form · footwear preview';
  d.images=[{url:'https://cdn.trychannel3.com/cinematic-fixture/'+(beauty?'beauty':'footwear')+'.svg',alt_text:'Original illustrative fixture, not merchandise',is_main_image:true}];
  d.variants=beauty?{options:[{name:'Volume',values:[{label:'30 ml',exists:true,available:'InStock'},{label:'60 ml',exists:true,available:'InStock'}]}],selected:[{name:'Volume',label:options.Volume||'30 ml'}]}:d.variants;
  if(beauty){d.brands=[{id:'sephora',name:'Sephora Collection'}];d.offers[0].domain='sephora.com';}
 }
 if(id==='cinematic-missing'){d.images=[];d.description=null;d.materials=[];d.key_features=[];d.structured_attributes={};d.variants={options:[],selected:[]};d.offers[0].price={price:null,currency:"USD"};d.offers[0].availability=null;}
 return fixture.envelope({fetchedAt:new Date(now).toISOString(),expiresAt:new Date(now+30000).toISOString()},d);
}
module.exports={CLOCK,searchProduct,detail};
