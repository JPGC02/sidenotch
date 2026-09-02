// Testes dos parsers com payloads reais (formatos documentados pelo Claude Code, Codex CLI, CodexBar)
const assert = require('assert');
const claude = require('../src/providers/claude');
const codex = require('../src/providers/codex');
const cursor = require('../src/providers/cursor');
const gemini = require('../src/providers/gemini');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('claude parse', () => {
  const r = claude.parse({
    five_hour: { utilization: 18.0, resets_at: '2030-01-01T05:00:00Z' },
    seven_day: { utilization: 42.0, resets_at: '2030-01-04T00:00:00+00:00' },
    seven_day_opus: { utilization: 7.5, resets_at: '2030-01-04T00:00:00Z' }
  }, { email: 'a@b.com', org: 'Max' });
  assert.equal(r.ok, true); assert.equal(r.primary.usedPercent, 18); assert.equal(r.windows.length, 3);
  assert.equal(r.windows[1].usedPercent, 42); assert.equal(r.account, 'a@b.com');
  assert.equal(claude.parse({}).primary, null);
});

t('codex parse', () => {
  const r = codex.parse({
    plan_type: 'plus',
    rate_limit: { primary_window: { used_percent: 40, reset_at: 1900000000, limit_window_seconds: 18000 },
                  secondary_window: { used_percent: 80, reset_at: 1900500000, limit_window_seconds: 604800 } },
    credits: { has_credits: true, balance: '12.5' }
  }, { email: 'x@y.com' });
  assert.equal(r.primary.usedPercent, 40); assert.equal(r.windows[0].label, 'Sessão (5h)');
  assert.equal(r.windows[1].usedPercent, 80); assert.equal(r.credits, 12.5); assert.equal(r.plan, 'plus');
  assert.equal(new Date(r.windows[0].resetsAt).getTime(), 1900000000 * 1000);
});

t('cursor parse', () => {
  const r = cursor.parse({
    billingCycleEnd: '2030-02-01T00:00:00Z', membershipType: 'pro',
    individualUsage: { plan: { enabled: true, used: 1200, limit: 2000, totalPercentUsed: 60 },
                       onDemand: { enabled: true, used: 500, limit: 1000 } }
  }, { email: 'c@d.com' });
  assert.equal(r.primary.usedPercent, 60); assert.equal(r.windows[1].usedPercent, 50); assert.equal(r.plan, 'pro');
  assert.equal(cursor.parse({ individualUsage: { plan: { used: 50, limit: 200 } } }).primary.usedPercent, 25);
});

t('gemini parse', () => {
  const r = gemini.parse({ buckets: [
    { modelId: 'gemini-2.5-flash', remainingFraction: 0.9, resetTime: '2030-01-01T00:00:00Z', tokenType: 'INPUT' },
    { modelId: 'gemini-2.5-pro', remainingFraction: 0.35, resetTime: '2030-01-01T00:00:00Z' },
    { modelId: 'gemini-2.5-pro', remainingFraction: 0.6, resetTime: '2030-01-01T00:00:00Z' }
  ] }, { email: 'g@h.com', tier: 'free' });
  assert.equal(r.primary.label, 'gemini-2.5-pro'); assert.equal(r.primary.usedPercent, 65); assert.equal(r.windows.length, 2);
});

t('openrouter parse', () => {
  const r = require('../src/providers/openrouter').parse({ data: { label: 'k1', usage: 2.5, limit: 10, is_free_tier: false } }, { data: { total_credits: 20, total_usage: 5 } });
  assert.equal(r.primary.usedPercent, 25); assert.equal(r.windows[1].usedPercent, 25); assert.equal(r.credits, 15);
  assert.ok(require('../src/providers/openrouter').parse({ data: { usage: 1 } }, null).note);
});

t('nvidia parse', () => {
  const nv = require('../src/providers/nvidia');
  const r = nv.parse({ data: [{ id: 'a' }, { id: 'b' }] }, { 'x-ratelimit-limit': '40', 'x-ratelimit-remaining': '30' });
  assert.equal(r.primary.usedPercent, 25); assert.equal(r.plan, '2 modelos disponíveis');
  assert.ok(nv.parse({ data: [] }, {}).note);
});

t('antigravity parse', () => {
  const r = require('../src/providers/antigravity').parse({ userStatus: { email: 'a@g.com', planStatus: { planInfo: { planDisplayName: 'Pro' } }, cascadeModelConfigData: { clientModelConfigs: [
    { label: 'Gemini 3 Pro', modelOrAlias: { model: 'g3' }, quotaInfo: { remainingFraction: 0.4, resetTime: '2030-01-01T00:00:00Z' } },
    { label: 'Claude', modelOrAlias: { model: 'c' }, quotaInfo: { remainingFraction: 0.9 } },
    { label: 'Gemini 3 Pro', modelOrAlias: { model: 'g3' }, quotaInfo: { remainingFraction: 0.7 } } ] } } });
  assert.equal(r.primary.label, 'Gemini 3 Pro'); assert.equal(r.primary.usedPercent, 60); assert.equal(r.windows.length, 2); assert.equal(r.plan, 'Pro');
});

t('opencode aggregate', () => {
  const oc = require('../src/providers/opencode');
  const now = Date.now();
  const acc = oc.aggregate([
    { role: 'assistant', tokens: { input: 1000, output: 500, cache: { read: 200, write: 0 } }, cost: 0.12, time: { created: now }, modelID: 'gpt-5' },
    { role: 'user', tokens: { input: 99999 }, cost: 99 },
    { role: 'assistant', tokens: { input: 10 }, cost: 0.5, time: { created: now - 3 * 86400000 }, modelID: 'claude' }
  ], now);
  assert.equal(acc.today.tokens, 1700); assert.equal(acc.today.cost, 0.12); assert.equal(acc.today.msgs, 1);
  const r = oc.toResult(acc); assert.equal(r.ok, true); assert.equal(r.primary, null); assert.equal(r.stats.label, '$0.12'); assert.ok(r.stats.lines[0].includes('Hoje'));
});

t('failures never throw', async () => {
  const r = await cursor.fetchUsage({ cookie: '' });
  assert.equal(r.ok, false); assert.ok(r.hint);
});

console.log(`\n${n} testes OK`);

// cache + backoff em 429 (index.js)
(async () => {
  const idx = require('../src/providers');
  let calls = 0, mode = 'ok';
  idx.providers.claude.fetchUsage = async () => { calls++; return mode === 'ok' ? claude.parse({ five_hour: { utilization: 10, resets_at: '2030-01-01T00:00:00Z' } }) : { id: 'claude', name: 'Claude', ok: false, error: '429', status: 429 }; };
  const s = { order: ['claude'], providers: { claude: { enabled: true } } };
  let [r] = await idx.fetchAll(s); assert.equal(r.ok, true); assert.equal(calls, 1);
  [r] = await idx.fetchAll(s); assert.equal(calls, 1, 'dentro de 1 min usa cache'); assert.equal(r.stale, true);
  [r] = await idx.fetchAll(s, { force: true }); assert.equal(calls, 2, 'force refaz se não houve 429');
  mode = '429';
  [r] = await idx.fetchAll(s); assert.equal(calls, 2, 'dentro de 1 min ainda usa cache');
  idx.resetCache(); mode = 'ok'; [r] = await idx.fetchAll(s); assert.equal(calls, 3);
  mode = '429'; idx.resetCache.__keepLast = true;
  // simula passagem do minuto: força uma nova chamada que devolve 429
  [r] = await idx.fetchAll(s, { force: true }); assert.equal(calls, 4);
  assert.equal(r.ok, true, 'mantém último valor bom'); assert.equal(r.stale, true); assert.match(r.staleReason, /429/);
  [r] = await idx.fetchAll(s, { force: true }); assert.equal(calls, 4, 'em backoff, nem o force chama de novo');
  idx.resetCache(); [r] = await idx.fetchAll(s); assert.equal(r.ok, false, 'sem valor bom anterior mostra o erro');
})().then(() => console.log('✓ cache/backoff')).catch((e) => { console.error(e); process.exit(1); });
