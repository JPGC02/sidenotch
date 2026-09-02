// Integração com o Claude Code via hooks HTTP.
//  - /hooks/permission-request : PermissionRequest → seguramos a resposta até o usuário decidir na barra
//  - /hooks/event               : Stop, Notification, SessionStart/End, UserPromptSubmit, PermissionDenied
//                                 → estado das sessões + feed de notificações (respondemos {} na hora)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const HOOK_PATH = '/hooks/permission-request';
const EVENT_PATH = '/hooks/event';
const EVENT_HOOKS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'Notification', 'PermissionDenied', 'StopFailure'];
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;      // sessões sem eventos há 6h somem da lista

class ApprovalServer extends EventEmitter {
  constructor({ onChange } = {}) {
    super();
    if (onChange) this.on('change', onChange);
    this.pending = new Map();         // id -> { input, res, timer, ... }
    this.sessions = new Map();        // session_id -> estado
    this.feed = [];                   // notificações (mais recentes primeiro)
    this.history = [];                // decisões
    this.server = null;
    this.port = null; this.token = null; this.timeoutSec = 110; this.seq = 0; this.lastError = null;
  }

  start({ port, token, timeoutSec }) {
    this.stop();
    this.port = port; this.token = token; this.timeoutSec = timeoutSec || 110;
    this.server = http.createServer((req, res) => this._handle(req, res));
    this.server.on('error', (e) => { this.lastError = String(e.message || e); this.emit('change'); });
    this.server.listen(port, '127.0.0.1', () => { this.lastError = null; this.emit('change'); });
  }

  stop() {
    for (const p of this.pending.values()) this._respond(p, {});
    this.pending.clear();
    if (this.server) { try { this.server.close(); } catch { /* ignore */ } this.server = null; }
  }

  get running() { return !!(this.server && this.server.listening); }

  // ---------- pedidos pendentes ----------
  list() {
    return [...this.pending.values()].map((p) => ({
      id: p.id, receivedAt: p.receivedAt, expiresAt: p.expiresAt,
      toolName: p.input.tool_name, toolInput: p.input.tool_input || {},
      cwd: p.input.cwd || '', sessionId: p.input.session_id || '',
      project: projectName(p.input.cwd), sessionLabel: this._label(p.input.session_id, p.input.cwd),
      summary: summarize(p.input.tool_name, p.input.tool_input || {}),
      kind: kindOf(p.input.tool_name),
      questions: p.input.tool_name === 'AskUserQuestion' ? (p.input.tool_input && p.input.tool_input.questions) || [] : null,
      canAlways: Array.isArray(p.input.permission_suggestions) && p.input.permission_suggestions.length > 0,
      alwaysLabel: alwaysLabel(p.input.permission_suggestions)
    }));
  }

  // decision: 'allow' | 'always' | 'allow-auto' | 'deny' | 'skip'
  // extra.answers (AskUserQuestion) | extra.message (texto livre para o Claude, usado no deny)
  decide(id, decision, extra = {}) {
    const p = this.pending.get(id);
    if (!p) return false;
    const tool = p.input.tool_name, input = p.input.tool_input || {};
    let body = {};
    if (decision === 'allow' || decision === 'always' || decision === 'allow-auto') {
      const d = { behavior: 'allow' };
      if (tool === 'ExitPlanMode') d.updatedInput = { ...input };
      if (tool === 'AskUserQuestion') d.updatedInput = { ...input, answers: extra.answers || {} };
      if (decision === 'always' && Array.isArray(p.input.permission_suggestions) && p.input.permission_suggestions.length)
        d.updatedPermissions = [p.input.permission_suggestions[0]];
      if (decision === 'allow-auto') d.updatedPermissions = [{ type: 'setMode', mode: 'auto', destination: 'session' }];
      body = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } };
    } else if (decision === 'deny') {
      body = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: extra.message || 'Negado pelo usuário no SideNotch.' } } };
    }
    const delivered = this._respond(p, body);
    this._log({ id, tool, decision, delivered, summary: summarize(tool, input), project: projectName(p.input.cwd), at: new Date().toISOString() });
    this.pending.delete(id);
    this._touch(p.input, { status: 'running' });
    this.emit('change');
    return true;
  }

  _log(entry) { this.history.unshift(entry); this.history.length = Math.min(this.history.length, 50); }

  // ---------- sessões ----------
  listSessions() {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (now - new Date(s.lastEventAt).getTime() > SESSION_TTL_MS || (s.status === 'ended' && now - new Date(s.lastEventAt).getTime() > 60000)) this.sessions.delete(id);
    return [...this.sessions.values()].sort((a, b) => new Date(b.lastEventAt) - new Date(a.lastEventAt));
  }

  _label(sessionId, cwd) {
    const s = this.sessions.get(sessionId);
    return (s && (s.title || s.project)) || projectName(cwd) || (sessionId || '').slice(0, 8);
  }

  _touch(input, patch = {}) {
    const id = input.session_id; if (!id) return null;
    const cur = this.sessions.get(id) || { id, project: projectName(input.cwd), cwd: input.cwd || '', startedAt: new Date().toISOString(), status: 'running', model: null, title: null, mode: null, lastMessage: '', color: colorFor(id) };
    Object.assign(cur, patch, { lastEventAt: new Date().toISOString() });
    if (input.cwd) { cur.cwd = input.cwd; cur.project = projectName(input.cwd); }
    if (input.permission_mode) cur.mode = input.permission_mode;
    this.sessions.set(id, cur);
    return cur;
  }

  _notify(entry) {
    const n = { id: `n${Date.now().toString(36)}${++this.seq}`, at: new Date().toISOString(), ...entry };
    this.feed.unshift(n); this.feed.length = Math.min(this.feed.length, 40);
    this.emit('notify', n);
    return n;
  }

  dismiss(id) { this.feed = this.feed.filter((n) => n.id !== id); this.emit('change'); }
  clearFeed() { this.feed = []; this.emit('change'); }

  _event(input) {
    const ev = input.hook_event_name;
    switch (ev) {
      case 'SessionStart':
        this._touch(input, { status: 'idle', model: input.model || null, title: input.session_title || null, source: input.source || null });
        break;
      case 'SessionEnd':
        this._touch(input, { status: 'ended' });
        break;
      case 'UserPromptSubmit':
        this._touch(input, { status: 'running', lastPrompt: String(input.prompt || '').slice(0, 200) });
        break;
      case 'Stop': {
        const s = this._touch(input, { status: 'idle', lastMessage: String(input.last_assistant_message || '').slice(0, 300) });
        if (!input.stop_hook_active) this._notify({ type: 'done', sessionId: input.session_id, project: s && s.project, title: `${(s && (s.title || s.project)) || 'Claude'} terminou`, text: String(input.last_assistant_message || '').slice(0, 220) });
        break;
      }
      case 'StopFailure': {
        const s = this._touch(input, { status: 'error' });
        this._notify({ type: 'error', sessionId: input.session_id, project: s && s.project, title: `${(s && (s.title || s.project)) || 'Claude'}: erro`, text: String(input.last_assistant_message || input.error || '').slice(0, 220) });
        break;
      }
      case 'Notification': {
        const t = input.notification_type;
        const s = this._touch(input, ['permission_prompt', 'idle_prompt', 'agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog'].includes(t) ? { status: 'waiting' } : {});
        const label = (s && (s.title || s.project)) || 'Claude';
        if (t === 'idle_prompt' || t === 'agent_needs_input') this._notify({ type: 'waiting', sessionId: input.session_id, project: s && s.project, title: `${label} está esperando você`, text: input.message || '' });
        else if (t && t.startsWith('quota_auto_resume')) this._notify({ type: 'limit', sessionId: input.session_id, project: s && s.project, title: `${label}: limite de uso`, text: input.message || t });
        else if (t === 'elicitation_dialog' || t === 'elicitation_url_dialog') this._notify({ type: 'waiting', sessionId: input.session_id, project: s && s.project, title: `${label} precisa de você (MCP)`, text: input.message || '' });
        break;
      }
      case 'PermissionDenied': {
        const s = this._touch(input, {});
        this._notify({ type: 'denied', sessionId: input.session_id, project: s && s.project, title: `Auto mode negou: ${input.tool_name}`, text: `${summarize(input.tool_name, input.tool_input || {})}${input.reason ? ' — ' + input.reason : ''}`.slice(0, 220) });
        break;
      }
      default: break;
    }
    this.emit('change');
  }

  // ---------- HTTP ----------
  _handle(req, res) {
    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    if (this.token && req.headers['x-sidenotch-token'] !== this.token) { res.writeHead(401); return res.end(); }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4e6) req.destroy(); });
    req.on('end', () => {
      let input = {};
      try { input = JSON.parse(raw || '{}'); } catch { res.writeHead(400); return res.end(); }
      const url = (req.url || '').split('?')[0];
      const ok = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); };
      if (url === EVENT_PATH) { ok(); try { this._event(input); } catch (e) { this.lastError = String(e); } return; }
      if (url !== HOOK_PATH || input.hook_event_name !== 'PermissionRequest') return ok();
      const id = `${Date.now().toString(36)}-${++this.seq}`;
      const p = { id, input, res, receivedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + this.timeoutSec * 1000).toISOString() };
      p.timer = setTimeout(() => { this._respond(p, {}); this._log({ id, tool: input.tool_name, decision: 'timeout', delivered: true, summary: summarize(input.tool_name, input.tool_input || {}), at: new Date().toISOString() }); this.pending.delete(id); this.emit('change'); }, this.timeoutSec * 1000);
      res.on('close', () => { if (this.pending.has(id)) { clearTimeout(p.timer); this.pending.delete(id); this.emit('change'); } });
      this.pending.set(id, p);
      this._touch(input, { status: 'waiting' });
      this.emit('change');
      this.emit('pending', this.list().find((x) => x.id === id));
    });
  }

  _respond(p, body) {
    clearTimeout(p.timer);
    if (p.res.writableEnded || p.res.destroyed) return false;
    try { p.res.writeHead(200, { 'Content-Type': 'application/json' }); p.res.end(JSON.stringify(body)); return true; } catch { return false; }
  }
}

function projectName(cwd) { return String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || ''; }
function colorFor(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 70% 55%)`; }

function kindOf(tool) {
  if (tool === 'ExitPlanMode') return 'plan';
  if (tool === 'AskUserQuestion') return 'question';
  return 'permission';
}

function summarize(tool, input) {
  switch (tool) {
    case 'Bash': case 'PowerShell': return input.command || input.description || '';
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return input.file_path || input.notebook_path || '';
    case 'Read': case 'Glob': case 'Grep': return input.file_path || input.pattern || input.path || '';
    case 'WebFetch': case 'WebSearch': return input.url || input.query || '';
    case 'ExitPlanMode': {
      const m = /^#+\s*(.+)$/m.exec(input.plan || '');
      return m ? m[1].trim() : (input.plan || '').slice(0, 160) || 'Plano pronto';
    }
    case 'AskUserQuestion': return ((input.questions || []).map((q) => q.question).join(' · ')).slice(0, 200);
    default: {
      const s = JSON.stringify(input || {});
      return s.length > 160 ? s.slice(0, 157) + '…' : s;
    }
  }
}

function alwaysLabel(suggestions) {
  const s = Array.isArray(suggestions) && suggestions[0];
  if (!s) return null;
  if (s.type === 'addRules' && s.rules && s.rules[0]) return s.rules[0].ruleContent ? `Sempre: ${s.rules[0].toolName}(${s.rules[0].ruleContent})` : `Sempre permitir ${s.rules[0].toolName}`;
  if (s.type === 'setMode') return `Modo ${s.mode}`;
  return 'Sempre permitir';
}

// ---------- instalação dos hooks em ~/.claude/settings.json ----------
function claudeSettingsPath() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
}

const isOurs = (h) => h && Array.isArray(h.hooks) && h.hooks.some((x) => x.type === 'http' && /127\.0\.0\.1:\d+\/hooks\/(permission-request|event)/.test(x.url || ''));

function hookEntries({ port, token, timeoutSec }) {
  const headers = { 'X-SideNotch-Token': token };
  const out = { PermissionRequest: [{ matcher: '*', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}${HOOK_PATH}`, timeout: (timeoutSec || 110) + 10, headers }] }] };
  for (const ev of EVENT_HOOKS) out[ev] = [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}${EVENT_PATH}`, timeout: 5, headers }] }];
  return out;
}

function installHook(opts) {
  const file = claudeSettingsPath();
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* novo */ }
  cfg.hooks = cfg.hooks || {};
  for (const [ev, entries] of Object.entries(hookEntries(opts))) {
    const list = (cfg.hooks[ev] || []).filter((h) => !isOurs(h));
    cfg.hooks[ev] = list.concat(entries);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

function uninstallHook() {
  const file = claudeSettingsPath();
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return file; }
  if (cfg.hooks) {
    for (const ev of Object.keys(cfg.hooks)) {
      if (!Array.isArray(cfg.hooks[ev])) continue;
      cfg.hooks[ev] = cfg.hooks[ev].filter((h) => !isOurs(h));
      if (!cfg.hooks[ev].length) delete cfg.hooks[ev];
    }
    if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  }
  return file;
}

function hookInstalled() {
  try {
    const cfg = JSON.parse(fs.readFileSync(claudeSettingsPath(), 'utf8'));
    const h = cfg.hooks || {};
    return (h.PermissionRequest || []).some(isOurs) && (h.Stop || []).some(isOurs);
  } catch { return false; }
}

const newToken = () => crypto.randomBytes(16).toString('hex');

module.exports = { ApprovalServer, installHook, uninstallHook, hookInstalled, claudeSettingsPath, newToken, summarize, projectName, HOOK_PATH, EVENT_PATH, EVENT_HOOKS };
