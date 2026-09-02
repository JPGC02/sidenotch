// Auto-update via GitHub Releases (electron-updater). Só funciona no build NSIS instalado;
// no ZIP portátil / modo dev apenas informa que há versão nova.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* dependência ausente em dev */ }

class Updater {
  constructor({ onState }) {
    this.onState = onState;
    this.state = { status: 'idle', version: null, available: null, error: null, canInstall: false, checkedAt: null };
  }

  // precisa do instalador NSIS: o ZIP portátil não traz resources/app-update.yml
  get supported() { return !!(autoUpdater && app.isPackaged && fs.existsSync(path.join(process.resourcesPath || '', 'app-update.yml'))); }

  start(auto) {
    if (!this.supported) { this._set({ status: 'unsupported' }); return; }
    autoUpdater.autoDownload = !!auto;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this._set({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (i) => this._set({ status: 'available', available: i.version }));
    autoUpdater.on('update-not-available', () => this._set({ status: 'uptodate', available: null, checkedAt: new Date().toISOString() }));
    autoUpdater.on('download-progress', (p) => this._set({ status: 'downloading', progress: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => this._set({ status: 'downloaded', available: i.version, canInstall: true }));
    autoUpdater.on('error', (e) => this._set({ status: 'error', error: String(e && e.message || e) }));
    this.check();
    setInterval(() => this.check(), 6 * 3600 * 1000);
  }

  check() { if (this.supported) autoUpdater.checkForUpdates().catch((e) => this._set({ status: 'error', error: String(e.message || e) })); }
  download() { if (this.supported) autoUpdater.downloadUpdate().catch((e) => this._set({ status: 'error', error: String(e.message || e) })); }
  install() { if (this.supported && this.state.canInstall) autoUpdater.quitAndInstall(false, true); }

  _set(patch) { Object.assign(this.state, patch); this.onState && this.onState(this.state); }
}

module.exports = { Updater };
