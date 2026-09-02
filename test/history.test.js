const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { History } = require('../src/history');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snh-'));
const h = new History(dir);
const u = (p, r = '2030-01-01T05:00:00Z') => [{ id: 'claude', name: 'Claude', ok: true, primary: { usedPercent: p, resetsAt: r } }];
const cfg = { enabled: true, thresholds: [80, 95], onReset: true };

assert.deepEqual(h.record(u(10), cfg), []);
let a = h.record(u(82), cfg); assert.equal(a.length, 1); assert.equal(a[0].threshold, 80);
a = h.record(u(84), cfg); assert.equal(a.length, 0, 'não repete o mesmo limiar');
a = h.record(u(96), cfg); assert.equal(a.length, 1); assert.equal(a[0].threshold, 95);
a = h.record(u(3, '2030-01-01T10:00:00Z'), cfg); assert.equal(a[0].type, 'reset', 'queda grande + novo reset → reinício');
a = h.record(u(81), cfg); assert.equal(a.length, 1, 'após reinício, limiar dispara de novo');
console.log('✓ alertas');

// previsão: injeta amostras artificiais (10 pontos em 20 min)
const h2 = new History(fs.mkdtempSync(path.join(os.tmpdir(), 'snh-')));
const now = Date.now();
h2.data.samples.codex = [{ t: now - 20 * 60000, p: 40, r: '2030-01-01T00:00:00Z' }, { t: now, p: 50, r: '2030-01-01T00:00:00Z' }];
const f = h2.forecast('codex');
assert.equal(f.rate, 0.5); assert.equal(f.etaMinutes, 100); assert.equal(f.exhaustsBeforeReset, true);
assert.equal(h2.forecast('nada'), null);
const s = h2.series('codex'); assert.equal(s.samples.length, 2); assert.equal(s.days.length, 7);
console.log('✓ previsão/séries');

// persistência
const h3 = new History(dir); assert.ok(h3.data.samples.claude.length >= 3);
console.log('✓ persistência\nhistórico OK');
