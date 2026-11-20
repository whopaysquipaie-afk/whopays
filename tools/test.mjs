#!/usr/bin/env node
// Runs the API contract test suite (site/assets/js/tests/contrat.js) in Node, in demo mode,
// with an in-memory localStorage. Same suite as site/tests.html.
// Usage: node tools/test.mjs

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = join(ROOT, 'site/assets/js/tests/contrat.js');

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(i) { return [...this.#data.keys()][i] ?? null; }
  getItem(k) { return this.#data.has(String(k)) ? this.#data.get(String(k)) : null; }
  setItem(k, v) { this.#data.set(String(k), String(v)); }
  removeItem(k) { this.#data.delete(String(k)); }
  clear() { this.#data.clear(); }
}
globalThis.localStorage = new MemoryStorage();

if (!existsSync(SUITE)) {
  console.log('OK     Aucune suite de tests pour l\'instant (contrat.js absent).');
  process.exit(0);
}

const { runContractTests } = await import(pathToFileURL(SUITE).href);
const started = Date.now();
const results = await runContractTests({
  onResult: (r) => console.log(`${r.ok ? 'OK    ' : 'ÉCHEC '} ${r.group} › ${r.name}${r.ok ? '' : `\n         → ${r.error}`}`)
});
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} tests OK en ${Date.now() - started} ms.`);
process.exit(failed ? 1 : 0);
