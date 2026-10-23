#!/usr/bin/env node
'use strict';
// Export committed source bytes only. Ignored/untracked files are never read;
// common private-file names and non-regular Git entries fail closed. Content
// still receives the normal secret review before its commit is published.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:16*1024*1024});
function exportReview(destination){
  if(!path.isAbsolute(destination))throw Error('Output directory must be an absolute path');
  if(git('status','--porcelain').toString().trim())throw Error('Commit and verify all changes before exporting a final review');
  const commit=git('rev-parse','HEAD').toString().trim(),branch=git('branch','--show-current').toString().trim();
  const entries=git('ls-tree','-r','-z',commit).toString().split('\0').filter(Boolean).map(entry=>{
    const match=/^(\d{6}) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if(!match)throw Error('Invalid committed source inventory');
    return {mode:match[1],type:match[2],file:match[4]};
  });
  const files=entries.map(entry=>entry.file);
  const workflow='.github/workflows/catalog.yml';
  // Git ignore rules select local build outputs, but are not runtime sources.
  const chosen=files.filter(file=>!file.endsWith('/.gitignore')&&(file===workflow||/^(?:backend\/|scripts\/|tests\/|docs\/|README\.md$|LICENSE-icons\.txt$|icons\.(?:js|css)$|package(?:-lock)?\.json$|(?:auth|commerce-client|catalog-live)\.js$|favicon\.svg$)/.test(file)));
  if(!files.includes('index.html')||!chosen.includes('backend/index.js'))throw Error('Required release sources missing');
  const selected=new Set(['index.html',...chosen]);
  for(const {mode,type,file} of entries.filter(entry=>selected.has(entry.file))){
    if(type!=='blob'||!['100644','100755'].includes(mode))throw Error('Release inventory must contain only regular source files');
    const parts=file.split('/');
    if(/[\\:\u0000-\u001f\u007f-\u009f]/u.test(file)||parts.some(part=>!part||(part.startsWith('.')&&file!==workflow)||part==='node_modules')||/(?:^|\/)(?:credentials(?:\.[^/]*)?|id_(?:rsa|ecdsa|ed25519)(?:\.pub)?)$|\.(?:pem|key|p12|pfx)$/i.test(file))throw Error('Private or unsafe path in release inventory');
  }
  if(fs.existsSync(destination))throw Error('Output directory already exists; use a new versioned directory');
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  // mkdir without recursive atomically reserves the destination. Another export
  // creating it after the check must never have its files overwritten.
  fs.mkdirSync(destination);
  const html=git('show',commit+':index.html');
  const sourceSha256={'index.html':createHash('sha256').update(html).digest('hex')};
  fs.writeFileSync(path.join(destination,'index.html'),html);
  const stage=fs.mkdtempSync(path.join(destination,'.archive-'));
  try{
    for(const file of chosen){const target=path.join(stage,file),bytes=git('show',`${commit}:${file}`);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);sourceSha256[file]=createHash('sha256').update(bytes).digest('hex');}
    // Fixed metadata makes the same committed archive reproducible. zipfile
    // writes only the explicit tracked-file manifest passed through stdin.
    const program=`import json,sys,zipfile,pathlib\na=json.load(sys.stdin)\nwith zipfile.ZipFile(a['zip'],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for name in sorted(a['files']):\n  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED; info.external_attr=0o100644<<16\n  z.writestr(info,(pathlib.Path(a['stage'])/name).read_bytes())\n`;
    execFileSync('python3',['-c',program],{input:JSON.stringify({stage,files:chosen,zip:path.join(destination,'backend-infrastructure.zip')})});
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
  const hashes={};for(const file of ['index.html','backend-infrastructure.zip'])hashes[file]=createHash('sha256').update(fs.readFileSync(path.join(destination,file))).digest('hex');
  const manifest={branch,commit,sourceTree:git('rev-parse',commit+'^{tree}').toString().trim(),repositoryPath:'index.html',htmlBytes:html.length,files:chosen,sha256:hashes,sourceSha256,reproduce:{node:process.version,python:execFileSync('python3',['--version'],{encoding:'utf8'}).trim(),instructions:'Extract backend-infrastructure.zip and copy the separate index.html into the extracted root. All commands below are local; no deployment is authorized.',commands:['npm ci --ignore-scripts','npm run build','npm run check','npm test'],browser:'Install Chromium and Firefox for the pinned Playwright version; run ENGINES=chromium,firefox npm run test:browser. See docs/reviews/engineering-overhaul-2026-10-17.md for current evidence and release boundaries.',evidence:'docs/reviews/engineering-overhaul-2026-10-17.md'}};
  fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  fs.writeFileSync(path.join(destination,'SHA256SUMS.txt'),Object.entries(hashes).map(([file,hash])=>hash+'  '+file).join('\n')+'\n');
  console.log(JSON.stringify({destination,branch,commit,htmlBytes:html.length,sha256:hashes},null,2));
}
if(require.main===module){try{if(process.argv.length!==3)throw Error('Usage: node scripts/export-review.cjs /absolute/new/output-directory');exportReview(process.argv[2]);}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={exportReview};
