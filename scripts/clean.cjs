const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Compiled sources, the built artifact and its mirror at the package root (see build-codex.cjs).
for (const name of ['build', 'codex', 'dist', '.mcp.json', '.codex-plugin', 'hooks', 'skills', 'assets', 'build-info.json', 'plugin.json']) {
  fs.rmSync(path.join(root, name), { recursive: true, force: true });
}
