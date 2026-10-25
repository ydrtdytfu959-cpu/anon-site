#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function prepare(template,{expectedSourceSha256,source=fs.readFileSync(path.join(__dirname,'index.js'),'utf8')}={}){
 const copy=structuredClone(template),resource=copy?.Resources?.PaymentWebhookFunction;
 if(!/^[a-f0-9]{64}$/.test(expectedSourceSha256||'')||resource?.Type!=='AWS::Lambda::Function'||resource.Properties?.Handler!=='index.handler'||typeof resource.Properties?.Code?.ZipFile!=='string'||hash(resource.Properties.Code.ZipFile)!==expectedSourceSha256)throw Error('Existing webhook template/source must match the reviewed capture');
 resource.Properties.Code.ZipFile=source;return copy;
}
module.exports={prepare};
if(require.main===module){try{const [file,expectedSourceSha256]=process.argv.slice(2);if(!file)throw Error('Usage: node backend/legacy-webhook/prepare-template.cjs current-template.json EXPECTED_SOURCE_SHA256');process.stdout.write(JSON.stringify(prepare(JSON.parse(fs.readFileSync(file,'utf8')),{expectedSourceSha256}),null,2)+'\n');}catch(error){console.error(error.message);process.exitCode=1;}}
