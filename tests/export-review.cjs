'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const sourceRoot=path.resolve(__dirname,'..');
const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim();

function fixture(t){
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'anox export review '));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const root=path.join(temporary,'source $(literal)'),env={...process.env,GIT_CONFIG_GLOBAL:os.devNull,GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Export fixture',GIT_AUTHOR_EMAIL:'export@example.invalid',GIT_COMMITTER_NAME:'Export fixture',GIT_COMMITTER_EMAIL:'export@example.invalid'};
  fs.mkdirSync(root);
  const git=(...args)=>execFileSync(realGit,args,{cwd:root,env,encoding:'utf8'}).trim();
  const write=(name,body)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);};
  write('scripts/export-review.cjs',fs.readFileSync(path.join(sourceRoot,'scripts/export-review.cjs')));
  write('index.html','<!doctype html>\r\n<html lang="en">Éxact bytes.</html>\r\n');
  write('backend/index.js','module.exports = "first backend";\n');
  write('auth.js','// canonical authentication\n');
  write('catalog-live.js','// canonical catalog\n');
  write('commerce-client.js','// canonical commerce\n');
  write('favicon.svg','<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  write('package.json','{"name":"fixture","private":true}\n');
  write('package-lock.json','{"name":"fixture","lockfileVersion":3}\n');
  write('tests/fixtures/non-ascii é.json','{"example":"fixture"}\n');
  write('docs/commerce/review.md','# Review\n');
  write('docs/remediation/evidence.json','{"scope":"fixture"}\n');
  write('docs/phase1/validation.md','# Historical validation\n');
  write('README.md','# Source build instructions\n');
  write('.github/workflows/catalog.yml','name: fixture\n');
  write('unrelated.txt','must not be archived\n');
  write('.gitignore','.private-local\n');
  git('init','-q','-b','feat/export-fixture');
  const commit=()=>{git('add','--all');git('-c','core.hooksPath='+os.devNull,'commit','-qm','fixture');return git('rev-parse','HEAD');};
  commit();
  const run=(destination,extraEnv={},nodeArgs=[])=>spawnSync(process.execPath,[...nodeArgs,path.join(root,'scripts/export-review.cjs'),destination],{cwd:root,env:{...env,...extraEnv},encoding:'utf8'});
  return {temporary,root,env,git,write,commit,run};
}
function zipContents(directory){
  const program="import base64,json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n print(json.dumps([{'name':i.filename,'data':base64.b64encode(z.read(i)).decode(),'timestamp':i.date_time,'mode':i.external_attr>>16} for i in z.infolist()]))";
  return JSON.parse(execFileSync('python3',['-c',program,path.join(directory,'backend-infrastructure.zip')],{encoding:'utf8'}));
}
function successful(result){assert.equal(result.status,0,result.stderr||result.stdout);}

test('review export preserves committed bytes, excludes local/unrelated files and produces reproducible archives',t=>{
  const f=fixture(t),first=path.join(f.temporary,'release one'),second=path.join(f.temporary,'release two');
  f.write('.private-local','ignored private data');
  successful(f.run(first));successful(f.run(second));
  for(const name of ['index.html','backend-infrastructure.zip','manifest.json','SHA256SUMS.txt'])assert.deepEqual(fs.readFileSync(path.join(first,name)),fs.readFileSync(path.join(second,name)),name+' must be reproducible');
  assert.deepEqual(fs.readFileSync(path.join(first,'index.html')),fs.readFileSync(path.join(f.root,'index.html')));
  const manifest=JSON.parse(fs.readFileSync(path.join(first,'manifest.json'))),entries=zipContents(first);
  assert.equal(manifest.commit,f.git('rev-parse','HEAD'));
  assert.equal(manifest.sourceTree,f.git('rev-parse','HEAD^{tree}'));
  assert.equal(manifest.reproduce.node,process.version);
  assert.equal(manifest.branch,'feat/export-fixture');
  assert.deepEqual(entries.map(item=>item.name),['.github/workflows/catalog.yml','README.md','auth.js','backend/index.js','catalog-live.js','commerce-client.js','docs/commerce/review.md','docs/phase1/validation.md','docs/remediation/evidence.json','favicon.svg','package-lock.json','package.json','scripts/export-review.cjs','tests/fixtures/non-ascii é.json']);
  assert.deepEqual([...manifest.files].sort(),entries.map(item=>item.name));
  for(const entry of entries){assert.deepEqual(Buffer.from(entry.data,'base64'),fs.readFileSync(path.join(f.root,entry.name)));assert.deepEqual(entry.timestamp,[1980,1,1,0,0,0]);assert.equal(entry.mode,0o100644);}
  for(const name of ['index.html','backend-infrastructure.zip'])assert.equal(manifest.sha256[name],createHash('sha256').update(fs.readFileSync(path.join(first,name))).digest('hex'));
  for(const name of ['index.html',...manifest.files])assert.equal(manifest.sourceSha256[name],createHash('sha256').update(fs.readFileSync(path.join(f.root,name))).digest('hex'));
  assert.equal(manifest.htmlBytes,fs.statSync(path.join(first,'index.html')).size);
  assert.equal(fs.readdirSync(first).length,4,'temporary staging files must be removed');
});

test('a concurrent HEAD change cannot mix the captured HTML, source files and manifest revision',t=>{
  const f=fixture(t),before=f.git('rev-parse','HEAD'),oldHtml=fs.readFileSync(path.join(f.root,'index.html'));
  f.write('index.html','<html>new revision</html>');f.write('backend/index.js','module.exports = "new backend";');
  f.write('backend/new-file.js','module.exports = "new file";');const after=f.commit();
  f.git('reset','--hard',before);
  const bin=path.join(f.temporary,'tools');fs.mkdirSync(bin);
  const wrapper=`#!${process.execPath}\nconst {execFileSync}=require('node:child_process');const fs=require('node:fs');const args=process.argv.slice(2);if(args[0]==='branch'&&!fs.existsSync(process.env.EXPORT_SWITCH_MARKER)){execFileSync(process.env.EXPORT_REAL_GIT,['update-ref','HEAD',process.env.EXPORT_NEW_COMMIT],{stdio:'ignore'});fs.writeFileSync(process.env.EXPORT_SWITCH_MARKER,'switched');}process.stdout.write(execFileSync(process.env.EXPORT_REAL_GIT,args));\n`;
  fs.writeFileSync(path.join(bin,'git'),wrapper,{mode:0o755});
  const destination=path.join(f.temporary,'pinned release');
  successful(f.run(destination,{PATH:bin+path.delimiter+process.env.PATH,EXPORT_REAL_GIT:realGit,EXPORT_NEW_COMMIT:after,EXPORT_SWITCH_MARKER:path.join(f.temporary,'switched')}));
  assert.equal(f.git('rev-parse','HEAD'),after,'fixture must actually move HEAD');
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'))).commit,before);
  assert.deepEqual(fs.readFileSync(path.join(destination,'index.html')),oldHtml);
  const entries=zipContents(destination);
  assert.equal(Buffer.from(entries.find(item=>item.name==='backend/index.js').data,'base64').toString(),'module.exports = "first backend";\n');
  assert.equal(entries.some(item=>item.name==='backend/new-file.js'),false,'inventory must come from captured commit');
});

test('dirty tracked or untracked work and relative/existing destinations are refused before publishing bytes',t=>{
  const f=fixture(t),destination=path.join(f.temporary,'refused');
  f.write('backend/index.js','uncommitted');assert.notEqual(f.run(destination).status,0);assert.equal(fs.existsSync(destination),false);
  f.git('restore','backend/index.js');f.write('untracked.js','untracked');assert.notEqual(f.run(destination).status,0);assert.equal(fs.existsSync(destination),false);
  fs.unlinkSync(path.join(f.root,'untracked.js'));assert.notEqual(f.run('relative-output').status,0);assert.equal(fs.existsSync(path.join(f.root,'relative-output')),false);
  fs.mkdirSync(destination);fs.writeFileSync(path.join(destination,'index.html'),'keep this');
  assert.notEqual(f.run(destination).status,0);assert.equal(fs.readFileSync(path.join(destination,'index.html'),'utf8'),'keep this');
});

test('an output directory created concurrently is not overwritten',t=>{
  const f=fixture(t),destination=path.join(f.temporary,'concurrent release'),preload=path.join(f.temporary,'race.cjs');
  // Inject the competing filesystem operation after the existence check. The
  // real exporter must reserve its directory exclusively, regardless of timing.
  fs.writeFileSync(preload,`const fs=require('node:fs');const original=fs.existsSync;fs.existsSync=function(file){const found=original(file);if(file===process.env.EXPORT_RACE_DEST&&!found){fs.mkdirSync(file);fs.writeFileSync(require('node:path').join(file,'index.html'),'another export');}return found;};`);
  const result=f.run(destination,{EXPORT_RACE_DEST:destination},['--require',preload]);
  assert.notEqual(result.status,0,'concurrent directory ownership must be refused');
  assert.equal(fs.readFileSync(path.join(destination,'index.html'),'utf8'),'another export');
});

test('tracked private files or symlinks in the selected release inventory fail closed',async t=>{
  for(const filename of ['backend/.env.production','backend/credentials.json','scripts/private-key.pem','tests/.aws/config','docs/remediation/.env','docs/credentials.json','backend/link.js'])await t.test(filename,t=>{
    const f=fixture(t),destination=path.join(f.temporary,'private release');
    if(filename==='backend/link.js')fs.symlinkSync('../.private-local',path.join(f.root,filename));else f.write(filename,'private fixture content');
    f.commit();const result=f.run(destination);
    assert.notEqual(result.status,0,'unsafe selected entry must refuse the whole export');
    assert.equal(fs.existsSync(destination),false,'refusal must happen before producing HTML or a partial archive');
  });
});

test('archive plus separate HTML retains every source needed by the real canonical build checks',t=>{
  const f=fixture(t);
  for(const name of ['backend','scripts'])fs.cpSync(path.join(sourceRoot,name),path.join(f.root,name),{recursive:true});
  for(const name of ['index.html','catalog-live.js','auth.js','commerce-client.js','favicon.svg','package.json','package-lock.json'])fs.copyFileSync(path.join(sourceRoot,name),path.join(f.root,name));
  f.commit();const destination=path.join(f.temporary,'buildable release');successful(f.run(destination));
  const restored=path.join(f.temporary,'restored');fs.mkdirSync(restored);
  execFileSync('python3',['-c',"import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:z.extractall(sys.argv[2])",path.join(destination,'backend-infrastructure.zip'),restored]);
  fs.copyFileSync(path.join(destination,'index.html'),path.join(restored,'index.html'));
  for(const script of ['backend/build-template.cjs','backend/commerce/build-template.cjs','scripts/build-clients.cjs']){
    const result=spawnSync(process.execPath,[script,'--check'],{cwd:restored,encoding:'utf8'});successful(result);
  }
});
