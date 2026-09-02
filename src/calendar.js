// Calendário via links ICS (Google "endereço secreto iCal", Outlook "publicar calendário", etc.)
// Parser enxuto: VEVENT com DTSTART/DTEND/SUMMARY/LOCATION/DESCRIPTION e RRULE simples (DAILY/WEEKLY/MONTHLY/YEARLY, COUNT/UNTIL/BYDAY).
const DAY = 86400000;

function unfold(text) { return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }

function parseDate(v, params = {}) {
  // 20260902T113000Z | 20260902T113000 (local ou TZID) | 20260902 (dia inteiro)
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const allDay = !h;
  const date = allDay ? new Date(+y, +mo - 1, +d) : z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))) : new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0));
  return { date, allDay, tzid: params.TZID || null };
}

function parseICS(text) {
  const lines = unfold(text).split('\n');
  const events = []; let cur = null;
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur && cur.DTSTART) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const left = line.slice(0, i), value = line.slice(i + 1);
    const [name, ...ps] = left.split(';');
    const params = {}; for (const p of ps) { const [k, v] = p.split('='); params[k] = v; }
    const key = name.toUpperCase();
    if (key === 'DTSTART' || key === 'DTEND') cur[key] = parseDate(value, params);
    else if (key === 'RRULE') cur.RRULE = Object.fromEntries(value.split(';').map((x) => x.split('=')));
    else if (key === 'EXDATE') (cur.EXDATE = cur.EXDATE || []).push(...value.split(',').map((x) => parseDate(x, params)).filter(Boolean).map((x) => x.date.getTime()));
    else if (['SUMMARY', 'LOCATION', 'DESCRIPTION', 'UID', 'STATUS', 'URL'].includes(key)) cur[key] = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
  }
  return events;
}

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Expande recorrências dentro de [from, to]
function occurrences(ev, from, to) {
  const start = ev.DTSTART.date, end = ev.DTEND ? ev.DTEND.date : new Date(start.getTime() + (ev.DTSTART.allDay ? DAY : 3600000));
  const dur = end - start;
  const out = [];
  const push = (s) => { if (s < to && s + dur > from && !(ev.EXDATE || []).includes(s)) out.push({ start: s, end: s + dur }); };
  const r = ev.RRULE;
  if (!r) { push(start.getTime()); return out; }
  const freq = r.FREQ, interval = Number(r.INTERVAL) || 1;
  const until = r.UNTIL ? (parseDate(r.UNTIL) || {}).date : null;
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => WD[x.slice(-2)]).filter((x) => x != null) : null;
  let n = 0, i = 0;
  const limit = new Date(Math.min(to, until ? until.getTime() + DAY : Infinity));
  while (n < count && i < 1000) {
    let base;
    if (freq === 'DAILY') base = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * interval, start.getHours(), start.getMinutes());
    else if (freq === 'WEEKLY') base = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * 7 * interval, start.getHours(), start.getMinutes());
    else if (freq === 'MONTHLY') base = new Date(start.getFullYear(), start.getMonth() + i * interval, start.getDate(), start.getHours(), start.getMinutes());
    else if (freq === 'YEARLY') base = new Date(start.getFullYear() + i * interval, start.getMonth(), start.getDate(), start.getHours(), start.getMinutes());
    else { push(start.getTime()); break; }
    if (base > limit) break;
    if (freq === 'WEEKLY' && byday && byday.length) {
      const weekStart = new Date(base); weekStart.setDate(base.getDate() - base.getDay());
      for (const wd of byday) { const d = new Date(weekStart); d.setDate(weekStart.getDate() + wd); if (d >= start && (!until || d <= until) && n < count) { push(d.getTime()); n++; } }
    } else { if (!until || base <= until) { push(base.getTime()); n++; } }
    i++;
  }
  return out;
}

class Calendar {
  constructor() { this.sources = []; this.events = []; this.errors = {}; this.updatedAt = null; }

  async refresh(urls, { daysAhead = 45 } = {}) {
    const from = Date.now() - DAY, to = Date.now() + daysAhead * DAY;
    const all = []; this.errors = {};
    await Promise.all((urls || []).filter(Boolean).map(async (u, idx) => {
      try {
        const url = String(u.url || u).replace(/^webcal:/i, 'https:');
        const res = await fetch(url, { headers: { 'User-Agent': 'SideNotch' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const color = u.color || ['#60a5fa', '#22c55e', '#f59e0b', '#a78bfa', '#f472b6'][idx % 5];
        for (const ev of parseICS(text)) {
          if (ev.STATUS === 'CANCELLED') continue;
          for (const o of occurrences(ev, from, to)) all.push({ id: `${ev.UID || ev.SUMMARY}-${o.start}`, title: ev.SUMMARY || '(sem título)', start: o.start, end: o.end, allDay: !!ev.DTSTART.allDay, location: ev.LOCATION || '', description: (ev.DESCRIPTION || '').slice(0, 300), color, source: u.name || new URL(url).hostname });
        }
      } catch (e) { this.errors[u.name || u.url || u] = String(e.message || e); }
    }));
    all.sort((a, b) => a.start - b.start);
    this.events = all; this.updatedAt = Date.now();
    return this.state();
  }

  state() {
    const now = Date.now();
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = -3; i <= 4; i++) {
      const d = new Date(today0.getTime() + i * DAY), d1 = d.getTime() + DAY;
      days.push({ date: d.toISOString(), day: d.getDate(), wd: d.getDay(), isToday: i === 0, count: this.events.filter((e) => e.start < d1 && e.end > d.getTime()).length });
    }
    const todayEv = this.events.filter((e) => e.start < today0.getTime() + DAY && e.end > today0.getTime());
    const next = this.events.find((e) => e.start > now && !e.allDay) || null;
    return { updatedAt: this.updatedAt, errors: this.errors, days, today: todayEv, next, upcoming: this.events.filter((e) => e.end > now).slice(0, 30) };
  }
}

module.exports = { Calendar, parseICS, occurrences, parseDate };
