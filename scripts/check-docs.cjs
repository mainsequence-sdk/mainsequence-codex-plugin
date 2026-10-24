// Documentation stays current: links resolve, named npm scripts exist, and the
// user-facing documents carry no version numbers (versions live in package.json, the
// marketplace and GitHub releases).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const documents = ['README.md', 'docs/agents-tools-panel.md', 'docs/conversational-mcp.md', 'docs/local-development-backend.md', 'docs/adr/0002-conversational-project-mcp-client.md'];
const versionFree = ['README.md', 'docs/agents-tools-panel.md', 'docs/conversational-mcp.md'];
for (const filename of documents) {
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(root, path.dirname(filename), target)), `${filename}: missing link ${target}`);
  }
  for (const [, script] of source.matchAll(/npm run ([a-z:-]+)/g)) assert.ok(pkg.scripts[script], `${filename}: unknown npm script ${script}`);
}
for (const filename of versionFree) {
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  const versions = [...source.matchAll(/\b\d+\.\d+\.\d+\b/g)].map(match => match[0]);
  assert.deepEqual(versions, [], `${filename} must not name versions; found ${versions.join(', ')}`);
}
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
assert.ok(readme.includes('codex plugin marketplace add mainsequence-sdk/mainsequence-codex-plugin'), 'README must give the marketplace install command');
for (const link of ['docs/agents-tools-panel.md', 'docs/conversational-mcp.md']) assert.ok(readme.includes(`(${link})`), `README must link ${link}`);
for (const name of ['docs/agents-tools-panel.md', 'docs/conversational-mcp.md', 'docs/adr']) assert.ok(pkg.files.includes(name), `package.json files must ship ${name}`);
console.log('Documentation links, npm scripts and version-free user documents verified.');
