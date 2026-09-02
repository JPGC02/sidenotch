// Servidor Maestri Wire falso (HTTPS autoassinado) para testar pareamento, pin da chave, feed e ações
const assert = require('assert');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MaestriClient, hexToBase64 } = require('../src/maestri');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-'));
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 2 -subj "/CN=maestri" 2>/dev/null`);
const key = fs.readFileSync(`${dir}/k.pem`), cert = fs.readFileSync(`${dir}/c.pem`);
const expectedHash = crypto.createHash('sha256').update(crypto.createPublicKey(cert).export({ type: 'spki', format: 'der' })).digest('base64');

const calls = [];
let attention = false, pending = false;
const srv = https.createServer({ key, cert }, (req, res) => {
  let b = ''; req.on('data', (c) => b += c);
  req.on('end', () => {
    calls.push(req.method + ' ' + req.url);
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/pair') { const body = JSON.parse(b); if (body.code !== '483920') return json(401, { error: { code: 'unauthorized', message: 'bad code' } }); return json(200, { token: 'a'.repeat(64), deviceId: 'D1', deviceName: body.deviceName, protocolVersion: 1, role: 'owner' }); }
    if (req.headers.authorization !== 'Bearer ' + 'a'.repeat(64)) return json(401, { error: { code: 'unauthorized', message: 'no' } });
    if (req.url === '/api/info') return json(200, { name: 'Studio', protocolVersion: 1, capabilities: ['feedSnapshots', 'terminalFocus'], hosts: ['127.0.0.1'] });
    if (req.url === '/api/workspaces') return json(200, { workspaces: [{ id: 'W1', name: 'pitchai', isLoaded: true, terminalCount: 1, runningTerminalCount: 1, attentionCount: attention ? 1 : 0 }, { id: 'W2', name: 'locked', isLocked: true }] });
    if (req.url === '/api/workspaces/W1/feed') return json(200, { items: [{ kind: pending ? 'pendingPrompt' : 'terminal', prompt: pending ? 'Run npm test? (y/n)' : undefined, terminal: { id: 'T1', name: 'Claude Code #3', agentType: 'claude', status: 'running', isRunning: true, isActive: !attention, needsAttention: attention, lastActiveAt: attention ? '2' : '1', preview: ['', 'Waiting for input'], nodeId: 'N1' } }] });
    if (/^\/api\/terminals\/T1\/(approve|reject|seen|focus|prompt)$/.test(req.url)) return json(200, { ok: true });
    json(404, { error: { code: 'notFound', message: 'x' } });
  });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  let cfg = { enabled: false, host: '127.0.0.1', port, token: '', keyHash: '' };
  const c = new MaestriClient(() => cfg, (p) => Object.assign(cfg, p));

  await assert.rejects(c.pair({ code: '000000' }), /bad code/);
  const r = await c.pair({ code: '483920' });
  assert.equal(r.role, 'owner'); assert.equal(cfg.token.length, 64); assert.equal(cfg.keyHash, expectedHash, 'fixou a chave SPKI');
  assert.equal(c.info.name, 'Studio'); assert.ok(c.has('feedSnapshots')); console.log('✓ pareamento + pin');

  const events = [];
  c.on('attention', (t) => events.push('attention:' + t.id)); c.on('prompt', (p) => events.push('prompt:' + p.terminalId)); c.on('connected', () => events.push('connected'));
  await c.poll();
  let st = c.state();
  assert.equal(st.connected, true); assert.equal(st.terminals.length, 1); assert.equal(st.terminals[0].name, 'Claude Code #3'); assert.equal(st.terminals[0].isActive, true); assert.equal(st.prompts.length, 0);
  assert.equal(st.workspaces.length, 2); assert.deepEqual(events, ['connected']); console.log('✓ feed → terminais');

  attention = true; pending = true; await c.poll();
  st = c.state();
  assert.equal(st.prompts.length, 1); assert.equal(st.prompts[0].prompt, 'Run npm test? (y/n)'); assert.equal(st.terminals[0].needsAttention, true);
  assert.deepEqual(events.slice(1), ['attention:T1', 'prompt:T1']);
  await c.poll(); assert.equal(events.length, 3, 'não repete atenção/prompt'); console.log('✓ atenção + prompt S/n');

  await c.approve('T1'); await c.focus('T1'); await c.prompt('T1', 'continua'); await c.seen('T1');
  assert.ok(calls.includes('POST /api/terminals/T1/approve') && calls.includes('POST /api/terminals/T1/focus') && calls.includes('POST /api/terminals/T1/prompt')); console.log('✓ ações');

  // chave diferente → recusa
  cfg.keyHash = 'x'.repeat(44);
  await assert.rejects(c.request('GET', '/api/info'), /Chave do host mudou/); console.log('✓ pin rejeita chave diferente');
  // token revogado → 401 vira erro amigável
  cfg.keyHash = expectedHash; cfg.token = 'b'.repeat(64);
  await c.poll().catch((e) => c._fail(e)); assert.match(c.lastError, /pareie de novo/); console.log('✓ 401');

  assert.equal(hexToBase64('AA:'.repeat(31) + 'AA'), Buffer.alloc(32, 0xaa).toString('base64'));
  srv.close(); console.log('\nmaestri OK'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
