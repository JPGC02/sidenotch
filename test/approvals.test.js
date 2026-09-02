// Simula o Claude Code fazendo POST no hook e o usuário decidindo na barra
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ApprovalServer, installHook, uninstallHook, hookInstalled, HOOK_PATH, EVENT_PATH, EVENT_HOOKS } = require('../src/approvals');

const PORT = 47399, TOKEN = 'test-token';
const sample = (cmd) => ({
  session_id: 's1', cwd: 'C:\\dev\\medsystem-hub', permission_mode: 'default', hook_event_name: 'PermissionRequest',
  tool_name: 'Bash', tool_input: { command: cmd, description: 'x' },
  permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: cmd }], behavior: 'allow', destination: 'localSettings' }]
});
const post = (body, headers = {}) => fetch(`http://127.0.0.1:${PORT}${HOOK_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SideNotch-Token': TOKEN, ...headers }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let changes = 0;
  const srv = new ApprovalServer({ onChange: () => changes++ });
  srv.start({ port: PORT, token: TOKEN, timeoutSec: 2 });
  await sleep(200);
  assert.ok(srv.running, 'servidor sobe');

  // allow
  let p = post(sample('npm test'));
  await sleep(100);
  let list = srv.list();
  assert.equal(list.length, 1); assert.equal(list[0].summary, 'npm test'); assert.equal(list[0].canAlways, true);
  srv.decide(list[0].id, 'allow');
  let out = await (await p).json();
  assert.equal(out.hookSpecificOutput.decision.behavior, 'allow'); console.log('✓ allow');

  // always → ecoa permission_suggestions
  p = post(sample('git status')); await sleep(100);
  srv.decide(srv.list()[0].id, 'always');
  out = await (await p).json();
  assert.equal(out.hookSpecificOutput.decision.updatedPermissions[0].rules[0].ruleContent, 'git status'); console.log('✓ always');

  // deny
  p = post(sample('rm -rf /')); await sleep(100);
  srv.decide(srv.list()[0].id, 'deny');
  out = await (await p).json();
  assert.equal(out.hookSpecificOutput.decision.behavior, 'deny'); assert.ok(out.hookSpecificOutput.decision.message); console.log('✓ deny');

  // timeout → corpo vazio (Claude Code segue com o prompt normal)
  const t0 = Date.now();
  out = await (await post(sample('sleep'))).json();
  assert.deepEqual(out, {}); assert.ok(Date.now() - t0 >= 1900); assert.equal(srv.list().length, 0); console.log('✓ timeout');

  // ExitPlanMode → allow precisa ecoar updatedInput
  p = post({ ...sample('x'), tool_name: 'ExitPlanMode', tool_input: { plan: '# Push notifications (FCM)\n1. ...', planFilePath: 'C:\\p.md' }, permission_suggestions: [] }); await sleep(100);
  let l = srv.list()[0]; assert.equal(l.kind, 'plan'); assert.equal(l.summary, 'Push notifications (FCM)');
  srv.decide(l.id, 'allow-auto');
  out = await (await p).json();
  assert.equal(out.hookSpecificOutput.decision.updatedInput.planFilePath, 'C:\\p.md');
  assert.equal(out.hookSpecificOutput.decision.updatedPermissions[0].mode, 'auto'); console.log('✓ plano');

  // AskUserQuestion → answers em updatedInput
  const qs = [{ question: 'Qual framework?', header: 'FW', options: [{ label: 'React' }, { label: 'Vue' }], multiSelect: false }];
  p = post({ ...sample('x'), tool_name: 'AskUserQuestion', tool_input: { questions: qs } }); await sleep(100);
  l = srv.list()[0]; assert.equal(l.kind, 'question'); assert.equal(l.questions.length, 1);
  srv.decide(l.id, 'allow', { answers: { 'Qual framework?': 'React' } });
  out = await (await p).json();
  assert.deepEqual(out.hookSpecificOutput.decision.updatedInput.answers, { 'Qual framework?': 'React' });
  assert.equal(out.hookSpecificOutput.decision.updatedInput.questions.length, 1);
  assert.equal(srv.history[0].delivered, true); console.log('✓ pergunta');

  // eventos → sessões + feed
  const ev = (body) => fetch(`http://127.0.0.1:${PORT}${EVENT_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SideNotch-Token': TOKEN }, body: JSON.stringify(body) });
  const notes = []; srv.on('notify', (n) => notes.push(n));
  assert.deepEqual(await (await ev({ hook_event_name: 'SessionStart', session_id: 's9', cwd: 'C:\\dev\\pitchai', model: 'claude-opus-5', source: 'startup' })).json(), {});
  await ev({ hook_event_name: 'UserPromptSubmit', session_id: 's9', cwd: 'C:\\dev\\pitchai', prompt: 'faz x' });
  const S = () => srv.listSessions().find((x) => x.id === 's9'); let ss = [S()]; assert.equal(ss[0].status, 'running'); assert.equal(ss[0].project, 'pitchai'); assert.equal(ss[0].model, 'claude-opus-5');
  await ev({ hook_event_name: 'Stop', session_id: 's9', cwd: 'C:\\dev\\pitchai', stop_hook_active: false, last_assistant_message: 'Pronto, terminei.' });
  assert.equal(S().status, 'idle'); assert.equal(notes[0].type, 'done'); assert.match(notes[0].title, /pitchai terminou/);
  await ev({ hook_event_name: 'Notification', session_id: 's9', cwd: 'C:\\dev\\pitchai', notification_type: 'idle_prompt', message: 'Claude is waiting' });
  assert.equal(S().status, 'waiting'); assert.equal(notes[1].type, 'waiting');
  await ev({ hook_event_name: 'PermissionDenied', session_id: 's9', cwd: 'C:\\dev\\pitchai', permission_mode: 'auto', tool_name: 'Bash', tool_input: { command: 'rm -rf x' }, reason: 'Blocked' });
  assert.equal(notes[2].type, 'denied'); assert.match(notes[2].text, /rm -rf x/);
  assert.equal(srv.feed.length, 3); srv.dismiss(notes[0].id); assert.equal(srv.feed.length, 2);
  await ev({ hook_event_name: 'SessionEnd', session_id: 's9', reason: 'other' });
  assert.equal(S().status, 'ended');
  console.log('✓ eventos/sessões/feed');

  // token errado → 401
  const r = await post(sample('x'), { 'X-SideNotch-Token': 'bad' });
  assert.equal(r.status, 401); console.log('✓ token');

  // outro evento → ignorado com {}
  out = await (await post({ hook_event_name: 'PreToolUse' })).json();
  assert.deepEqual(out, {}); console.log('✓ outros eventos');

  srv.stop();

  // instalação do hook em um CLAUDE_CONFIG_DIR temporário
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-'));
  process.env.CLAUDE_CONFIG_DIR = dir;
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls *)'] }, hooks: { PermissionRequest: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } }));
  installHook({ port: PORT, token: TOKEN, timeoutSec: 110 });
  let cfg = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(cfg.permissions.allow[0], 'Bash(ls *)', 'preserva o resto');
  assert.equal(cfg.hooks.PermissionRequest.length, 2, 'preserva hook existente');
  assert.equal(cfg.hooks.PermissionRequest[1].hooks[0].url, `http://127.0.0.1:${PORT}${HOOK_PATH}`);
  assert.equal(cfg.hooks.PermissionRequest[1].hooks[0].timeout, 120);
  for (const e of EVENT_HOOKS) assert.ok(cfg.hooks[e] && cfg.hooks[e].some((h) => h.hooks[0].url.endsWith(EVENT_PATH)), 'instala ' + e);
  assert.ok(hookInstalled());
  installHook({ port: PORT, token: TOKEN, timeoutSec: 110 });
  cfg = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(cfg.hooks.PermissionRequest.length, 2, 'não duplica');
  uninstallHook();
  cfg = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(cfg.hooks.PermissionRequest.length, 1); assert.ok(!cfg.hooks.Stop); assert.ok(!hookInstalled());
  console.log('✓ install/uninstall hook');
  console.log('\naprovações OK'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
