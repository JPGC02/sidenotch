// Gemini CLI / Antigravity — lê ~/.gemini/oauth_creds.json e consulta a cota do Code Assist
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { readJson, home, decodeJwt, fetchJson, window: W, result, failure } = require('./util');

const ID = 'gemini', NAME = 'Gemini';
const QUOTA = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
const LOAD = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
const TOKEN = 'https://oauth2.googleapis.com/token';

const CREDS_FILE = () => home('.gemini', 'oauth_creds.json');

// Procura o client_id/secret do gemini-cli (necessários só para renovar o token)
function findClientCreds() {
  if (process.env.GEMINI_OAUTH_CLIENT_ID && process.env.GEMINI_OAUTH_CLIENT_SECRET)
    return { id: process.env.GEMINI_OAUTH_CLIENT_ID, secret: process.env.GEMINI_OAUTH_CLIENT_SECRET };
  const roots = [];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8', windowsHide: true, timeout: 8000 }).trim()); } catch { /* npm ausente */ }
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
  for (const root of roots) {
    const pkg = path.join(root, '@google', 'gemini-cli');
    if (!fs.existsSync(pkg)) continue;
    const found = walk(pkg, /oauth2\.js$/, 6);
    for (const f of found) {
      const src = fs.readFileSync(f, 'utf8');
      const id = /OAUTH_CLIENT_ID\s*=\s*['"]([\w\-.]+)['"]/.exec(src);
      const secret = /OAUTH_CLIENT_SECRET\s*=\s*['"]([\w\-]+)['"]/.exec(src);
      if (id && secret) return { id: id[1], secret: secret[1] };
    }
  }
  return null;
}

function walk(dir, re, depth) {
  const out = [];
  if (depth < 0) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' || depth > 3) out.push(...walk(p, re, depth - 1)); }
    else if (re.test(e.name)) out.push(p);
  }
  return out;
}

async function accessToken() {
  const creds = readJson(CREDS_FILE());
  if (!creds || !creds.access_token) return null;
  const email = (decodeJwt(creds.id_token || '') || {}).email || null;
  if (!creds.expiry_date || Date.now() < creds.expiry_date - 60000) return { token: creds.access_token, email };
  // expirado → tenta renovar
  const client = findClientCreds();
  if (!client || !creds.refresh_token) return { expired: true, email };
  const body = new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: creds.refresh_token, grant_type: 'refresh_token' });
  const r = await fetchJson(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r || !r.access_token) return { expired: true, email };
  const updated = { ...creds, access_token: r.access_token, expiry_date: Date.now() + (r.expires_in || 3600) * 1000 };
  if (r.id_token) updated.id_token = r.id_token;
  try { fs.writeFileSync(CREDS_FILE(), JSON.stringify(updated, null, 2)); } catch { /* ignore */ }
  return { token: r.access_token, email };
}

function parse(data, info = {}) {
  const buckets = (data && data.buckets) || [];
  const byModel = new Map();
  for (const b of buckets) {
    if (!b.modelId || b.remainingFraction == null) continue;
    const cur = byModel.get(b.modelId);
    if (!cur || b.remainingFraction < cur.remainingFraction) byModel.set(b.modelId, b);
  }
  const models = [...byModel.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  // o modelo "pro" mais usado vira o anel principal
  models.sort((a, b) => (b[0].includes('pro') ? 1 : 0) - (a[0].includes('pro') ? 1 : 0));
  const windows = models.map(([id, b]) => W(id, (1 - b.remainingFraction) * 100, b.resetTime, 1440));
  return result(ID, NAME, windows, { account: info.email, plan: info.tier });
}

async function fetchUsage() {
  let t;
  try { t = await accessToken(); } catch (e) { return failure(ID, NAME, e); }
  if (!t) return failure(ID, NAME, 'Gemini CLI não está logado', 'Instale o Gemini CLI (npm i -g @google/gemini-cli) e rode "gemini" para fazer login com Google.');
  if (t.expired) return failure(ID, NAME, 'Token expirado', 'Rode o Gemini CLI uma vez para renovar o login.');
  const headers = { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' };
  try {
    let project = null, tier = null;
    try {
      const ca = await fetchJson(LOAD, { method: 'POST', headers, body: JSON.stringify({ metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' } }) });
      project = (ca && ca.cloudaicompanionProject) || null;
      tier = ca && ca.currentTier && (ca.currentTier.name || ca.currentTier.id) || null;
    } catch { /* segue sem projeto */ }
    const data = await fetchJson(QUOTA, { method: 'POST', headers, body: JSON.stringify(project ? { project } : {}) });
    return parse(data, { email: t.email, tier });
  } catch (e) {
    if (e.status === 401) return failure(ID, NAME, 'Não autorizado (401)', 'Rode o Gemini CLI para refazer o login.');
    return failure(ID, NAME, e);
  }
}

module.exports = { id: ID, name: NAME, fetchUsage, parse };
