// Maestri Wire — cliente do protocolo (https://www.themaestri.app/pt-br/docs/wire)
// HTTPS autoassinado na porta 7434, chave pública fixada (pin), token bearer de dispositivo.
// Fazemos polling do feed dos workspaces e transformamos terminais em "sessões" e prompts S/n em aprovações.
const https = require('https');
const tls = require('tls');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DEVICE_NAME = 'SideNotch';

class MaestriClient extends EventEmitter {
  constructor(getCfg, saveCfg) {
    super();
    this.getCfg = getCfg;            // () => { enabled, host, port, token, keyHash, deviceIdentifier, alternateHosts }
    this.saveCfg = saveCfg;          // (patch) => void
    this.info = null; this.workspaces = []; this.terminals = new Map(); this.prompts = new Map();
    this.lastError = null; this.timer = null; this.seenAttention = new Set(); this.connected = false;
  }

  // ---------- transporte ----------
  // Abre o TLS primeiro e confere o pin da chave pública ANTES de mandar qualquer coisa (o token nunca vai para um host errado).
  _connect(host, port) {
    const cfg = this.getCfg();
    return new Promise((resolve, reject) => {
      const sock = tls.connect({ host, port, rejectUnauthorized: false, servername: undefined, timeout: 8000 }, () => {
        const hash = spkiHash(sock.getPeerCertificate(true));
        if (!hash) { sock.destroy(); return reject(new Error('Não foi possível ler o certificado do host')); }
        if (cfg.keyHash && cfg.keyHash !== hash) { sock.destroy(); return reject(new Error(`Chave do host mudou (esperado ${cfg.keyHash.slice(0, 12)}…, veio ${hash.slice(0, 12)}…). Despareie e pareie de novo se trocou de máquina.`)); }
        if (!cfg.keyHash) this.saveCfg({ keyHash: hash });     // TOFU: fixa na primeira conexão
        resolve(sock);
      });
      sock.on('error', reject);
      sock.on('timeout', () => sock.destroy(new Error('timeout')));
    });
  }

  async request(method, p, body, { auth = true, host, raw = false } = {}) {
    const cfg = this.getCfg();
    const h = host || cfg.host || '127.0.0.1', port = Number(cfg.port) || 7434;
    const sock = await this._connect(h, port);
    return new Promise((resolve, reject) => {
      const data = body == null ? null : (raw ? body : JSON.stringify(body));
      const headers = { Accept: 'application/json', Connection: 'close', Host: `${h}:${port}` };
      if (data != null) { headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
      if (auth && cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
      const req = https.request({ host: h, port, path: p, method, headers, timeout: 8000, createConnection: () => sock }, (res) => {
        let t = ''; res.on('data', (c) => t += c);
        res.on('end', () => {
          let json = null; try { json = t ? JSON.parse(t) : null; } catch { /* não-JSON */ }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json || {});
          const err = new Error((json && json.error && json.error.message) || `HTTP ${res.statusCode}`);
          err.status = res.statusCode; err.code = json && json.error && json.error.code; reject(err);
        });
      });
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
      if (data != null) req.write(data);
      req.end();
    });
  }

  // ---------- pareamento ----------
  async pair({ code, password, host, port }) {
    if (host) this.saveCfg({ host, port: Number(port) || 7434, keyHash: '' });
    const cfg = this.getCfg();
    const deviceIdentifier = cfg.deviceIdentifier || crypto.randomUUID();
    const body = { deviceName: DEVICE_NAME, deviceIdentifier };
    if (code) body.code = String(code).trim(); else body.password = password;
    const r = await this.request('POST', '/pair', body, { auth: false });
    this.saveCfg({ token: r.token, deviceId: r.deviceId, role: r.role, deviceIdentifier, enabled: true });
    this.lastError = null;
    await this.refreshInfo();
    return r;
  }

  async refreshInfo() {
    const info = await this.request('GET', '/api/info');
    if (info.protocolVersion !== 1) throw new Error(`protocolVersion ${info.protocolVersion} não suportado`);
    this.info = info;
    if (Array.isArray(info.hosts) && info.hosts.length) this.saveCfg({ alternateHosts: info.hosts });
    return info;
  }

  has(cap) { return !!(this.info && Array.isArray(this.info.capabilities) && this.info.capabilities.includes(cap)); }

  // ---------- polling ----------
  start(intervalMs = 4000) {
    this.stop();
    const tick = async () => { try { await this.poll(); } catch (e) { this._fail(e); } };
    tick(); this.timer = setInterval(tick, intervalMs);
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  _fail(e) {
    const msg = String(e && e.message || e);
    const was = this.connected; this.connected = false; this.lastError = msg;
    if (e && e.status === 401) this.lastError = 'Token revogado — pareie de novo';
    if (was) this.emit('change');
  }

  async poll() {
    const cfg = this.getCfg();
    if (!cfg.enabled || !cfg.token) return;
    if (!this.info) await this.refreshInfo();
    const { workspaces = [] } = await this.request('GET', '/api/workspaces');
    this.workspaces = workspaces;
    const nextT = new Map(), nextP = new Map();
    if (this.has('feedSnapshots')) {
      for (const ws of workspaces) {
        if (ws.isLocked) continue;
        if (!ws.isLoaded && !ws.attentionCount && !ws.runningTerminalCount) continue;
        let snap; try { snap = await this.request('GET', `/api/workspaces/${ws.id}/feed`); } catch { continue; }
        for (const item of snap.items || []) {
          if (item.kind === 'terminal' || item.kind === 'pendingPrompt') {
            const t = item.terminal || {};
            nextT.set(t.id, { ...t, workspaceId: ws.id, workspaceName: ws.name });
            if (item.kind === 'pendingPrompt') nextP.set(t.id, { terminalId: t.id, prompt: item.prompt || '', terminal: t, workspaceId: ws.id, workspaceName: ws.name });
          }
        }
      }
    }
    // transições de atenção → notificações
    for (const [id, t] of nextT) {
      const prev = this.terminals.get(id);
      if (t.needsAttention && !(prev && prev.needsAttention) && !this.seenAttention.has(id + ':' + t.lastActiveAt)) {
        this.seenAttention.add(id + ':' + t.lastActiveAt);
        this.emit('attention', t);
      }
    }
    for (const [id, p] of nextP) if (!this.prompts.has(id)) this.emit('prompt', p);
    this.terminals = nextT; this.prompts = nextP;
    const was = this.connected; this.connected = true; this.lastError = null;
    const sig = JSON.stringify(this.state());
    if (sig !== this._lastSig) { this._lastSig = sig; this.emit('change'); }   // só avisa a UI quando algo mudou
    if (!was) this.emit('connected');
  }

  // ---------- ações ----------
  approve(id) { return this.request('POST', `/api/terminals/${id}/approve`, {}); }
  reject(id) { return this.request('POST', `/api/terminals/${id}/reject`, {}); }
  seen(id) { return this.request('POST', `/api/terminals/${id}/seen`, {}); }
  focus(id) { return this.request('POST', `/api/terminals/${id}/focus`, {}); }
  prompt(id, text) { return this.request('POST', `/api/terminals/${id}/prompt`, { text }); }
  clearAttention(ws) { return this.request('POST', `/api/workspaces/${ws}/attention/clear`, {}); }

  // ---------- estado para a UI ----------
  state() {
    const cfg = this.getCfg();
    return {
      enabled: !!cfg.enabled, paired: !!cfg.token, connected: this.connected, error: this.lastError,
      host: cfg.host, port: cfg.port, keyHash: cfg.keyHash || '', role: cfg.role || null,
      name: this.info && this.info.name || null, capabilities: (this.info && this.info.capabilities) || [],
      workspaces: this.workspaces.map((w) => ({ id: w.id, name: w.name, attentionCount: w.attentionCount, running: w.runningTerminalCount, total: w.terminalCount, isLoaded: w.isLoaded })),
      terminals: [...this.terminals.values()].map((t) => ({
        id: t.id, name: t.name, agentType: t.agentType, icon: t.icon, color: t.color, status: t.status,
        workspace: t.workspaceName, workspaceId: t.workspaceId, floor: t.floorName, lastActiveAt: t.lastActiveAt,
        isRunning: !!t.isRunning, isActive: !!t.isActive, needsAttention: !!t.needsAttention, isUnloaded: !!t.isUnloaded,
        preview: (t.preview || []).filter((l) => l && l.trim()).slice(-2), roleName: t.roleName || null,
        hasPrompt: this.prompts.has(t.id), promptText: this.prompts.has(t.id) ? this.prompts.get(t.id).prompt : null
      })),
      prompts: [...this.prompts.values()].map((p) => ({ terminalId: p.terminalId, prompt: p.prompt, name: p.terminal.name, agentType: p.terminal.agentType, workspace: p.workspaceName, color: p.terminal.color }))
    };
  }
}

// SHA-256 (base64) do SubjectPublicKeyInfo DER — é o `serverKeyHash` do QR/aba Manual
function spkiHash(cert) {
  try {
    if (cert && cert.pubkey) return crypto.createHash('sha256').update(cert.pubkey).digest('base64');
    if (cert && cert.raw) { const pub = crypto.createPublicKey(new crypto.X509Certificate(cert.raw).publicKey).export({ type: 'spki', format: 'der' }); return crypto.createHash('sha256').update(pub).digest('base64'); }
  } catch { /* ignore */ }
  return null;
}

// "AA:BB:…" (hex da aba Manual) → base64
function hexToBase64(hex) { const h = String(hex || '').replace(/[^0-9a-f]/gi, ''); return h.length === 64 ? Buffer.from(h, 'hex').toString('base64') : null; }

module.exports = { MaestriClient, spkiHash, hexToBase64, DEVICE_NAME };
