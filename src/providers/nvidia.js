// NVIDIA (build.nvidia.com / NIM) — a NVIDIA não expõe API de uso/créditos; validamos a chave e
// mostramos os limites informados nos cabeçalhos de rate-limit, quando existirem.
const { result, failure, window: W } = require('./util');

const ID = 'nvidia', NAME = 'NVIDIA NIM';
const API = 'https://integrate.api.nvidia.com/v1/models';

function parse(models, headers = {}) {
  const count = Array.isArray(models && models.data) ? models.data.length : null;
  const limit = Number(headers['x-ratelimit-limit'] || headers['ratelimit-limit']);
  const remaining = Number(headers['x-ratelimit-remaining'] || headers['ratelimit-remaining']);
  const windows = [];
  if (limit > 0 && !Number.isNaN(remaining)) windows.push(W('Requisições (janela atual)', (limit - remaining) / limit * 100, null, null));
  const r = result(ID, NAME, windows, { plan: count != null ? `${count} modelos disponíveis` : null });
  if (!windows.length) r.note = 'Chave válida. A NVIDIA não informa uso/créditos por API — veja em build.nvidia.com.';
  return r;
}

async function fetchUsage(settings = {}) {
  const key = (settings.apiKey || '').trim();
  if (!key) return failure(ID, NAME, 'API key não configurada', 'Gere uma chave (nvapi-…) em build.nvidia.com e cole nas configurações.');
  try {
    const res = await fetch(API, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403) return failure(ID, NAME, `Chave inválida (${res.status})`);
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
    const hdr = {}; res.headers.forEach((v, k) => { hdr[k.toLowerCase()] = v; });
    return parse(await res.json().catch(() => null), hdr);
  } catch (e) { return failure(ID, NAME, e); }
}

module.exports = { id: ID, name: NAME, fetchUsage, parse };
