// Servidor Maestri Wire falso (HTTPS autoassinado) para testar pareamento, pin da chave, feed e ações
const assert = require('assert');
const https = require('https');
const crypto = require('crypto');
const { MaestriClient, hexToBase64 } = require('../src/maestri');

// certificado autoassinado de teste (só para o servidor falso; válido por 100 anos, sem openssl no CI)
const key = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC9PfsUFHO4sfoN
vtE8udqd6+Gnj/5BNI5qU3n6M11TFmq7ZSXj/7iIXISL9pybkKm61+RgF4I4L6h8
kghv2Q0aEgY6Khy2RHxPET2cW5Vh3YQfOSB0VTwzSYn8WFUNR1B4ltgRyE6/dBIf
Qdf9OZBsGLf3Bk2vLD/uLCzJt8MZz3Z1zmTfd+R0Ncb1TRnt2EMGSyd40SDkaUHb
XKJKyM0ieP0AyuecQZyAmrt6Us5gF8Bga01N7vXc1BMQY/PDXU9jBo+xBqviK2K7
I23nDPK//6kaKyGexMf2G6iiW0IosuX3wxrbigZNCryl9VGalv1eXia5aLlnmSQ1
7OTThf1tAgMBAAECggEAT8L8fPmjzsBhAwMewKgbDz249f2YbhY/QmxduImGt7r2
kHZw8ni5Z+wKx81RM7ZU+5X8QU4XSiQ4MQ0B9lZ3EbpwGnrecCpMdKzxGWJ2g3Gw
utJCrhWw0nMX8B6w9nBM6A64EkKpgkNjUf5YEXh+OTlv7HOhMYiGh5Xh6MGFv236
1ZgnMZ2dQ7emhrwW0gDk832WXuQU12VTIK4TOjw+vDelg61cCDg/l/6M1eX3TJNy
APXSbCBq2s0rVl23ujMyZBjOOwQ3FRyNvwfhoYpBHzxhkFjD8Oo3PfNxkSJc6gai
TtL2XqjPwheTuw/FGKig8p5321MgmwOax9YfCsX29wKBgQDdnNhMfptv7xM/3Nfg
xhV2CqcFuNE5SyyBoMuQ1Pq3RqIFcersSsahwrMvcdFzeTKQS9doSW5ovRos/2gX
wUokEavWKjpx6njqDaboxAdP+w2EtqdSKlNEeaZKYbfXgRC9KhadTcj6RkAAbhqM
TOsMdvpjmIbbWEuXTF24AUsLgwKBgQDam0Zf+8woqPSrGO8i2Mrn5KNZmRbUweE2
aWw+UXA7BxM7wcQAETqNKDIUjZoj12zOukKJylfwnc9QuE3m3IlM644TGNAEG/vm
zAb79vfzTVEl9k8r006mvBbqR3EKf2pTt+flMcm3wCirtM/6FY/v9yxt0yhxQlDM
+zJjDYHQTwKBgQCDgLPVSHeiB0Lr7XdomQJZJl8QBSiaD+KcFTdWfRs9MDuqcXvO
tVyC1o8Pg0GffPalK2vqJVDP9A6ZTwGMvxTorFfEYRCHUnRnpqw5iUExk67k5qIJ
HraEdo9Xqf62cY7mQRhkRakR4ifOWYeFY4tCvUM9YF/9vro0UIt4ScQnUwKBgQCn
f4gJrV393Y8ytfUtJx05VyeOVE15EWDllxtYGIA8yiwDgnESeCD73UuaEfGD+uEk
+PRYrZB6DgC2YbFW7a3KIUaH/WANdf+qFLRZRR8w7hH6W2LIOq0t9jo8oibMG1q1
8Nie9WoRAAxpnC4q+XCDNkl1kPCQ73YHyYUO/l9z4wKBgBSHc2RQKicIihkfQZk2
O1f3H71uS7Fq3mEHDBMUjq7zo+S8cz371suD+dVQrFa2JJmXPElaKeWecqoUvycs
Gooc55/iJWE8YbBfw/Sc9nXCJoUYKtbdvrKUwwdNWznNd994YI4RVv5WVeiOi4am
mTHYM39AEKOvqKUl++P33lUM
-----END PRIVATE KEY-----
`;
const cert = `-----BEGIN CERTIFICATE-----
MIIDETCCAfmgAwIBAgIUd+F4aWo6A/NAPuQPZa7hRalF+EMwDQYJKoZIhvcNAQEL
BQAwFzEVMBMGA1UEAwwMbWFlc3RyaS10ZXN0MCAXDTI2MDkwMjExNDUxMloYDzIx
MjYwODA5MTE0NTEyWjAXMRUwEwYDVQQDDAxtYWVzdHJpLXRlc3QwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQC9PfsUFHO4sfoNvtE8udqd6+Gnj/5BNI5q
U3n6M11TFmq7ZSXj/7iIXISL9pybkKm61+RgF4I4L6h8kghv2Q0aEgY6Khy2RHxP
ET2cW5Vh3YQfOSB0VTwzSYn8WFUNR1B4ltgRyE6/dBIfQdf9OZBsGLf3Bk2vLD/u
LCzJt8MZz3Z1zmTfd+R0Ncb1TRnt2EMGSyd40SDkaUHbXKJKyM0ieP0AyuecQZyA
mrt6Us5gF8Bga01N7vXc1BMQY/PDXU9jBo+xBqviK2K7I23nDPK//6kaKyGexMf2
G6iiW0IosuX3wxrbigZNCryl9VGalv1eXia5aLlnmSQ17OTThf1tAgMBAAGjUzBR
MB0GA1UdDgQWBBQaZ0js3PsulcEPdqSE40Zu11cSrzAfBgNVHSMEGDAWgBQaZ0js
3PsulcEPdqSE40Zu11cSrzAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUA
A4IBAQA5KV5s0C/ER+E/ZrvH2WKxDZsfGaC/DDQ1Rds2lSIRISDUuxfIkT1MOAgB
HF2FjIL2IFa+62eu6quiYcxDxTan8e3ncYihS84WmVA2FeKCe4W5yX6mCJ8KRscB
p3NehFA4GSpIgeg1tj9HWmqeI7VxQZGPOjLU+SwNlcCOYC7kMNQ2zwx4fUrGOEbb
Nk097rE/fsWxpxoOlEBSd0CVkiGVzJj1koOwjCqRLdx8des7l0h3xonqfULmtGzI
f9cpwRkA1VBOya+hC6HOFpJRoCF/XM6cFozNaLiVYV5MmqyOBIouq3D1MxifMIFC
+JMyE0X8oxojPq7ySNGf0Lma0J9c
-----END CERTIFICATE-----
`;
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
