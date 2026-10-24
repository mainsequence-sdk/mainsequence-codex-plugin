// The Codex repository owns its public marketplace; shared devtools owns no catalog.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const marketplace = require(path.join(root, '.agents/plugins/marketplace.json'));
assert.equal(marketplace.name, 'mainsequence');
assert.equal(marketplace.interface.displayName, 'MainSequence');
assert.equal(marketplace.plugins.length, 1);
const plugin = marketplace.plugins[0];
assert.equal(plugin.name, 'mainsequence');
assert.equal(plugin.source.source, 'npm');
assert.equal(plugin.source.package, pkg.name);
assert.match(plugin.source.version, /^\d+\.\d+\.\d+$/);
const compare = (a, b) => a.split('.').map((n, i) => Number(n) - Number(b.split('.')[i])).find(n => n !== 0) ?? 0;
assert.ok(compare(plugin.source.version, pkg.version) <= 0, 'The marketplace cannot advertise a newer version than the source');
assert.deepEqual(plugin.policy, { installation: 'AVAILABLE', authentication: 'ON_USE' });
assert.equal(plugin.category, 'Productivity');
console.log(`Codex marketplace: ${plugin.name}@${marketplace.name} from ${plugin.source.package}@${plugin.source.version}.`);
