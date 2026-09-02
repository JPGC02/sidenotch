const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell, globalShortcut, Notification } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { fetchAll, resetCache } = require('./providers');
const approvals = require('./approvals');
const { History } = require('./history');
const { Updater } = require('./updater');
const { MaestriClient } = require('./maestri');

const WIN_W = 340;            // largura da janela transparente (barra + cartões)
let WIN_H = 420;
let store, bar, settingsWin, tray, timer, server, history, updater, maestri;
let lastUsage = [];

if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  history = new History(app.getPath('userData'));
  if (!store.get().approvals.token) store.set({ approvals: { token: approvals.newToken() } });
  createBar();
  createTray();
  applyAutoLaunch();
  startServer();
  startMaestri();
  registerShortcuts();
  updater = new Updater({ onState: (st) => { broadcast('update', st); buildTrayMenu(); } });
  updater.start(store.get().update.auto);
  scheduleRefresh();
  refresh();
});

app.on('second-instance', () => openSettings());
app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---------- Servidor de hooks (aprovações + eventos) ----------
function startServer() {
  if (!server) {
    server = new approvals.ApprovalServer();
    server.on('change', broadcastApprovals);
    server.on('pending', (p) => { if (!store.get().dnd) { if (bar && !bar.isVisible()) bar.show(); if (store.get().approvals.sound) shell.beep(); } });
    server.on('notify', onNotify);
  }
  const a = store.get().approvals;
  if (a.enabled) server.start({ port: Number(a.port) || 47321, token: a.token, timeoutSec: Number(a.timeoutSec) || 110 });
  else server.stop();
}

// ---------- Maestri Wire ----------
function startMaestri() {
  if (!maestri) {
    maestri = new MaestriClient(() => store.get().maestri, (patch) => store.set({ maestri: patch }));
    maestri.on('change', broadcastApprovals);
    maestri.on('connected', () => server && server._notify({ type: 'done', title: `Maestri conectado: ${maestri.info && maestri.info.name || ''}`, text: `${maestri.workspaces.length} workspace(s)` }));
    maestri.on('attention', (t) => { if (store.get().maestri.notifyAttention) server && server._notify({ type: 'waiting', title: `${t.name} precisa de atenção`, text: ((t.preview || []).filter((l) => l && l.trim()).slice(-1)[0] || '').slice(0, 200), project: t.workspaceName, maestriTerminalId: t.id }); });
    maestri.on('prompt', (p) => { if (!store.get().dnd) { if (bar && !bar.isVisible()) bar.show(); if (store.get().approvals.sound) shell.beep(); } });
  }
  const m = store.get().maestri;
  if (m.enabled && m.token) maestri.start(Math.max(2, Number(m.pollSeconds) || 4) * 1000); else maestri.stop();
}

function approvalsState() {
  const a = store.get().approvals;
  return {
    enabled: !!a.enabled, running: !!(server && server.running), port: a.port,
    error: server && server.lastError || null,
    hookInstalled: approvals.hookInstalled(), settingsFile: approvals.claudeSettingsPath(),
    pending: server ? server.list() : [],
    sessions: server ? server.listSessions() : [],
    feed: server ? server.feed : [],
    history: server ? server.history : [],
    dnd: !!store.get().dnd,
    maestri: maestri ? maestri.state() : null
  };
}

function broadcastApprovals() { broadcast('approvals', approvalsState()); updateTrayTooltip(); }

function onNotify(n) {
  const cfg = store.get().notifications;
  const want = { done: cfg.done, waiting: cfg.waiting, denied: cfg.denied, limit: true, error: true, alert: true, update: true }[n.type];
  if (!want) { server.feed = server.feed.filter((x) => x.id !== n.id); return; }
  broadcast('notify', n);
  if (store.get().dnd) return;
  if (bar && !bar.isVisible()) bar.show();
  if (n.type !== 'done' || cfg.done) shell.beep();
  if (cfg.toast && Notification.isSupported()) {
    try { const t = new Notification({ title: n.title, body: n.text || '', silent: true }); t.on('click', () => { if (bar) { bar.show(); bar.webContents.send('bar:open'); } }); t.show(); } catch { /* ignore */ }
  }
}

// ---------- Barra lateral ----------
function createBar() {
  bar = new BrowserWindow({
    width: WIN_W, height: WIN_H,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  bar.setAlwaysOnTop(true, 'screen-saver');
  bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bar.setMenu(null);
  bar.loadFile(path.join(__dirname, 'renderer', 'bar.html'));
  bar.once('ready-to-show', () => { positionBar(); bar.show(); });
  bar.setIgnoreMouseEvents(true, { forward: true });
  const keepOnTop = () => {
    if (!bar || bar.isDestroyed() || !bar.isVisible() || dragging) return;
    bar.setAlwaysOnTop(true, 'screen-saver', 1);
    bar.moveTop();
  };
  setInterval(keepOnTop, 1500);
  bar.on('show', keepOnTop);
  app.on('browser-window-blur', keepOnTop);
  app.on('browser-window-focus', keepOnTop);
  bar.on('blur', () => { if (bar && !bar.isDestroyed() && bar.isFocusable()) { bar.setFocusable(false); bar.webContents.send('bar:blur'); } });
  screen.on('display-metrics-changed', positionBar);
  screen.on('display-added', positionBar);
  screen.on('display-removed', positionBar);
}

function targetDisplay() {
  const s = store.get();
  const all = screen.getAllDisplays();
  return all.find((d) => String(d.id) === String(s.displayId)) || screen.getPrimaryDisplay();
}

function positionBar() {
  if (!bar || dragging) return;
  const s = store.get();
  const { workArea } = targetDisplay();
  const x = s.side === 'left' ? workArea.x : workArea.x + workArea.width - WIN_W;
  let y;
  if (s.vertical === 'custom' && s.y != null) y = Number(s.y);
  else if (s.vertical === 'top') y = workArea.y + 16 + Number(s.offset || 0);
  else if (s.vertical === 'bottom') y = workArea.y + workArea.height - WIN_H - 16 + Number(s.offset || 0);
  else y = workArea.y + Math.round((workArea.height - WIN_H) / 2) + Number(s.offset || 0);
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - WIN_H));
  bar.setBounds({ x, y, width: WIN_W, height: WIN_H });
}

// ---------- Arrastar a barra ----------
let dragging = null;
function dragStart() {
  if (!bar) return;
  const cur = screen.getCursorScreenPoint();
  const b = bar.getBounds();
  dragging = { grabDy: cur.y - b.y, timer: null, safety: setTimeout(dragEnd, 15000) };
  dragging.timer = setInterval(() => {
    const c = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(c);
    const wa = d.workArea;
    const side = c.x < wa.x + wa.width / 2 ? 'left' : 'right';
    const x = side === 'left' ? wa.x : wa.x + wa.width - WIN_W;
    const y = Math.max(wa.y, Math.min(c.y - dragging.grabDy, wa.y + wa.height - WIN_H));
    bar.setBounds({ x, y, width: WIN_W, height: WIN_H });
    dragging.last = { side, y, displayId: String(d.id) };
  }, 16);
}
function dragEnd() {
  if (!dragging) return;
  clearInterval(dragging.timer); clearTimeout(dragging.safety);
  const last = dragging.last; dragging = null;
  if (last) { store.set({ side: last.side, y: last.y, vertical: 'custom', displayId: last.displayId }); broadcast('settings', store.get()); }
  positionBar();
}

// ---------- Atualização de uso ----------
async function refresh(force = false) {
  try { lastUsage = await fetchAll(store.get(), { force: force === true }); }
  catch (e) { lastUsage = [{ id: 'app', name: 'SideNotch', ok: false, error: String(e) }]; }
  try {
    const alerts = history.record(lastUsage, store.get().alerts);
    for (const a of alerts) server && server._notify(a.type === 'reset'
      ? { type: 'alert', title: `${a.name}: janela reiniciou`, text: `Uso voltou para ${Math.round(a.percent)}%.` }
      : { type: 'alert', title: `${a.name}: ${a.threshold}% da cota`, text: `Você já usou ${Math.round(a.percent)}%${a.resetsAt ? ' · reinicia ' + new Date(a.resetsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}.` });
    for (const u of lastUsage) { u.forecast = history.forecast(u.id); u.series = history.series(u.id); }
  } catch { /* histórico é best-effort */ }
  broadcast('usage', lastUsage);
  updateTrayTooltip();
}

function scheduleRefresh() {
  clearInterval(timer);
  const sec = Math.max(30, Number(store.get().refreshSeconds) || 180);
  timer = setInterval(refresh, sec * 1000);
}

function broadcast(ch, payload) {
  for (const w of [bar, settingsWin]) if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
}

// ---------- Atalhos globais ----------
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const sc = store.get().shortcuts || {};
  const reg = (acc, fn) => { if (!acc) return; try { globalShortcut.register(acc, fn); } catch { /* combinação inválida */ } };
  reg(sc.toggle, () => { if (bar) { if (!bar.isVisible()) bar.show(); bar.webContents.send('bar:toggle'); } });
  reg(sc.approve, () => { const p = server && server.list()[0]; if (p && p.kind === 'permission') server.decide(p.id, 'allow'); });
  reg(sc.deny, () => { const p = server && server.list()[0]; if (p) server.decide(p.id, 'deny'); });
}

// ---------- Bandeja ----------
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  buildTrayMenu();
  tray.on('double-click', openSettings);
  updateTrayTooltip();
}

function buildTrayMenu() {
  if (!tray) return;
  const st = updater ? updater.state : { status: 'idle' };
  const upLabel = st.status === 'downloaded' ? `Instalar atualização ${st.available}` : st.status === 'available' ? `Baixar atualização ${st.available}` : st.status === 'downloading' ? `Baixando… ${st.progress || 0}%` : 'Verificar atualizações';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Atualizar uso agora', click: () => refresh(true) },
    { label: 'Não perturbe', type: 'checkbox', checked: !!store.get().dnd, click: (mi) => setDnd(mi.checked) },
    { label: 'Configurações…', click: openSettings },
    { type: 'separator' },
    { label: upLabel, enabled: st.status !== 'unsupported' && st.status !== 'downloading', click: () => { if (st.status === 'downloaded') updater.install(); else if (st.status === 'available') updater.download(); else updater.check(); } },
    { label: `Versão ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Mostrar/ocultar barra', click: () => (bar.isVisible() ? bar.hide() : bar.show()) },
    { label: 'Sair', click: () => { app.exit(0); } }
  ]));
}

function setDnd(v) { store.set({ dnd: !!v }); broadcast('settings', store.get()); broadcastApprovals(); buildTrayMenu(); }

function updateTrayTooltip() {
  if (!tray) return;
  const lines = lastUsage.map((u) => u.ok && u.primary ? `${u.name}: ${Math.round(u.primary.usedPercent)}% usado` : u.ok && u.stats ? `${u.name}: ${u.stats.label} hoje` : `${u.name}: ${u.error || '—'}`);
  const n = server ? server.pending.size : 0;
  if (n) lines.unshift(`⚠ ${n} aprovação(ões) pendente(s) do Claude Code`);
  if (store.get().dnd) lines.unshift('🔕 Não perturbe');
  tray.setToolTip(['SideNotch', ...lines].join('\n') || 'SideNotch');
}

// ---------- Configurações ----------
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560, height: 760, title: 'SideNotch — Configurações', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function applyAutoLaunch() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.get().autoLaunch, path: process.execPath });
}

// ---------- IPC ----------
ipcMain.handle('settings:get', () => store.get());
ipcMain.handle('settings:save', (_e, patch) => {
  const before = JSON.stringify(store.get().approvals);
  store.set(patch);
  positionBar(); scheduleRefresh(); applyAutoLaunch(); registerShortcuts(); buildTrayMenu();
  if (JSON.stringify(store.get().approvals) !== before) startServer();
  startMaestri();
  broadcast('settings', store.get());
  resetCache();
  refresh();
  return store.get();
});
ipcMain.handle('approvals:get', () => approvalsState());
ipcMain.handle('approvals:decide', (_e, id, decision, extra) => { server && server.decide(id, decision, extra || {}); return approvalsState(); });
ipcMain.handle('approvals:install-hook', () => {
  const a = store.get().approvals;
  approvals.installHook({ port: Number(a.port) || 47321, token: a.token, timeoutSec: Number(a.timeoutSec) || 110 });
  return approvalsState();
});
ipcMain.handle('approvals:uninstall-hook', () => { approvals.uninstallHook(); return approvalsState(); });
ipcMain.handle('maestri:pair', async (_e, opts) => { try { await maestri.pair(opts || {}); startMaestri(); return { ok: true, state: maestri.state() }; } catch (e) { return { ok: false, error: String(e && e.message || e), state: maestri.state() }; } });
ipcMain.handle('maestri:unpair', () => { maestri.stop(); store.set({ maestri: { token: '', deviceId: '', role: '', keyHash: '', enabled: false } }); maestri.info = null; maestri.connected = false; broadcastApprovals(); return maestri.state(); });
ipcMain.handle('maestri:action', async (_e, id, action, text) => {
  try {
    if (action === 'approve') await maestri.approve(id); else if (action === 'reject') await maestri.reject(id);
    else if (action === 'seen') await maestri.seen(id); else if (action === 'focus') await maestri.focus(id);
    else if (action === 'prompt') await maestri.prompt(id, text || '');
    if (action === 'approve' || action === 'reject') maestri.prompts.delete(id);
    broadcastApprovals(); maestri.poll().catch(() => {});
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
ipcMain.handle('feed:dismiss', (_e, id) => { server && (id === '*' ? server.clearFeed() : server.dismiss(id)); return approvalsState(); });
ipcMain.handle('dnd:set', (_e, v) => { setDnd(v); return store.get(); });
ipcMain.handle('usage:get', () => lastUsage);
ipcMain.handle('usage:refresh', async () => { await refresh(true); return lastUsage; });
ipcMain.handle('update:get', () => updater ? updater.state : null);
ipcMain.handle('update:check', () => { updater && updater.check(); return updater && updater.state; });
ipcMain.handle('update:download', () => { updater && updater.download(); return updater && updater.state; });
ipcMain.handle('update:install', () => { updater && updater.install(); return updater && updater.state; });
ipcMain.handle('displays:get', () => screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: `Monitor ${i + 1} (${d.size.width}×${d.size.height})${d.id === screen.getPrimaryDisplay().id ? ' — principal' : ''}` })));
ipcMain.on('bar:ignore-mouse', (_e, ignore) => { if (bar && !dragging) bar.setIgnoreMouseEvents(!!ignore, { forward: true }); });
ipcMain.on('bar:height', (_e, h) => { const nh = Math.max(160, Math.min(1000, Math.round(h))); if (nh !== WIN_H) { WIN_H = nh; positionBar(); } });
ipcMain.on('bar:focusable', (_e, v) => { if (!bar) return; bar.setFocusable(!!v); if (v) bar.focus(); });
ipcMain.on('bar:drag', (_e, phase) => { if (phase === 'start') dragStart(); else dragEnd(); });
ipcMain.on('app:open-settings', openSettings);
ipcMain.on('app:quit', () => app.exit(0));
ipcMain.on('app:open-url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
