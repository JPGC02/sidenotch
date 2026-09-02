// OpenRouter — API key → créditos e limite da chave (endpoints oficiais)
const { fetchJson, window: W, result, failure } = require('./util');

const ID = 'openrouter', NAME = 'OpenRouter';

function parse(key, credits) {
  const k = (key && key.data) || {};
  const c = (credits && credits.data) || {};
  const windows = [];
  if (k.limit != null && k.limit > 0) windows.push(W('Limite da chave', (k.usage || 0) / k.limit * 100, k.limit_reset || null, null));
  if (c.total_credits != null && c.total_credits > 0) windows.push(W('Créditos usados', (c.total_usage || 0) / c.total_credits * 100, null, null));
  const r = result(ID, NAME, windows, { account: k.label || null, plan: k.is_free_tier ? 'free tier' : null, credits: c.total_credits != null ? Math.round((c.total_credits - (c.total_usage || 0)) * 100) / 100 : null });
  if (!windows.length) r.note = `Chave sem limite definido · gasto: $${(k.usage || 0).toFixed(2)}`;
  return r;
}

async function fetchUsage(settings = {}) {
  const key = (settings.apiKey || '').trim();
  if (!key) return failure(ID, NAME, 'API key não configurada', 'Crie uma chave em openrouter.ai/keys e cole nas configurações.');
  const headers = { Authorization: `Bearer ${key}` };
  try {
    const [k, c] = await Promise.all([
      fetchJson('https://openrouter.ai/api/v1/auth/key', { headers }),
      fetchJson('https://openrouter.ai/api/v1/credits', { headers }).catch(() => null)
    ]);
    return parse(k, c);
  } catch (e) {
    if (e.status === 401) return failure(ID, NAME, 'API key inválida (401)');
    return failure(ID, NAME, e);
  }
}

module.exports = { id: ID, name: NAME, fetchUsage, parse };
