// Armazenamento simples de configurações em JSON (userData/settings.json)
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  side: 'right',              // 'left' | 'right'
  vertical: 'center',         // 'top' | 'center' | 'bottom' | 'custom' (arrastado)
  offset: 0,                  // deslocamento vertical em px a partir da posição escolhida
  y: null,                    // posição absoluta (vertical === 'custom')
  displayId: null,            // monitor (null = primário)
  refreshSeconds: 180,        // intervalo de atualização
  collapsedWidth: 6,          // largura da "notch" fechada
  compact: 'dots',            // 'off' | 'dots' | 'percent' — o que aparece na notch fechada
  autoLaunch: false,
  dnd: false,                 // não perturbe: sem som, sem toast, sem abrir sozinha
  providers: {
    claude:      { enabled: true, token: '' },
    codex:       { enabled: true },
    cursor:      { enabled: true, cookie: '' },
    gemini:      { enabled: true },
    antigravity: { enabled: false },
    openrouter:  { enabled: false, apiKey: '' },
    nvidia:      { enabled: false, apiKey: '' },
    opencode:    { enabled: false }
  },
  order: ['claude', 'codex', 'cursor', 'gemini', 'antigravity', 'openrouter', 'nvidia', 'opencode'],
  approvals: {
    enabled: true,
    port: 47321,
    token: '',
    timeoutSec: 110,
    sound: true
  },
  notifications: {
    done: true,               // "Claude terminou"
    waiting: true,            // "Claude está esperando você"
    denied: true,             // avisos do auto mode
    toast: true,              // notificação nativa do Windows além do cartão
    autoDismissSec: 20
  },
  alerts: {
    enabled: true,
    thresholds: [80, 95],     // % usado
    onReset: true             // avisa quando a janela reinicia
  },
  shortcuts: { toggle: '', approve: '', deny: '' },   // ex.: "CommandOrControl+Shift+Space"
  update: { auto: true },
  maestri: {                  // Maestri Wire (https://www.themaestri.app/pt-br/docs/wire)
    enabled: false, host: '127.0.0.1', port: 7434, token: '', keyHash: '', deviceId: '', deviceIdentifier: '', role: '', alternateHosts: [],
    pollSeconds: 4, notifyAttention: true
  }
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = this._load();
  }
  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return deepMerge(structuredClone(DEFAULTS), raw);
    } catch { return structuredClone(DEFAULTS); }
  }
  get() { return this.data; }
  set(patch) {
    this.data = deepMerge(this.data, patch);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.data;
  }
}

function deepMerge(a, b) {
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') a[k] = deepMerge(a[k], b[k]);
    else a[k] = b[k];
  }
  return a;
}

module.exports = { Store, DEFAULTS };
