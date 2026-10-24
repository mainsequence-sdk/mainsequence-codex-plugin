const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const { canonicalRepositoryDir, readOrganizationProjectWorkspace } = require('@dev-mainsequence/devtools');
const { createWorkspace } = require('../build/hosts/workspace');
const { git } = require('./helpers.cjs');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const backend = 'https://workspace.fixture.test';
const project = { uid: uid(1), organization_environment_uid: uid(2), name: 'Fixture Project', description: '', code_repository_branch_uids: [uid(4)] };
const branch = { uid: uid(4), code_repository_uid: uid(3), code_repository_name: 'Pricing', code_repository_type: 'python', organization_environment_uid: uid(2), repository_branch: 'main', github_repository_binding_uid: uid(5), is_initialized: true };
const repository = { uid: uid(3), code_repository_name: 'Pricing', code_repository_type: 'python', primary_language: 'Python', framework: 'None', github_repository_binding_uid: uid(5), branches: [{ uid: uid(4), repository_branch: 'main' }] };
const binding = { uid: uid(5), code_repository_uid: uid(3), code_repository_name: 'Pricing', repo_name: 'pricing', github_full_name: 'fixture/pricing', git_ssh_url: 'git@github.com:fixture/pricing.git', git_repo_url: 'https://github.com/fixture/pricing.git' };

// Exercise the default workspace executor with the actual pinned session and
// dispatcher. Only backend responses and browser launch are fixtures.
test('project setup and links use the real account-bound dispatcher and retain pre/post account checks', { timeout: 15000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ms workspace account '));
  const home = await fs.realpath(temporary);
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const changedKeys = [...new Set([...Object.keys(process.env).filter(key => /^(MAINSEQUENCE_|GIT_)/.test(key)), 'HOME', 'USERPROFILE', 'APPDATA', 'MAINSEQUENCE_ENDPOINT', 'MAINSEQUENCE_ACCESS_TOKEN'])];
  const previous = Object.fromEntries(changedKeys.map(key => [key, process.env[key]]));
  for (const key of changedKeys) delete process.env[key];
  Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: home, MAINSEQUENCE_ENDPOINT: backend, MAINSEQUENCE_ACCESS_TOKEN: 'fixture-workspace-access' });
  t.after(() => { for (const key of changedKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });

  let account = 'fixture-user', onOpen;
  const calls = [], opened = [], spawn = cp.spawn;
  t.mock.method(cp, 'spawn', (program, args, options) => {
    if (['xdg-open', '/usr/bin/open', 'rundll32.exe'].includes(program)) {
      opened.push(args.at(-1)); onOpen?.();
      return spawn(process.execPath, ['-e', ''], options);
    }
    return spawn(program, args, options);
  });
  const fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fixture-workspace-access');
    const pathname = new URL(url).pathname;
    calls.push(pathname);
    const rows = {
      '/api/v1/users/me/': { username: account, organization: { name: 'Fixture Org' } },
      [`/api/v1/organization-projects/${uid(1)}/`]: project,
      [`/api/v1/organization-projects/${uid(1)}/code-repository-branches/`]: [branch],
      [`/api/v1/code-repositories/${uid(3)}/`]: repository,
      [`/api/v1/code-repository-branches/${uid(4)}/`]: branch,
      [`/api/v1/github-repository-bindings/${uid(5)}/`]: binding,
    };
    assert.ok(rows[pathname], `Unexpected backend request: ${pathname}`);
    return new Response(JSON.stringify(rows[pathname]), { headers: { 'Content-Type': 'application/json' } });
  };
  const context = { backend, account: 'fixture-user', conversationId: 'workspace-chat', projects: new Map([[uid(2), new Set([uid(1)])]]) };
  const workspace = createWorkspace({ scoped: async (_, args, fn) => fn(context, args.environmentUid) }, { fetch });
  const call = (name, args) => workspace.call(name, { contextId: 'fixture-context', environmentUid: uid(2), ...args }, () => assert.fail('Discovery dispatch was unexpected'), new AbortController().signal, 'workspace-chat');
  async function run(action, input) {
    let { operation } = await call('mainsequence_action', { action, input });
    const deadline = Date.now() + 7000;
    while (operation.status === 'running' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
      ({ operation } = await call('mainsequence_operations', { action: 'get', operationId: operation.id }));
    }
    assert.notEqual(operation.status, 'running', 'The operation must finish.');
    return operation;
  }

  // Reuse ordinary local checkouts so this test needs no Git network, SSH keys,
  // package installation or real credentials. Setup still verifies membership,
  // origins and branches and writes its actual workspace manifest/instructions.
  const baseDir = path.join(home, 'repositories');
  const container = path.join(baseDir, 'fixture-org', 'organization-projects', createHash('sha256').update(backend).digest('hex').slice(0, 16), `fixture-project-${uid(1)}`);
  const root = path.join(container, project.name);
  const source = canonicalRepositoryDir(baseDir, 'fixture-org', uid(3), 'Pricing');
  const checkout = path.join(container, 'repositories', `pricing-${uid(3)}`, `main-${uid(4)}`);
  for (const directory of [source, checkout]) {
    await fs.mkdir(directory, { recursive: true });
    git(directory, ['init', '-b', 'main']);
    git(directory, ['config', 'user.name', 'Fixture']); git(directory, ['config', 'user.email', 'fixture@example.test']);
    git(directory, ['remote', 'add', 'origin', binding.git_ssh_url]);
    await fs.writeFile(path.join(directory, 'pyproject.toml'), '[project]\nname="fixture"\nversion="1.0.0"\n');
    git(directory, ['add', '.']); git(directory, ['commit', '-m', 'Fixture']);
  }
  await fs.mkdir(root);
  await fs.writeFile(path.join(container, '.mainsequence-project.json'), JSON.stringify({ schemaVersion: 2, backend, projectUid: uid(1), environmentUid: uid(2), name: project.name, root }));

  const setup = await run('organization-project-setup', { projectUid: uid(1), baseDir });
  assert.equal(setup.status, 'success', JSON.stringify(setup.result));
  assert.equal(setup.result.data.root, root);
  assert.equal(setup.result.data.claudeUrl, undefined);
  assert.match(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), /Grant access to each checkout/);
  assert.equal((await readOrganizationProjectWorkspace(root)).repositories[0].path, checkout);
  assert.equal(git(checkout, ['branch', '--show-current']), 'main');

  const linkInput = { projectUid: uid(1), target: 'project', commandCenterUrl: 'https://command-center.fixture.test' };
  const link = await run('organization-project-link', linkInput);
  assert.equal(link.status, 'success', JSON.stringify(link.result));
  assert.equal(new URL(opened[0]).searchParams.get('msProjectUid'), uid(1));

  account = 'another-user';
  const projectReads = calls.filter(url => url.startsWith('/api/v1/organization-projects/')).length;
  const refused = await run('organization-project-setup', { projectUid: uid(1), baseDir });
  assert.equal(refused.status, 'failure'); assert.match(refused.progress, /account or session changed/i);
  assert.equal(calls.filter(url => url.startsWith('/api/v1/organization-projects/')).length, projectReads);

  account = 'fixture-user'; onOpen = () => { account = 'another-user'; };
  const changedAfterOpen = await run('organization-project-link', linkInput);
  assert.equal(changedAfterOpen.status, 'failure'); assert.match(changedAfterOpen.progress, /account or session changed/i);
  assert.doesNotMatch(JSON.stringify([setup, link, refused, changedAfterOpen]), /fixture-workspace-access/);
});
