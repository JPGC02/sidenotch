// Atalhos de apps: varre o Menu Iniciar (.lnk), resolve ícones via Electron e lança com shell.openPath.
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

const IGNORE = /uninstall|desinstal|readme|help|ajuda|website|documentation|license|licença|update|atualiza/i;

function startMenuDirs() {
  const d = [];
  if (process.env.APPDATA) d.push(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  if (process.env.ProgramData) d.push(path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  return d.filter((x) => fs.existsSync(x));
}

function walk(dir, depth, out) {
  if (depth < 0) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth - 1, out);
    else if (/\.lnk$/i.test(e.name) && !IGNORE.test(e.name)) out.push(p);
  }
}

let cache = null, cacheAt = 0;
const iconCache = new Map();

async function iconFor(target, fallback) {
  const key = target || fallback;
  if (iconCache.has(key)) return iconCache.get(key);
  let url = null;
  for (const f of [target, fallback]) {
    if (!f) continue;
    try { const img = await app.getFileIcon(f, { size: 'large' }); if (img && !img.isEmpty()) { url = img.toDataURL(); break; } } catch { /* tenta o próximo */ }
  }
  iconCache.set(key, url);
  return url;
}

// Lista apps instalados (cache 10 min). Cada item: { id, name, lnk, target, icon }
async function listInstalled({ withIcons = true, force = false } = {}) {
  if (cache && !force && Date.now() - cacheAt < 10 * 60000) return cache;
  const files = [];
  for (const d of startMenuDirs()) walk(d, 3, files);
  const seen = new Map();
  for (const lnk of files) {
    const name = path.basename(lnk, '.lnk');
    if (seen.has(name.toLowerCase())) continue;
    let target = null;
    try { const s = shell.readShortcutLink(lnk); target = s.target || null; if (target && !/\.exe$/i.test(target)) { /* msi/Store apps */ } } catch { /* ignora */ }
    seen.set(name.toLowerCase(), { id: Buffer.from(lnk).toString('base64url'), name, lnk, target });
  }
  const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (withIcons) await Promise.all(list.map(async (a) => { a.icon = await iconFor(a.target, a.lnk); }));
  cache = list; cacheAt = Date.now();
  return list;
}

function launch(id) {
  const lnk = Buffer.from(String(id), 'base64url').toString('utf8');
  if (!/\.lnk$/i.test(lnk)) return Promise.resolve('caminho inválido');
  return shell.openPath(lnk);
}

// Web apps: ícone = favicon do domínio (via Google s2) — só uma URL, sem baixar nada no main
function faviconUrl(url) {
  try { const u = new URL(url); return `https://www.google.com/s2/favicons?sz=64&domain=${u.hostname}`; } catch { return null; }
}

const DEFAULT_WEBAPPS = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai' },
  { id: 'github', name: 'GitHub', url: 'https://github.com' },
  { id: 'notion', name: 'Notion', url: 'https://www.notion.so' },
  { id: 'whatsapp', name: 'WhatsApp', url: 'https://web.whatsapp.com' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com' }
];

module.exports = { listInstalled, launch, faviconUrl, DEFAULT_WEBAPPS };
