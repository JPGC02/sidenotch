// Atalhos de apps: varre o Menu Iniciar (.lnk), resolve ícones via Electron e lança com shell.openPath.
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { spawn } = require('child_process');

const IGNORE = /uninstall|desinstal|readme|help|ajuda|website|documentation|license|licença|update|atualiza/i;

// Menu Iniciar (usuário e máquina) + Área de trabalho (usuário e pública): muitos apps de rede só têm atalho no desktop
function startMenuDirs() {
  const d = [];
  if (process.env.USERPROFILE) { d.push(path.join(process.env.USERPROFILE, 'Desktop')); d.push(path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop')); d.push(path.join(process.env.USERPROFILE, 'OneDrive', 'Área de Trabalho')); }
  if (process.env.PUBLIC) d.push(path.join(process.env.PUBLIC, 'Desktop'));
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

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

async function iconFor(target, fallback) {
  const key = target || fallback;
  if (iconCache.has(key)) return iconCache.get(key);
  let url = null;
  // alvos em rede (\\servidor\…) podem demorar/travar: usa só o ícone do próprio .lnk, com tempo limite
  const candidates = target && !/^\\\\/.test(target) ? [target, fallback] : [fallback];
  for (const f of candidates) {
    if (!f) continue;
    try { const img = await withTimeout(app.getFileIcon(f, { size: 'large' }), 1500); if (img && !img.isEmpty()) { url = img.toDataURL(); break; } } catch { /* tenta o próximo */ }
  }
  iconCache.set(key, url);
  return url;
}

// roda tarefas com concorrência limitada (evita centenas de extrações de ícone ao mesmo tempo)
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// Lista apps instalados (cache 10 min). Cada item: { id, name, lnk, target, icon }
async function listInstalled({ withIcons = true, force = false } = {}) {
  if (cache && !force && Date.now() - cacheAt < 10 * 60000) return cache;
  const files = [];
  for (const d of startMenuDirs()) walk(d, 3, files);
  const seen = new Map();
  for (const lnk of files) {
    const name = path.basename(lnk, '.lnk');
    let target = null, args = '', cwd = '';
    try { const s = shell.readShortcutLink(lnk); target = s.target || null; args = s.args || ''; cwd = s.cwd || ''; } catch { /* ignora */ }
    const isExe = /\.(exe|bat|cmd|appref-ms)$/i.test(target || '');
    const entry = { id: Buffer.from(lnk).toString('base64url'), name, lnk, target, args, cwd, kind: isExe ? 'app' : (target && !path.extname(target) ? 'folder' : 'other') };
    const prev = seen.get(name.toLowerCase());
    // com nomes repetidos, prefere o atalho que aponta para um .exe (e não para uma pasta)
    if (!prev || (isExe && prev.kind !== 'app')) seen.set(name.toLowerCase(), entry);
  }
  const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (withIcons) await withTimeout(mapLimit(list, 6, async (a) => { a.icon = await iconFor(a.target, a.lnk); }), 20000);
  cache = list; cacheAt = Date.now();
  return list;
}

function splitArgs(str) {
  const out = []; const re = /"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(str || ''))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

// Lança o alvo do atalho diretamente (o ShellExecute do .lnk abria a pasta em alguns atalhos de rede);
// se o alvo não for um .exe, deixa o Windows resolver o .lnk.
async function launch(id) {
  const lnk = Buffer.from(String(id), 'base64url').toString('utf8');
  if (!/\.lnk$/i.test(lnk)) return 'caminho inválido';
  let s = null; try { s = shell.readShortcutLink(lnk); } catch { /* ignora */ }
  const target = s && s.target || '';
  if (/\.(exe|bat|cmd)$/i.test(target)) {
    try {
      const cwd = (s.cwd && fs.existsSync(s.cwd)) ? s.cwd : path.dirname(target);
      const child = spawn(target, splitArgs(s.args), { cwd, detached: true, stdio: 'ignore', windowsHide: false, shell: /\.(bat|cmd)$/i.test(target) });
      child.on('error', () => shell.openPath(lnk));
      child.unref();
      return '';
    } catch { /* cai no openPath */ }
  }
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
