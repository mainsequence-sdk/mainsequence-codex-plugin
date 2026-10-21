// Standalone archive of the built artifact, for installing a reviewed build by hand.
// The npm archive from `npm pack` is the release artifact; both come from the same build.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'codex', '.codex-plugin', 'plugin.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Build the matching Codex artifact before packing.');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const archive = path.join(root, 'artifacts', `mainsequence-codex-plugin-${pkg.version}.tgz`);
fs.rmSync(archive, { force: true });
const result = spawnSync('tar', ['-czf', archive, '-C', root, '--transform', `s,^codex,${manifest.name},`, 'codex'], { encoding: 'utf8' });
if (result.status !== 0) {
  // BSD tar (macOS) spells the rename option differently.
  const bsd = spawnSync('tar', ['-czf', archive, '-C', root, '-s', `,^codex,${manifest.name},`, 'codex'], { encoding: 'utf8' });
  if (bsd.status !== 0) throw new Error('tar could not package the plugin: ' + (bsd.stderr || result.stderr));
}
console.log(archive);
