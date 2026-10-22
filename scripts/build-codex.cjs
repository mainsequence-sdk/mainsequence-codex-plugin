// Build the installable Codex plugin from the compiled sources and the exact pinned
// devtools package. The artifact in codex/ runs without node_modules or an npm download
// at execution time; its plugin files are mirrored to the package root because Codex's
// npm plugin source reads the manifest, hooks, skills and assets from there.
const fs = require('node:fs');
const path = require('node:path');
const { isBuiltin } = require('node:module');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const coreEntry = require.resolve('@dev-mainsequence/devtools');
const coreRoot = path.dirname(path.dirname(coreEntry));
const core = JSON.parse(fs.readFileSync(path.join(coreRoot, 'package.json'), 'utf8'));
if (core.version !== pkg.dependencies[core.name]) throw new Error('Installed devtools must match the exact dependency pin.');
const lockPath = path.join(root, 'package-lock.json');
const locked = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')).packages['node_modules/@dev-mainsequence/devtools'] : undefined;
const target = path.join(root, 'codex');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(root, 'manifests/codex'), target, { recursive: true });
// One source of brand assets serves both plugin and skill UI metadata.
fs.cpSync(path.join(target, 'assets'), path.join(target, 'skills', 'ms', 'assets'), { recursive: true });
const manifestPath = path.join(target, '.codex-plugin/plugin.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = pkg.version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const copied = new Set();
function bundle(source, destination, boundary) {
  if (copied.has(destination)) return;
  if (!source.startsWith(boundary + path.sep)) throw new Error('Dependency leaves its package.');
  copied.add(destination);
  let text = fs.readFileSync(source, 'utf8').replace(/^\/\/# sourceMappingURL=.*$/gm, '');
  text = text.replace(/require\(["']([^"']+)["']\)/g, (expression, name) => {
    let next, dest, nextBoundary = boundary;
    if (name === '@dev-mainsequence/devtools') {
      next = coreEntry; dest = 'vendor/devtools/index.js'; nextBoundary = path.dirname(coreEntry);
    } else if (name.startsWith('.')) {
      next = require.resolve(path.resolve(path.dirname(source), name));
      dest = path.posix.normalize(path.posix.join(path.posix.dirname(destination), name));
      if (!path.extname(dest)) dest += '.js';
    } else {
      if (!isBuiltin(name)) throw new Error(`Unexpected runtime dependency: ${name}`);
      return expression;
    }
    if (dest.startsWith('../')) throw new Error('Bundled dependency leaves plugin.');
    bundle(next, dest, nextBoundary);
    let relative = path.posix.relative(path.posix.dirname(destination), dest);
    if (!relative.startsWith('.')) relative = './' + relative;
    return `require(${JSON.stringify(relative)})`;
  });
  const output = path.join(target, 'dist', destination);
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, text);
}
bundle(path.join(root, 'build/runner.js'), 'runner.js', path.join(root, 'build'));
bundle(path.join(root, 'build/panel-server.js'), 'panel-server.js', path.join(root, 'build'));
fs.cpSync(path.join(root, 'src/hosts/panel'), path.join(target, 'dist/hosts/panel'), { recursive: true });
fs.chmodSync(path.join(target, 'dist/runner.js'), 0o755);
fs.writeFileSync(path.join(target, 'dist/package.json'), '{"type":"commonjs"}\n');
for (const name of ['LICENSE', 'NOTICE']) {
  fs.copyFileSync(path.join(root, name), path.join(target, name));
  fs.copyFileSync(path.join(coreRoot, name), path.join(target, 'dist/vendor/devtools', name));
}
fs.writeFileSync(path.join(target, 'dist/vendor/devtools/package.json'), JSON.stringify({ name: core.name, version: core.version, main: './index.js' }, null, 2) + '\n');
// Ship product documentation only; historical experiments stay in the repository.
for (const file of pkg.files.filter(file => file.startsWith('docs/'))) {
  fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
  fs.cpSync(path.join(root, file), path.join(target, file), { recursive: true });
}
fs.copyFileSync(path.join(root, 'README.md'), path.join(target, 'README.md'));
fs.writeFileSync(path.join(target, 'build-info.json'), JSON.stringify({ version: pkg.version, node: pkg.engines.node,
  host: 'codex', devtools: { name: core.name, version: core.version, ...(locked?.integrity ? { integrity: locked.integrity } : {}) } }, null, 2) + '\n');
// Codex 0.159.2 skips hooks for Agent Plugins root manifests. Ship its supported
// compatibility entry point; a root plugin.json would take precedence and disable it.
fs.rmSync(path.join(root, 'plugin.json'), { force: true });
for (const name of ['dist', '.mcp.json', '.codex-plugin', 'hooks', 'skills', 'assets', 'build-info.json']) {
  fs.rmSync(path.join(root, name), { recursive: true, force: true });
  fs.cpSync(path.join(target, name), path.join(root, name), { recursive: true });
}
// A local marketplace for installing this build into a Codex host (scripts/verify-codex-*.cjs).
const marketplace = path.join(root, 'artifacts', 'local-marketplace');
fs.rmSync(marketplace, { recursive: true, force: true });
fs.mkdirSync(path.join(marketplace, '.agents', 'plugins'), { recursive: true });
fs.cpSync(target, path.join(marketplace, 'plugins', manifest.name), { recursive: true });
fs.writeFileSync(path.join(marketplace, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({ name: 'mainsequence-local', interface: { displayName: 'MainSequence local' }, plugins: [{ name: manifest.name, source: { source: 'local', path: `./plugins/${manifest.name}` }, policy: { installation: 'AVAILABLE', authentication: 'ON_USE' }, category: 'Productivity' }] }, null, 2) + '\n');
console.log(`Built Codex plugin ${manifest.name} ${pkg.version} with ${core.name}@${core.version} from its package API.`);
