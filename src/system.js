// Monitor do sistema + player de mídia.
// CPU/RAM vêm do Node; rede, discos e a sessão de mídia (SMTC) vêm do worker PowerShell (src/winworker.ps1).
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const APP_NAMES = [
  [/spotify/i, 'Spotify'], [/youtube\s*music|ytmusic/i, 'YouTube Music'], [/youtube/i, 'YouTube'],
  [/chrome\._crx_/i, 'App web (Chrome)'], [/chrome/i, 'Chrome'], [/msedge|edge/i, 'Edge'], [/firefox/i, 'Firefox'], [/brave/i, 'Brave'],
  [/vlc/i, 'VLC'], [/deezer/i, 'Deezer'], [/tidal/i, 'TIDAL'], [/amazon\s*music/i, 'Amazon Music'], [/apple\s*music|itunes/i, 'Apple Music'],
  [/zune|microsoft\.zunemusic|media\s*player/i, 'Media Player'], [/discord/i, 'Discord'], [/groove/i, 'Groove']
];
function appName(id, title = '') {
  if (!id) return null;
  if (/chrome\._crx_/i.test(id) || /msedge\._crx_/i.test(id)) { // PWA: tenta identificar pelo título
    for (const [re, n] of APP_NAMES) if (re.test(title) && !/chrome|edge/i.test(n)) return n;
  }
  for (const [re, n] of APP_NAMES) if (re.test(id)) return n;
  return id.replace(/\.exe$/i, '').split(/[\\/!]/).pop();
}

class SystemMonitor extends EventEmitter {
  constructor() {
    super();
    this.state = { cpu: 0, mem: { total: os.totalmem(), used: 0, percent: 0 }, net: { down: 0, up: 0 }, disks: [], media: null, uptime: 0, updatedAt: null };
    this.prevCpu = null; this.worker = null; this.timer = null; this.cmdFile = path.join(os.tmpdir(), 'sidenotch-media.cmd');
    this.history = { cpu: [], mem: [], down: [], up: [] };
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this._tickLocal(), 2000);
    this._tickLocal();
    if (process.platform === 'win32') this._startWorker();
  }
  stop() { clearInterval(this.timer); if (this.worker) { try { this.worker.kill(); } catch { /* ignore */ } this.worker = null; } }

  _tickLocal() {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    for (const c of cpus) { for (const k of Object.keys(c.times)) total += c.times[k]; idle += c.times.idle; }
    if (this.prevCpu) { const di = idle - this.prevCpu.idle, dt = total - this.prevCpu.total; this.state.cpu = dt > 0 ? Math.round((1 - di / dt) * 100) : 0; }
    this.prevCpu = { idle, total };
    const free = os.freemem(), tot = os.totalmem();
    this.state.mem = { total: tot, used: tot - free, percent: Math.round((tot - free) / tot * 100) };
    this.state.uptime = os.uptime();
    this.state.cores = cpus.length; this.state.cpuModel = (cpus[0] && cpus[0].model || '').replace(/\s+/g, ' ').trim();
    this.state.updatedAt = Date.now();
    this._push('cpu', this.state.cpu); this._push('mem', this.state.mem.percent);
    this.emit('stats', this.state);
  }

  _push(k, v) { const a = this.history[k]; a.push(v); if (a.length > 60) a.shift(); }

  _startWorker() {
    const script = path.join(__dirname, 'winworker.ps1');
    // dentro do asar o PowerShell não lê o arquivo → copia para temp
    let file = script;
    if (script.includes('app.asar')) { file = path.join(os.tmpdir(), 'sidenotch-worker.ps1'); try { fs.writeFileSync(file, fs.readFileSync(script)); } catch { /* ignore */ } }
    try {
      this.worker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, this.cmdFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { this.state.workerError = String(e); return; }
    let buf = '';
    this.worker.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        try { this._fromWorker(JSON.parse(line)); } catch { /* linha parcial */ }
      }
    });
    this.worker.stderr.on('data', (d) => { this.state.workerError = String(d).slice(0, 300); });
    this.worker.on('exit', () => { this.worker = null; setTimeout(() => { if (this.timer) this._startWorker(); }, 10000); });
  }

  _fromWorker(j) {
    if (j.net) { this.state.net = { down: Number(j.net.down) || 0, up: Number(j.net.up) || 0 }; this._push('down', this.state.net.down); this._push('up', this.state.net.up); }
    if (Array.isArray(j.disks) && j.disks.length) this.state.disks = j.disks.map((d) => ({ name: d.name, total: Number(d.total) || 0, free: Number(d.free) || 0, percent: d.total ? Math.round((1 - d.free / d.total) * 100) : 0 }));
    const m = j.media;
    this.state.media = m && (m.title || m.artist) ? {
      app: appName(m.app, `${m.title} ${m.artist}`), appId: m.app, title: m.title || '', artist: m.artist || '', album: m.album || '',
      status: m.status || 'Unknown', playing: m.status === 'Playing', position: Number(m.position) || 0, duration: Number(m.duration) || 0,
      canNext: !!m.canNext, canPrev: !!m.canPrev, at: Date.now()
    } : null;
    this.emit('stats', this.state);
  }

  // play | pause | toggle | next | prev
  media(cmd) {
    if (!['play', 'pause', 'toggle', 'next', 'prev'].includes(cmd)) return false;
    try { fs.appendFileSync(this.cmdFile, cmd + '\n'); return true; } catch { return false; }
  }

  snapshot() { return { ...this.state, history: this.history }; }
}

module.exports = { SystemMonitor, appName };
