#!/usr/bin/env node
'use strict';
// Canonical modules are embedded in the single deployable HTML file. Keep the
// existing catalog builder as the only implementation of CSP hashing.
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('./build-catalog.cjs');
const MODULES = Object.freeze({
  icons:{name:'icons.js',start:'/* ANOX_ICONS_START */',end:'/* ANOX_ICONS_END */'},
  auth:{name:'auth.js',start:'(function(root,factory){const lib=factory();',end:'\n;\n(function (root, factory) {'},
  commerce:{name:'commerce-client.js',start:'(function exposeAnoXCommerce(root, factory) {',end:'/* ANOX_COMMERCE_CLIENT_END */'}
});
const ICON_STYLES = Object.freeze({name:'icons.css',start:'/* ANOX_ICON_STYLES_START */',end:'/* ANOX_ICON_STYLES_END */'});
const STYLES = Object.freeze({iconStyles:ICON_STYLES,cinematicStyles:{name:'cinematic.css',start:'/* ANOX_CINEMATIC_STYLES_START */',end:'/* ANOX_CINEMATIC_STYLES_END */'}});
function bounds(html,spec) {
  const start=html.indexOf(spec.start),end=html.indexOf(spec.end,start);
  if(start<0||end<start)throw Error(spec.name+' module boundary missing');
  if(html.indexOf(spec.start,start+spec.start.length)!==-1||html.indexOf(spec.end,end+spec.end.length)!==-1)throw Error(spec.name+' module boundary ambiguous');
  return {start,end};
}
function replaceModule(html,source,spec) {
  const {start,end}=bounds(html,spec);
  if(typeof source!=='string'||!source.trim().startsWith(spec.start)||/<\/script/i.test(source)||source.includes(spec.end))throw Error('Invalid '+spec.name+' canonical source');
  return html.slice(0,start)+source.trim()+'\n'+html.slice(end);
}
function readSources(root) {
  return {catalog:fs.readFileSync(path.join(root,'catalog-live.js'),'utf8'),auth:fs.readFileSync(path.join(root,'auth.js'),'utf8'),commerce:fs.readFileSync(path.join(root,'commerce-client.js'),'utf8'),icons:fs.readFileSync(path.join(root,'icons.js'),'utf8'),...Object.fromEntries(Object.entries(STYLES).map(([key,spec])=>[key,fs.readFileSync(path.join(root,spec.name),'utf8')]))};
}
function build(html,sources) {
  for(const [key,spec] of Object.entries(MODULES))html=replaceModule(html,sources[key],spec);
  for(const [key,spec] of Object.entries(STYLES)){
    const {start,end}=bounds(html,spec),source=sources[key];
    if(typeof source!=='string'||!source.trim()||/<\/style/i.test(source)||source.includes(spec.start)||source.includes(spec.end))throw Error('Invalid '+spec.name+' canonical source');
    html=html.slice(0,start)+spec.start+'\n'+source.trim()+'\n'+html.slice(end);
  }
  return catalog.build(html,sources.catalog);
}
function check(html,sources) {
  const issues=catalog.check(html,sources.catalog);
  for(const [key,spec] of Object.entries(MODULES)){
    const {start,end}=bounds(html,spec);
    if(html.slice(start,end).trim()!==sources[key].trim())issues.push(spec.name+' differs from its canonical source');
  }
  for(const [key,spec] of Object.entries(STYLES)){
    const {start,end}=bounds(html,spec);
    if(html.slice(start+spec.start.length,end).trim()!==sources[key].trim())issues.push(spec.name+' differs from its canonical source');
  }
  return issues;
}
module.exports={MODULES,replaceModule,readSources,build,check};
if(require.main===module){
  const root=path.resolve(__dirname,'..'),file=path.join(root,'index.html');
  const html=fs.readFileSync(file,'utf8'),sources=readSources(root);
  if(process.argv.includes('--check')){
    const issues=check(html,sources);
    if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}
    else console.log('Catalog, auth, commerce, icon and cinematic sources and inline CSP verified');
  }else{
    const result=build(html,sources);
    if(result!==html)fs.writeFileSync(file,result);
    console.log('Canonical clients and inline CSP generated');
  }
}
