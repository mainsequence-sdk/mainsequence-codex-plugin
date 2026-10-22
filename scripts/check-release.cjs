const assert = require('node:assert/strict');
const fs = require('node:fs');
const pkg = require('../package.json');
const manifest = require('../codex/.codex-plugin/plugin.json');
const build = require('../codex/build-info.json');
const lock = require('../package-lock.json');
assert.equal(pkg.private, undefined);
assert.equal(pkg.publishConfig.access, 'public');
assert.equal(pkg.name, '@dev-mainsequence/codex-plugin');
assert.equal(manifest.name, 'mainsequence', 'The plugin identity in the mainsequence marketplace');
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.hooks, './hooks/hooks.json');
assert.equal(manifest.skills, './skills/');
assert.equal(manifest.mcpServers, './.mcp.json');
assert.deepEqual(require('../codex/.mcp.json').mcpServers.mainsequence.args, ['./dist/panel-server.js']);
assert.equal(build.version, pkg.version);
assert.equal(build.host, 'codex');
assert.equal(build.devtools.name, '@dev-mainsequence/devtools');
assert.equal(build.devtools.version, pkg.dependencies['@dev-mainsequence/devtools']);
assert.match(build.devtools.version, /^\d+\.\d+\.\d+$/, 'devtools is pinned to an exact version');
const locked = lock.packages['node_modules/@dev-mainsequence/devtools'];
assert.equal(locked.version, build.devtools.version);
assert.equal(locked.resolved, `https://registry.npmjs.org/@dev-mainsequence/devtools/-/devtools-${locked.version}.tgz`, 'The lockfile pins the registry archive');
assert.equal(build.devtools.integrity, locked.integrity, 'build-info records the lockfile integrity');
assert.equal(Object.keys(pkg.dependencies).length, 1, 'devtools is the only runtime dependency, and it is vendored');
assert.equal(pkg.bin['ms-devtools'], './dist/runner.js');
// The npm archive is the Codex plugin: its manifest, hooks, skills, assets and bundled
// runner sit at the package root, mirrored from the codex/ artifact by the build.
for (const file of ['.codex-plugin/plugin.json', '.mcp.json', 'dist/panel-server.js', 'dist/hosts/discovery.js', 'dist/hosts/panel/panel.html', 'hooks/hooks.json', 'skills/ms/SKILL.md', 'skills/ms/agents/openai.yaml', 'skills/ms/assets/mainsequence-icon.png', 'skills/mainsequence-mcp/SKILL.md', 'assets/mainsequence-icon.svg', 'build-info.json', 'dist/runner.js', 'dist/hosts/codex.js', 'dist/vendor/devtools/index.js', 'dist/vendor/devtools/shared/mcp.js', 'dist/vendor/devtools/LICENSE']) {
  assert.equal(fs.existsSync(file), true, `${file} must be in the package root for npm pack`);
  assert.equal(fs.readFileSync(file).equals(fs.readFileSync(`codex/${file}`)), true, `${file} must match the built artifact`);
}
for (const name of ['.codex-plugin', '.mcp.json', 'hooks', 'skills', 'assets', 'build-info.json', 'dist', 'docs/agents-tools-panel.md', 'README.md', 'LICENSE', 'NOTICE']) assert.ok(pkg.files.includes(name), `package.json files must include ${name}`);
assert.equal(fs.existsSync('plugin.json'), false, 'A portable root manifest skips hooks in Codex 0.159.2');
assert.equal(fs.existsSync('codex/node_modules'), false);
for (const file of ['experiments', 'docs/codex-host-probe-results.md', 'docs/codex-desktop-parity-plan.md']) assert.equal(fs.existsSync(`codex/${file}`), false, `${file} is not part of the shipped plugin`);
assert.equal(fs.existsSync('codex/dist/vendor/devtools/hosts'), false, 'devtools ships no host adapters');
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, `v${pkg.version}`);
fs.mkdirSync('artifacts', { recursive: true });
console.log(`Release metadata agrees: ${pkg.name}@${pkg.version}, plugin ${manifest.name}, devtools ${build.devtools.version}.`);
