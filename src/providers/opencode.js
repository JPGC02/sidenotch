// OpenCode CLI — uso local lido dos arquivos de mensagem em ~/.local/share/opencode/storage/message/*/*.json
// (cada mensagem do assistente traz tokens e custo). Sem conta/API: mostra custo e tokens de hoje e do mês.
const fs = require('fs');
const path = require('path');
const { home, result, failure } = require('./util');

const ID = 'opencode', NAME = 'OpenCode';

function storageDirs() {
  const dirs = [home('.local', 'share', 'opencode', 'storage', 'message')];
  if (process.env.XDG_DATA_HOME) dirs.unshift(path.join(process.env.XDG_DATA_HOME, 'opencode', 'storage', 'message'));
  if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'opencode', 'storage', 'message'));
  return dirs.filter((d) => fs.existsSync(d));
}

// Agrega mensagens: [{ role, tokens:{input,output,reasoning,cache:{read,write}}, cost, time:{created}, modelID }]
function aggregate(messages, now = Date.now()) {
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
  const today = dayKey(now), month = today.slice(0, 7);
  const acc = { today: { cost: 0, tokens: 0, msgs: 0 }, month: { cost: 0, tokens: 0, msgs: 0 }, models: {}, days: {} };
  for (const m of messages) {
    if (!m || m.role !== 'assistant') continue;
    const t = (m.time && (m.time.completed || m.time.created)) || 0;
    const k = dayKey(t);
    const tok = m.tokens || {};
    const total = (tok.input || 0) + (tok.output || 0) + (tok.reasoning || 0) + ((tok.cache && (tok.cache.read || 0) + (tok.cache.write || 0)) || 0);
    const cost = Number(m.cost) || 0;
    if (k === today) { acc.today.cost += cost; acc.today.tokens += total; acc.today.msgs++; }
    if (k.startsWith(month)) { acc.month.cost += cost; acc.month.tokens += total; acc.month.msgs++; }
    acc.days[k] = acc.days[k] || { cost: 0, tokens: 0 }; acc.days[k].cost += cost; acc.days[k].tokens += total;
    if (m.modelID) { const mm = acc.models[m.modelID] || (acc.models[m.modelID] = { cost: 0, tokens: 0 }); mm.cost += cost; mm.tokens += total; }
  }
  return acc;
}

function readMessages(maxAgeDays = 31) {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const out = [];
  for (const dir of storageDirs()) {
    let sessions = [];
    try { sessions = fs.readdirSync(dir); } catch { continue; }
    for (const s of sessions) {
      const sd = path.join(dir, s);
      let st; try { st = fs.statSync(sd); } catch { continue; }
      if (!st.isDirectory() || st.mtimeMs < cutoff) continue;
      let files = []; try { files = fs.readdirSync(sd); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const fp = path.join(sd, f);
        try { if (fs.statSync(fp).mtimeMs < cutoff) continue; out.push(JSON.parse(fs.readFileSync(fp, 'utf8'))); } catch { /* ignora */ }
      }
    }
  }
  return out;
}

const fmtUsd = (v) => `$${v.toFixed(v < 10 ? 2 : 1)}`;
const fmtTok = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

function toResult(acc) {
  const r = result(ID, NAME, [], {});
  r.stats = {
    label: fmtUsd(acc.today.cost),
    lines: [
      `Hoje: ${fmtUsd(acc.today.cost)} · ${fmtTok(acc.today.tokens)} tokens · ${acc.today.msgs} respostas`,
      `Mês: ${fmtUsd(acc.month.cost)} · ${fmtTok(acc.month.tokens)} tokens`,
      ...Object.entries(acc.models).sort((a, b) => b[1].cost - a[1].cost).slice(0, 4).map(([m, v]) => `${m}: ${fmtUsd(v.cost)}`)
    ],
    days: Object.entries(acc.days).sort().slice(-7).map(([d, v]) => ({ day: d, cost: Math.round(v.cost * 100) / 100 }))
  };
  r.note = 'Uso local (sem cota): custo estimado pelo próprio OpenCode.';
  return r;
}

async function fetchUsage() {
  if (!storageDirs().length) return failure(ID, NAME, 'OpenCode não encontrado', 'Instale o OpenCode CLI e use pelo menos uma vez (os dados ficam em ~/.local/share/opencode).');
  try { return toResult(aggregate(readMessages())); } catch (e) { return failure(ID, NAME, e); }
}

module.exports = { id: ID, name: NAME, fetchUsage, aggregate, toResult };
