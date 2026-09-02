// OpenAI Codex / ChatGPT — lê ~/.codex/auth.json e consulta o mesmo endpoint usado pelo Codex CLI (/status)
const path = require('path');
const { readJson, home, decodeJwt, fetchJson, window: W, result, failure } = require('./util');

const ID = 'codex', NAME = 'Codex';
const API = 'https://chatgpt.com/backend-api/wham/usage';

function codexDir() { return process.env.CODEX_HOME || home('.codex'); }

function auth() {
  const a = readJson(path.join(codexDir(), 'auth.json'));
  if (!a || !a.tokens || !a.tokens.access_token) return null;
  const claims = decodeJwt(a.tokens.access_token) || {};
  const oa = claims['https://api.openai.com/auth'] || {};
  return {
    token: a.tokens.access_token,
    accountId: a.tokens.account_id || oa.chatgpt_account_id || null,
    email: claims.email || (claims['https://api.openai.com/profile'] || {}).email || null,
    plan: oa.chatgpt_plan_type || null
  };
}

const secToDate = (s) => (s ? new Date(s * 1000).toISOString() : null);

function parse(data, info = {}) {
  const rl = data.rate_limit || {};
  const p = rl.primary_window, s = rl.secondary_window;
  const windows = [
    p ? W(`Sessão (${Math.round((p.limit_window_seconds || 18000) / 3600)}h)`, p.used_percent, secToDate(p.reset_at), (p.limit_window_seconds || 0) / 60) : null,
    s ? W('Limite semanal', s.used_percent, secToDate(s.reset_at), (s.limit_window_seconds || 0) / 60) : null
  ];
  for (const extra of data.additional_rate_limits || []) {
    const ep = extra.rate_limit && extra.rate_limit.primary_window;
    if (ep) windows.push(W(extra.limit_name || extra.metered_feature || 'Limite extra', ep.used_percent, secToDate(ep.reset_at), (ep.limit_window_seconds || 0) / 60));
  }
  const credits = data.credits && data.credits.balance != null ? Number(data.credits.balance) : null;
  return result(ID, NAME, windows, { account: info.email, plan: data.plan_type || info.plan, credits });
}

async function fetchUsage() {
  const a = auth();
  if (!a) return failure(ID, NAME, 'Codex CLI não está logado', 'Instale o Codex CLI (npm i -g @openai/codex) e rode "codex login".');
  try {
    const headers = { Authorization: `Bearer ${a.token}`, Accept: 'application/json', 'User-Agent': 'SideNotch' };
    if (a.accountId) headers['ChatGPT-Account-Id'] = a.accountId;
    const data = await fetchJson(API, { headers });
    return parse(data || {}, a);
  } catch (e) {
    if (e.status === 401 || e.status === 403) return failure(ID, NAME, `Não autorizado (${e.status})`, 'Rode "codex login" novamente.');
    return failure(ID, NAME, e);
  }
}

module.exports = { id: ID, name: NAME, fetchUsage, parse };
