const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const core = require('@dev-mainsequence/devtools');
const root = path.resolve(__dirname, '..');

test('Codex imports only the public devtools API and has no maintained shared implementation', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/shared')), false);
  function walk(directory) {
    for (const name of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, name.name);
      if (name.isDirectory()) walk(file);
      else if (file.endsWith('.ts')) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, /@dev-mainsequence\/devtools\//, file);
        assert.doesNotMatch(source, /from\s+['"][^'"]*(?:\/shared\/|mainsequence-devtools|node_modules|\.\.\/\.\.\/\.\.)/, file);
      }
    }
  }
  walk(path.join(root, 'src'));
  for (const name of ['createDevTools', 'createNodeHost', 'parseArguments', 'tokenizeCommand', 'ToolingError']) assert.equal(typeof core[name], 'function', name);
  assert.equal(typeof core.HELP, 'string');
  assert.match(pkg.dependencies['@dev-mainsequence/devtools'], /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(pkg.dependencies), ['@dev-mainsequence/devtools']);
});

test('built plugin bundles the pinned package, records its integrity and mirrors the artifact to the package root', () => {
  const info = require('../codex/build-info.json');
  const bundled = require('../codex/dist/vendor/devtools/package.json');
  const lock = require('../package-lock.json').packages['node_modules/@dev-mainsequence/devtools'];
  assert.equal(info.devtools.version, pkg.dependencies['@dev-mainsequence/devtools']);
  assert.equal(info.devtools.integrity, lock.integrity);
  assert.match(lock.resolved, /^https:\/\/registry\.npmjs\.org\/@dev-mainsequence\/devtools\/-\/devtools-\d+\.\d+\.\d+\.tgz$/);
  assert.equal(bundled.version, info.devtools.version);
  assert.equal(bundled.name, '@dev-mainsequence/devtools');
  assert.equal(fs.existsSync(path.join(root, 'codex/dist/vendor/devtools/hosts')), false, 'devtools ships no host adapters');
  assert.equal(fs.existsSync(path.join(root, 'codex/node_modules')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'codex/.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'mainsequence');
  assert.equal(manifest.version, pkg.version);
  for (const file of ['.codex-plugin/plugin.json', 'hooks/hooks.json', 'skills/ms/SKILL.md', 'skills/mainsequence-mcp/SKILL.md', 'build-info.json', 'dist/runner.js', 'dist/hosts/codex.js']) {
    assert.equal(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(root, 'codex', file))), true, file);
  }
  assert.equal(fs.existsSync(path.join(root, 'plugin.json')), false);
});

test('shared failures keep the public contract through the vendored package', async () => {
  const vendored = require('../codex/dist/vendor/devtools/index.js');
  const tooling = vendored.createDevTools({ host: vendored.createNodeHost(), env: {}, store: null });
  const result = await tooling.dispatch({ action: 'unsupported-operation', root: root });
  assert.equal(result.schemaVersion, 1); assert.equal(result.status, 'failure');
  assert.equal(vendored.tokenizeCommand('status --path "a b"').length, 3);
});
