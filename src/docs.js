// Notas rápidas e canvas (boards) — JSON em userData, salvamento com debounce.
const fs = require('fs');
const path = require('path');

class Docs {
  constructor(dir) {
    this.file = path.join(dir, 'docs.json');
    this.data = { notes: [], boards: [] };
    try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch { /* novo */ }
    if (!this.data.notes.length) this.data.notes.push({ id: 'n1', title: 'Nota rápida', text: '', updatedAt: Date.now() });
    if (!this.data.boards.length) this.data.boards.push({ id: 'b1', name: 'Board 1', items: [], view: { x: 0, y: 0, zoom: 1 }, updatedAt: Date.now() });
    this._t = null;
  }
  get() { return this.data; }
  // patch: { notes?: [...], boards?: [...] } — substitui a coleção inteira (a UI é a dona do estado)
  set(patch) {
    if (Array.isArray(patch.notes)) this.data.notes = patch.notes.slice(0, 200);
    if (Array.isArray(patch.boards)) this.data.boards = patch.boards.slice(0, 50);
    clearTimeout(this._t); this._t = setTimeout(() => this._save(), 400);
    return this.data;
  }
  _save() { try { fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch { /* ignore */ } }
  flush() { clearTimeout(this._t); this._save(); }
}

module.exports = { Docs };
