// Cursor — usa o cookie de sessão do cursor.com (WorkosCursorSessionToken) colado nas configurações
const { fetchJson, window: W, result, failure } = require('./util');

const ID = 'cursor', NAME = 'Cursor';
const BASE = 'https://cursor.com';

function cookieHeader(raw) {
  raw = (raw || '').trim();
  if (!raw) return null;
  if (raw.includes('=')) return raw;                       // header completo ou "nome=valor"
  return `WorkosCursorSessionToken=${raw}`;                // só o valor
}

function parse(summary, me = {}) {
  const ind = summary.individualUsage || {};
  const plan = ind.plan || {};
  const windows = [];
  const end = summary.billingCycleEnd || null;
  let pct = plan.totalPercentUsed;
  if (pct == null && plan.limit) pct = (plan.used || 0) / plan.limit * 100;
  if (pct != null) windows.push(W('Plano (ciclo mensal)', pct, end, 43200));
  if (ind.onDemand && ind.onDemand.enabled && ind.onDemand.limit)
    windows.push(W('Uso sob demanda', (ind.onDemand.used || 0) / ind.onDemand.limit * 100, end, 43200));
  if (ind.overall && ind.overall.limit)
    windows.push(W('Limite individual', (ind.overall.used || 0) / ind.overall.limit * 100, end, 43200));
  const team = summary.teamUsage && summary.teamUsage.pooled;
  if (team && team.limit) windows.push(W('Pool do time', (team.used || 0) / team.limit * 100, end, 43200));
  const r = result(ID, NAME, windows, { account: me.email, plan: summary.membershipType });
  if (summary.isUnlimited) r.plan = (r.plan || '') + ' (ilimitado)';
  if (!windows.length) { r.primary = null; r.note = 'Sem limite informado pelo Cursor'; }
  return r;
}

async function fetchUsage(settings = {}) {
  const cookie = cookieHeader(settings.cookie);
  if (!cookie) return failure(ID, NAME, 'Cookie do Cursor não configurado', 'Faça login em cursor.com, copie o cookie WorkosCursorSessionToken (DevTools → Application → Cookies) e cole nas configurações.');
  const headers = { Cookie: cookie, Accept: 'application/json', 'User-Agent': 'SideNotch' };
  try {
    const [summary, me] = await Promise.all([
      fetchJson(`${BASE}/api/usage-summary`, { headers }),
      fetchJson(`${BASE}/api/auth/me`, { headers }).catch(() => ({}))
    ]);
    return parse(summary || {}, me || {});
  } catch (e) {
    if (e.status === 401 || e.status === 403) return failure(ID, NAME, 'Cookie inválido ou expirado', 'Copie um cookie novo do cursor.com.');
    return failure(ID, NAME, e);
  }
}

module.exports = { id: ID, name: NAME, fetchUsage, parse };
