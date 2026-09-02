// Claude (Claude Code / claude.ai) — usa o mesmo endpoint do comando /usage do Claude Code
const path = require('path');
const { execSync } = require('child_process');
const { readJson, home, fetchJson, window: W, result, failure } = require('./util');

// User-Agent precisa ser "claude-code/<versão>"; sem isso o endpoint responde 429 direto.
let UA = null;
function userAgent() {
  if (UA) return UA;
  let v = null;
  try { v = (execSync('claude --version', { encoding: 'utf8', windowsHide: true, timeout: 8000 }).match(/\d+\.\d+\.\d+/) || [])[0]; } catch { /* CLI ausente */ }
  if (!v) { const cfg = readJson(home('.claude.json')); v = cfg && (cfg.lastReleaseNotesSeen || cfg.lastOnboardingVersion) || null; }
  UA = `claude-code/${v || '2.1.80'}`;
  return UA;
}

const ID = 'claude', NAME = 'Claude';
const API = 'https://api.anthropic.com/api/oauth/usage';

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || home('.claude');
}

function localToken() {
  const creds = readJson(path.join(claudeDir(), '.credentials.json'));
  const oauth = creds && creds.claudeAiOauth;
  if (!oauth || !oauth.accessToken) return null;
  if (oauth.expiresAt && Date.now() > oauth.expiresAt) return { expired: true };
  return { token: oauth.accessToken };
}

function localAccount() {
  const cfg = readJson(home('.claude.json')) || readJson(path.join(claudeDir(), '.claude.json'));
  const acc = cfg && cfg.oauthAccount;
  return acc ? { email: acc.emailAddress, org: acc.organizationName } : null;
}

// Converte a resposta do endpoint em janelas padronizadas (exportado para testes)
function parse(data, account) {
  const w = (key, label, minutes) => {
    const x = data[key];
    return x && x.utilization != null ? W(label, x.utilization, x.resets_at, minutes) : null;
  };
  return result(ID, NAME, [
    w('five_hour', 'Sessão atual (5h)', 300),
    w('seven_day', 'Limite semanal', 10080),
    w('seven_day_opus', 'Opus (semanal)', 10080),
    w('seven_day_sonnet', 'Sonnet (semanal)', 10080)
  ], { account: account && account.email, plan: account && account.org });
}

async function fetchUsage(settings = {}) {
  let token = (settings.token || '').trim();
  if (!token) {
    const t = localToken();
    if (!t) return failure(ID, NAME, 'Claude Code não está logado', 'Instale o Claude Code e rode "claude login", ou cole um token OAuth nas configurações.');
    if (t.expired) return failure(ID, NAME, 'Token expirado', 'Abra o Claude Code (ele renova o token automaticamente).');
    token = t.token;
  }
  try {
    const data = await fetchJson(API, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': userAgent(),
        'Content-Type': 'application/json'
      }
    });
    return parse(data || {}, localAccount());
  } catch (e) {
    if (e.status === 401) return failure(ID, NAME, 'Não autorizado (401)', 'Rode "claude login" novamente.');
    if (e.status === 429) return failure(ID, NAME, 'Limite de requisições (429)', 'A Anthropic limita este endpoint por token; o app vai esperar e tentar de novo sozinho (mostrando o último valor conhecido).');
    return failure(ID, NAME, e);
  }
}

module.exports = { id: ID, name: NAME, fetchUsage, parse };
