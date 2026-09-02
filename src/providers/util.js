const fs = require('fs');
const os = require('os');
const path = require('path');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function home(...p) { return path.join(os.homedir(), ...p); }

// Decodifica o payload de um JWT sem validar assinatura
function decodeJwt(token) {
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch { return null; }
}

async function fetchJson(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status; err.body = text.slice(0, 300);
      const ra = Number(res.headers.get('retry-after')); if (ra > 0) err.retryAfter = ra;
      throw err;
    }
    return json;
  } finally { clearTimeout(t); }
}

// Formato padronizado de janela de uso
// { label, usedPercent (0-100), resetsAt (ISO|null), windowMinutes|null }
function window_(label, usedPercent, resetsAt, windowMinutes) {
  if (usedPercent == null || Number.isNaN(usedPercent)) return null;
  return {
    label,
    usedPercent: Math.max(0, Math.min(100, Math.round(usedPercent * 10) / 10)),
    resetsAt: resetsAt ? new Date(resetsAt).toISOString() : null,
    windowMinutes: windowMinutes || null
  };
}

// Resultado padronizado por provedor
function result(id, name, windows, extra = {}) {
  const ws = windows.filter(Boolean);
  return {
    id, name, ok: true,
    primary: ws[0] || null,          // usado no anel da barra
    windows: ws,
    account: extra.account || null,
    plan: extra.plan || null,
    credits: extra.credits ?? null,
    updatedAt: new Date().toISOString()
  };
}

function failure(id, name, error, hint) {
  const r = { id, name, ok: false, error: String(error && error.message || error), hint: hint || null, updatedAt: new Date().toISOString() };
  if (error && error.status) r.status = error.status;
  if (error && error.retryAfter) r.retryAfter = error.retryAfter;
  return r;
}

module.exports = { readJson, home, decodeJwt, fetchJson, window: window_, result, failure };
