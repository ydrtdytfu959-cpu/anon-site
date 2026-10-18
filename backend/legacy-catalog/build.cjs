'use strict';

// Local artifact preparation only. No AWS CLI, network or deployment commands.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const provenance = require('./provenance.json');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function build(output = path.join(__dirname, 'artifacts')) {
  const baseline = fs.readFileSync(path.join(__dirname, provenance.deployedSourceFile));
  if (baseline.length !== provenance.deployedSourceBytes || sha256(baseline) !== provenance.deployedSourceSha256) {
    throw Error('Verified deployed source does not match provenance');
  }
  fs.mkdirSync(output, {recursive: true});
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'anox-legacy-catalog-'));
  const packages = {};
  try {
    for (const [name, files] of Object.entries({
      candidate: {'index.js': fs.readFileSync(path.join(__dirname, 'index.js')),
        'cj-handler.js': fs.readFileSync(path.join(__dirname, 'cj-handler.js'))},
      rollback: {'index.js': baseline}
    })) {
      const directory = path.join(staging, name);
      fs.mkdirSync(directory);
      for (const [filename, contents] of Object.entries(files)) {
        const file = path.join(directory, filename);
        fs.writeFileSync(file, contents, {mode: 0o644});
        fs.chmodSync(file, 0o644);
        fs.utimesSync(file, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
      }
      const filename = name + '.zip', archive = path.join(staging, filename);
      // Store bytes without compression; sorted entries, fixed mtime/permissions,
      // UTC, and no extra metadata make repeated local builds byte-identical.
      execFileSync('zip', ['-X', '-q', '-0', archive, ...Object.keys(files).sort()],
        {cwd: directory, env: {...process.env, TZ: 'UTC'}});
      const bytes = fs.readFileSync(archive);
      fs.writeFileSync(path.join(output, filename), bytes);
      packages[name] = {file: filename, bytes: bytes.length, sha256: sha256(bytes),
        sha256Base64: crypto.createHash('sha256').update(bytes).digest('base64'),
        sources: Object.fromEntries(Object.entries(files).map(([key, value]) => [key, sha256(value)]))};
    }
    const manifest = {functionName: provenance.functionName, region: provenance.region,
      runtime: provenance.runtime, handler: provenance.entrypoint,
      baselinePackageSha256Base64: provenance.deployedPackageSha256Base64,
      preparedOnly: true, packages};
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
  } finally {
    fs.rmSync(staging, {recursive: true, force: true});
  }
}

if (require.main === module) {
  const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'artifacts');
  const manifest = build(output);
  process.stdout.write(JSON.stringify({output, candidate: manifest.packages.candidate.sha256,
    rollback: manifest.packages.rollback.sha256}) + '\n');
}
module.exports = {build};
