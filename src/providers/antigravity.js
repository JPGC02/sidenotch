// Google Antigravity (IDE) — consulta o language server local do Antigravity em execução
// (mesma técnica do CodexBar): acha o processo, extrai porta + token CSRF da linha de comando
// e chama GetUserStatus, que traz a cota restante por modelo.
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { window: W, result, failure } = require('./util');

const ID = 'antigravity', NAME = 'Antigravity';
const PATH_STATUS = '/exa.language_server_pb.LanguageServerService/GetUserStatus';

// Lista processos do language server do Antigravity com porta e csrf (Windows via PowerShell; *nix via ps)
function findEndpoints() {
  return new Promise((resolve) => {
    const done = (lines) => {
      const eps = [];
      for (const cmd of lines) {
        const l = cmd.toLowerCase();
        if (!l.includes('language_server') || !l.includes('antigravity')) continue;
        const port = /--extension_server_port[= ]+(\d+)/.exec(cmd);
        const csrf = /--extension_server_csrf_token[= ]+([\w-]+)/.exec(cmd) || /--csrf_token[= ]+([\w-]+)/.exec(cmd);
        if (port) eps.push({ port: Number(port[1]), csrf: csrf ? csrf[1] : '' });
      }
      resolve(eps);
    };
    if (process.platform === 'win32') {
      execFile('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*language_server*' } | Select-Object -ExpandProperty CommandLine"],
        { windowsHide: true, timeout: 10000, maxBuffer: 4e6 }, (err, out) => done(err ? [] : String(out).split(/\r?\n/)));
    } else {
      execFile('ps', ['-eo', 'args'], { timeout: 5000, maxBuffer: 4e6 }, (err, out) => done(err ? [] : String(out).split('\n')));
    }
  });
}

function postJson(scheme, port, p, body, csrf, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const mod = scheme === 'https' ? https : http;
    const req = mod.request({ host: '127.0.0.1', port, path: p, method: 'POST', rejectUnauthorized: false, timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Connect-Protocol-Version': '1', ...(csrf ? { 'X-Codeium-Csrf-Token': csrf } : {}) } },
    (res) => { let t = ''; res.on('data', (c) => t += c); res.on('end', () => { if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`)); try { resolve(JSON.parse(t)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(data);
  });
}

const BODY = { metadata: { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: 'unknown', locale: 'en' } };

function parse(data) {
  const us = (data && data.userStatus) || {};
  const models = (us.cascadeModelConfigData && us.cascadeModelConfigData.clientModelConfigs) || [];
  const seen = new Map();
  for (const m of models) {
    const q = m.quotaInfo; if (!q || q.remainingFraction == null) continue;
    const key = m.label || (m.modelOrAlias && m.modelOrAlias.model) || '?';
    const cur = seen.get(key);
    if (!cur || q.remainingFraction < cur.remainingFraction) seen.set(key, q);
  }
  const entries = [...seen.entries()].sort((a, b) => a[1].remainingFraction - b[1].remainingFraction);
  const windows = entries.map(([label, q]) => W(label, (1 - q.remainingFraction) * 100, q.resetTime || null, null));
  const plan = us.planStatus && us.planStatus.planInfo && (us.planStatus.planInfo.planDisplayName || us.planStatus.planInfo.planName || us.planStatus.planInfo.displayName) || (us.userTier && us.userTier.name) || null;
  const r = result(ID, NAME, windows, { account: us.email || null, plan });
  if (!windows.length) r.note = 'Antigravity aberto, mas sem informação de cota por modelo.';
  return r;
}

async function fetchUsage() {
  const eps = await findEndpoints();
  if (!eps.length) return failure(ID, NAME, 'Antigravity não está aberto', 'Abra o Antigravity (IDE); a cota é lida do processo local.');
  let lastErr = null;
  for (const ep of eps) for (const scheme of ['https', 'http']) {
    try { return parse(await postJson(scheme, ep.port, PATH_STATUS, BODY, ep.csrf)); } catch (e) { lastErr = e; }
  }
  return failure(ID, NAME, lastErr || 'Falha ao consultar o language server');
}

module.exports = { id: ID, name: NAME, fetchUsage, parse };
