// Clima via Open-Meteo (sem chave). Localização: lat/lon das configurações ou geolocalização por IP.
const CODES = { 0: ['☀️', 'Céu limpo'], 1: ['🌤️', 'Quase limpo'], 2: ['⛅', 'Parcialmente nublado'], 3: ['☁️', 'Nublado'], 45: ['🌫️', 'Névoa'], 48: ['🌫️', 'Névoa'],
  51: ['🌦️', 'Garoa'], 53: ['🌦️', 'Garoa'], 55: ['🌧️', 'Garoa forte'], 61: ['🌧️', 'Chuva fraca'], 63: ['🌧️', 'Chuva'], 65: ['🌧️', 'Chuva forte'], 66: ['🌧️', 'Chuva gelada'], 67: ['🌧️', 'Chuva gelada'],
  71: ['🌨️', 'Neve'], 73: ['🌨️', 'Neve'], 75: ['❄️', 'Neve forte'], 77: ['🌨️', 'Neve'], 80: ['🌦️', 'Pancadas'], 81: ['🌧️', 'Pancadas'], 82: ['⛈️', 'Pancadas fortes'], 85: ['🌨️', 'Neve'], 86: ['🌨️', 'Neve'],
  95: ['⛈️', 'Trovoada'], 96: ['⛈️', 'Trovoada com granizo'], 99: ['⛈️', 'Trovoada com granizo'] };

class Weather {
  constructor() { this.state = null; this.loc = null; this.error = null; }

  async locate(cfg = {}) {
    if (cfg.lat != null && cfg.lon != null && cfg.lat !== '' && cfg.lon !== '') { this.loc = { lat: Number(cfg.lat), lon: Number(cfg.lon), label: cfg.label || '' }; return this.loc; }
    if (this.loc) return this.loc;
    for (const url of ['https://ipapi.co/json/', 'http://ip-api.com/json/?fields=lat,lon,city']) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'SideNotch' } }); if (!r.ok) continue;
        const j = await r.json();
        const lat = j.latitude ?? j.lat, lon = j.longitude ?? j.lon;
        if (lat != null && lon != null) { this.loc = { lat: Number(lat), lon: Number(lon), label: j.city || '' }; return this.loc; }
      } catch { /* tenta o próximo */ }
    }
    return null;
  }

  async refresh(cfg = {}) {
    try {
      const loc = await this.locate(cfg);
      if (!loc) throw new Error('sem localização');
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3`;
      const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const c = j.current || {}, d = j.daily || {};
      const [icon, desc] = CODES[c.weather_code] || ['🌡️', ''];
      this.state = {
        temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), humidity: c.relative_humidity_2m, wind: Math.round(c.wind_speed_10m), code: c.weather_code,
        icon: c.is_day === 0 && c.weather_code <= 1 ? '🌙' : icon, desc, label: loc.label,
        min: d.temperature_2m_min ? Math.round(d.temperature_2m_min[0]) : null, max: d.temperature_2m_max ? Math.round(d.temperature_2m_max[0]) : null,
        days: (d.time || []).map((t, i) => ({ date: t, min: Math.round(d.temperature_2m_min[i]), max: Math.round(d.temperature_2m_max[i]), icon: (CODES[d.weather_code[i]] || ['🌡️'])[0] })),
        updatedAt: Date.now()
      };
      this.error = null;
    } catch (e) { this.error = String(e.message || e); }
    return this.snapshot();
  }

  snapshot() { return { ...(this.state || {}), error: this.error, ok: !!this.state }; }
}

module.exports = { Weather, CODES };
