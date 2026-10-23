// Identity for this disposable plugin only; no host configuration or account data.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const marker = '/* MAINSEQUENCE_PANEL_BUILD */ null';

function filesUnder(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap(entry => {
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (name === 'build-info.json' || entry.name === '.DS_Store') return [];
      if (entry.isSymbolicLink()) throw new Error('Probe artifacts must not contain symbolic links.');
      return entry.isDirectory() ? filesUnder(root, name) : [name];
    });
}

export function describeBuild(root) {
  const files = filesUnder(root).map(path => ({ path, sha256: digest(readFileSync(join(root, path))) }));
  const manifest = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8'));
  if (manifest.name !== 'mainsequence-host-probe' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version)) {
    throw new Error('Invalid probe identity.');
  }
  const vendor = join(root, 'vendor/devtools/package.json');
  const dependency = JSON.parse(readFileSync(existsSync(vendor) ? vendor : join(root, '../../../node_modules/@dev-mainsequence/devtools/package.json'), 'utf8'));
  const buildId = digest(JSON.stringify({ pluginVersion: manifest.version, devtoolsVersion: dependency.version, files }));
  return {
    schemaVersion: 1,
    pluginVersion: manifest.version,
    devtoolsVersion: dependency.version,
    buildId,
    panelTemplateSha256: files.find(file => file.path === 'panel.html').sha256,
    resourceUri: 'ui://mainsequence-host-probe/panel-' + manifest.version + '-' + buildId.slice(0, 16) + '.html'
  };
}

export function writeBuildManifest(root) {
  const build = describeBuild(root);
  writeFileSync(join(root, 'build-info.json'), JSON.stringify(build, null, 2) + '\n');
  return build;
}

export function captureBuild(root) {
  const build = describeBuild(root);
  const manifestPath = join(root, 'build-info.json');
  if (existsSync(manifestPath) && JSON.stringify(JSON.parse(readFileSync(manifestPath, 'utf8'))) !== JSON.stringify(build)) {
    throw new Error('Probe artifact differs from its recorded build. Rebuild with a new version before installing.');
  }
  const template = readFileSync(join(root, 'panel.html'), 'utf8');
  if (template.split(marker).length !== 2 || digest(template) !== build.panelTemplateSha256) {
    throw new Error('Probe panel changed during startup or has an invalid build marker.');
  }
  const json = JSON.stringify(build).replace(/[<>&]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  // Keep the exact resource in memory. A package update may delete the old cache.
  const html = template.replace(marker, () => json);
  return { build: Object.freeze(build), html, resourceSha256: digest(html), packaged: existsSync(manifestPath) };
}

export function assertImmutableVersion(previous, next) {
  if (previous?.pluginVersion === next.pluginVersion && previous.buildId !== next.buildId) {
    throw new Error('The probe version is already installed with different contents. Increment the fixture version; do not overwrite an installed build.');
  }
}
