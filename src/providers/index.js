const providers = {
  claude: require('./claude'),
  codex: require('./codex'),
  cursor: require('./cursor'),
  gemini: require('./gemini'),
  antigravity: require('./antigravity'),
  openrouter: require('./openrouter'),
  nvidia: require('./nvidia'),
  opencode: require('./opencode')
};

// Estado por provedor: último resultado bom, próximo horário permitido e contagem de 429s
const state = {};
const MIN_INTERVAL_MS = 60 * 1000;          // mesmo clicando no anel, não consulta o mesmo provedor 2x em 1 min
const BACKOFF_BASE_MS = 3 * 60 * 1000;      // 429: 3 → 6 → 12 → 15 min (máx.)
const BACKOFF_MAX_MS = 15 * 60 * 1000;

function withStale(r, last, note) {
  // mantém o último valor bom visível, marcando que está desatualizado
  if (!last) return r;
  return { ...last, stale: true, staleReason: note || r.error, staleHint: r.hint || null, nextTryAt: state[r.id].nextAt ? new Date(state[r.id].nextAt).toISOString() : null };
}

async function fetchOne(id, settings, force) {
  const p = providers[id];
  const st = state[id] || (state[id] = { last: null, nextAt: 0, fails: 0 });
  const now = Date.now();
  if (now < st.nextAt && !(force && st.fails === 0)) {
    const r = st.last ? { ...st.last, stale: true, staleReason: st.fails ? 'aguardando limite de requisições' : 'cache', nextTryAt: new Date(st.nextAt).toISOString() } : st.lastFail;
    if (r) return r;
  }
  let r;
  try { r = await p.fetchUsage(settings.providers[id]); }
  catch (e) { r = { id, name: p.name, ok: false, error: String(e), updatedAt: new Date().toISOString() }; }
  if (r.ok) {
    st.last = r; st.fails = 0; st.nextAt = now + MIN_INTERVAL_MS;
    return r;
  }
  st.lastFail = r;
  if (r.status === 429) {
    st.fails++;
    const wait = r.retryAfter ? r.retryAfter * 1000 : Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (st.fails - 1));
    st.nextAt = now + wait;
    return withStale(r, st.last, `limite de requisições (429) — nova tentativa em ${Math.round(wait / 60000)} min`);
  }
  st.nextAt = now + MIN_INTERVAL_MS;
  return withStale(r, st.last);
}

// Busca todos os provedores habilitados em paralelo; nunca lança
async function fetchAll(settings, { force = false } = {}) {
  const order = settings.order || Object.keys(providers);
  const ids = order.filter((id) => providers[id] && settings.providers[id] && settings.providers[id].enabled);
  return Promise.all(ids.map((id) => fetchOne(id, settings, force)));
}

function resetCache() { for (const k of Object.keys(state)) delete state[k]; }

module.exports = { providers, fetchAll, resetCache };
