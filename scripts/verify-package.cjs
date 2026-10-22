// Check the npm archive as Codex installs it: unpacked without lifecycle scripts, with the
// manifest, hooks, skills and bundled runner at the package root and no node_modules.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const exists = file => fs.stat(file).then(() => true).catch(() => false);
async function main() {
  const pkg = require('../package.json');
  const archive = path.resolve(process.argv[2] || `artifacts/dev-mainsequence-codex-plugin-${pkg.version}.tgz`);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ms codex plugin '));
  try {
    const installed = path.join(temporary, 'installed plugin');
    await fs.mkdir(installed, { recursive: true });
    const unpack = spawnSync('tar', ['-xzf', archive, '-C', installed, '--strip-components=1'], { encoding: 'utf8' });
    if (unpack.status !== 0) throw new Error('Could not unpack the npm artifact.');
    const manifest = JSON.parse(await fs.readFile(path.join(installed, '.codex-plugin/plugin.json'), 'utf8'));
    const metadata = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8'));
    const info = JSON.parse(await fs.readFile(path.join(installed, 'build-info.json'), 'utf8'));
    if (manifest.name !== 'mainsequence' || manifest.version !== metadata.version || manifest.hooks !== './hooks/hooks.json' || manifest.skills !== './skills/' || manifest.mcpServers !== './.mcp.json') throw new Error('The npm artifact must contain the versioned Codex compatibility manifest.');
    if (info.devtools.version !== metadata.dependencies['@dev-mainsequence/devtools']) throw new Error('build-info must record the pinned devtools version.');
    for (const required of ['.mcp.json', 'dist/panel-server.js', 'dist/hosts/discovery.js', 'dist/hosts/panel/panel.html', 'hooks/hooks.json', 'skills/ms/SKILL.md', 'skills/ms/agents/openai.yaml', 'skills/ms/assets/mainsequence-icon.png', 'skills/mainsequence-mcp/SKILL.md', 'assets/mainsequence-icon.svg', 'dist/runner.js', 'dist/hosts/codex.js', 'dist/hosts/codexPresentation.js', 'dist/vendor/devtools/index.js', 'dist/vendor/devtools/shared/mcp.js', 'dist/vendor/devtools/package.json', 'dist/vendor/devtools/LICENSE', 'docs/conversational-mcp.md', 'README.md', 'LICENSE', 'NOTICE']) {
      if (!await exists(path.join(installed, required))) throw new Error('The npm artifact must contain ' + required);
    }
    for (const removed of ['experiments', 'docs/codex-host-probe-results.md', 'docs/codex-desktop-parity-plan.md', 'plugin.json', 'node_modules', 'build', 'codex', 'src', 'dist/vendor/devtools/hosts']) {
      if (await exists(path.join(installed, removed))) throw new Error('The npm artifact must not contain ' + removed);
    }
    const vendored = JSON.parse(await fs.readFile(path.join(installed, 'dist/vendor/devtools/package.json'), 'utf8'));
    if (vendored.version !== info.devtools.version) throw new Error('The vendored devtools version must match build-info.');
    const hooks = JSON.parse(await fs.readFile(path.join(installed, 'hooks/hooks.json'), 'utf8'));
    if (hooks.hooks.UserPromptSubmit[0].hooks[0].command !== 'node "${PLUGIN_ROOT}/dist/runner.js" --codex-hook') throw new Error('The hook must run the bundled runner.');
    const runner = path.join(installed, 'dist/runner.js');
    const env = { PATH: process.env.PATH, HOME: temporary };
    const help = spawnSync(process.execPath, [runner, '--help'], { cwd: temporary, env, encoding: 'utf8' });
    if (help.status !== 0 || !/MainSequence developer tooling/.test(help.stdout)) throw new Error('The bundled runner must print the terminal help: ' + help.stderr);
    const ordinary = spawnSync(process.execPath, [runner, '--codex-hook'], { cwd: temporary, env, input: JSON.stringify({ prompt: 'ordinary prompt', cwd: temporary }), encoding: 'utf8' });
    if (ordinary.status !== 0 || ordinary.stdout !== '') throw new Error('Ordinary prompts must pass through the hook.');
    const mention = `[$mainsequence:ms?label=ms](${path.join(installed, 'skills/ms/SKILL.md')})`;
    const action = spawnSync(process.execPath, [runner, '--codex-hook'], { cwd: temporary, env, input: JSON.stringify({ prompt: mention + ' --help\n', cwd: temporary }), encoding: 'utf8' });
    const output = action.status === 0 ? JSON.parse(action.stdout) : undefined;
    if (output?.decision !== 'block' || !/Get started\n\nSign in\n\/ms login/.test(output.reason)) throw new Error('The installed skill mention must be handled by the bundled runner.');
    const foreign = spawnSync(process.execPath, [runner, '--codex-hook'], { cwd: temporary, env, input: JSON.stringify({ prompt: `[$other:ms](${path.join(temporary, 'skills/ms/SKILL.md')}) --help`, cwd: temporary }), encoding: 'utf8' });
    if (foreign.status !== 0 || foreign.stdout !== '') throw new Error('A mention of another plugin\'s ms skill must pass through.');
    const failure = spawnSync(process.execPath, [runner, 'sync', '--message', 'retired', '--json'], { cwd: temporary, env, encoding: 'utf8' });
    if (failure.status !== 1 || JSON.parse(failure.stdout).error.code !== 'INVALID_REQUEST') throw new Error('The terminal CLI must keep working through this package.');
    await require('./check-panel-package.cjs')(installed, env);
    console.log(`Codex plugin ${manifest.name} ${manifest.version} installs from the npm archive with devtools ${info.devtools.version} bundled; the MCP panel, hook and terminal CLI run without node_modules.`);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
