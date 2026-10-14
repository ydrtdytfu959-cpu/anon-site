'use strict';
const product = (patch = {}) => ({
  id:'shoe_1',title:'Real shoe',description:'Full description '.repeat(150),brands:[{id:'b1',name:'Nike'}],
  images:Array.from({length:12},(_,i)=>({url:`https://cdn.trychannel3.com/${i}.jpg`,cleaned_url:null,alt_text:'View '+i,is_main_image:i===0,shot_type:'detail'})),
  category:{slug:'shoes',title:'Shoes',path:[{slug:'shoes',title:'Shoes'}],has_children:false},gender:null,age:'adult',
  offers:[{domain:'nike.com',url:'https://buy.trychannel3.com/tracked?a=1',price:{price:99.95,currency:'USD',compare_at_price:120},availability:'InStock',condition:'new',max_commission_rate:0.05,dimensions:{length:null,width:null,height:null,weight:{number:0.5,unit:'kg'}}}],
  variants:{options:[{name:'Color',values:[{label:'Navy Blue',exists:true,available:'InStock',thumbnail_url:'https://cdn.trychannel3.com/navy.jpg',product_id:null},{label:'Red',exists:false,available:null,thumbnail_url:null,product_id:'shoe_red'}]}],selected:[{name:'Color',label:'Navy Blue'}]},
  materials:['Cotton'],key_features:['Cushioned'],structured_attributes:{color:['Navy Blue']},...patch
});
const envelope = (patch = {}, detail = product()) => {const now=Date.now();return {provider:'channel3',data:{product:detail},status:'fresh',error:null,selectionMismatch:[],fetchedAt:new Date(now).toISOString(),expiresAt:new Date(now+30000).toISOString(),...patch};};
module.exports={product,envelope};
