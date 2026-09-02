// Histórico de uso por provedor (persistido em userData/history.json), previsão e alertas de limite.
const fs = require('fs');
const path = require('path');

const KEEP_SAMPLES_MS = 48 * 3600 * 1000;   // amostras brutas: 48h
const KEEP_DAYS = 30;                        // resumo diário: 30 dias

class History {
  constructor(dir) {
    this.file = path.join(dir, 'history.json');
    this.data = { samples: {}, daily: {} };  // samples[id] = [{t, p, r}], daily[id][YYYY-MM-DD] = {max, last}
    this.alertState = {};                    // id -> { fired: {80:true}, lastPercent, lastReset }
    try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch { /* novo */ }
  }

  // Registra uma leitura e devolve alertas gerados: [{type:'threshold'|'reset', id, name, percent, threshold}]
  record(usage, alertsCfg = { enabled: true, thresholds: [80, 95], onReset: true }) {
    const now = Date.now(), alerts = [];
    for (const u of usage) {
      if (!u.ok || !u.primary || u.stale) continue;
      const p = u.primary.usedPercent, r = u.primary.resetsAt || null;
      const arr = this.data.samples[u.id] || (this.data.samples[u.id] = []);
      const last = arr[arr.length - 1];
      if (!last || last.p !== p || now - last.t > 15 * 60000) arr.push({ t: now, p, r });
      while (arr.length && now - arr[0].t > KEEP_SAMPLES_MS) arr.shift();
      const day = new Date(now).toISOString().slice(0, 10);
      const d = this.data.daily[u.id] || (this.data.daily[u.id] = {});
      const dd = d[day] || (d[day] = { max: 0, last: 0 });
      dd.max = Math.max(dd.max, p); dd.last = p;
      const keys = Object.keys(d).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete d[k];

      // alertas
      const st = this.alertState[u.id] || (this.alertState[u.id] = { fired: {}, lastPercent: null, lastReset: r });
      if (alertsCfg.enabled) {
        if (st.lastPercent != null && (st.lastPercent - p >= 30 || (st.lastReset && r && r !== st.lastReset && p < st.lastPercent))) {
          st.fired = {};
          if (alertsCfg.onReset) alerts.push({ type: 'reset', id: u.id, name: u.name, percent: p });
        }
        for (const th of (alertsCfg.thresholds || []).map(Number).filter((x) => x > 0)) {
          if (p >= th && !st.fired[th]) { st.fired[th] = true; alerts.push({ type: 'threshold', id: u.id, name: u.name, percent: p, threshold: th, resetsAt: r }); }
          if (p < th - 5) st.fired[th] = false;
        }
      }
      st.lastPercent = p; st.lastReset = r;
    }
    this._save();
    return alerts;
  }

  // Previsão: taxa de uso (pontos/min) nos últimos ~45 min e ETA para 100% vs. reinício da janela
  forecast(id) {
    const arr = (this.data.samples[id] || []).filter((s) => Date.now() - s.t < 45 * 60000);
    if (arr.length < 2) return null;
    const first = arr[0], last = arr[arr.length - 1];
    if (last.r && first.r && last.r !== first.r) return null;             // janela reiniciou no meio
    const dtMin = (last.t - first.t) / 60000;
    if (dtMin < 3) return null;
    const rate = (last.p - first.p) / dtMin;                             // % por minuto
    if (rate <= 0.01) return { rate: 0, etaMinutes: null, exhaustsBeforeReset: false };
    const etaMinutes = (100 - last.p) / rate;
    const resetMin = last.r ? (new Date(last.r) - Date.now()) / 60000 : null;
    return { rate: Math.round(rate * 100) / 100, etaMinutes: Math.round(etaMinutes), exhaustsBeforeReset: resetMin != null ? etaMinutes < resetMin : null, resetMinutes: resetMin != null ? Math.round(resetMin) : null };
  }

  // Séries para a UI: últimas 24h (amostras) e últimos 7 dias (máximo diário)
  series(id) {
    const now = Date.now();
    const samples = (this.data.samples[id] || []).filter((s) => now - s.t < 24 * 3600 * 1000).map((s) => [s.t, s.p]);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
      const d = (this.data.daily[id] || {})[day];
      days.push({ day, max: d ? d.max : null });
    }
    return { samples, days };
  }

  _save() { try { fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch { /* ignore */ } }
}

module.exports = { History };
