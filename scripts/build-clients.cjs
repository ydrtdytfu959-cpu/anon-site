#!/usr/bin/env node
'use strict';
// Canonical modules are embedded in the single deployable HTML file. Keep the
// existing catalog builder as the only implementation of CSP hashing.
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('./build-catalog.cjs');
const MODULES = Object.freeze({
  auth:{name:'auth.js',start:'(function(root,factory){const lib=factory();',end:'\n;\n(function (root, factory) {'},
  commerce:{name:'commerce-client.js',start:'(function exposeAnoXCommerce(root, factory) {',end:'/* ANOX_COMMERCE_CLIENT_END */'}
});
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
  return {catalog:fs.readFileSync(path.join(root,'catalog-live.js'),'utf8'),auth:fs.readFileSync(path.join(root,'auth.js'),'utf8'),commerce:fs.readFileSync(path.join(root,'commerce-client.js'),'utf8')};
}
function build(html,sources) {
  for(const [key,spec] of Object.entries(MODULES))html=replaceModule(html,sources[key],spec);
  return catalog.build(html,sources.catalog);
}
function check(html,sources) {
  const issues=catalog.check(html,sources.catalog);
  for(const [key,spec] of Object.entries(MODULES)){
    const {start,end}=bounds(html,spec);
    if(html.slice(start,end).trim()!==sources[key].trim())issues.push(spec.name+' differs from its canonical source');
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
    else console.log('Catalog, auth and commerce sources and inline CSP verified');
  }else{
    const result=build(html,sources);
    if(result!==html)fs.writeFileSync(file,result);
    console.log('Canonical clients and inline CSP generated');
  }
}
