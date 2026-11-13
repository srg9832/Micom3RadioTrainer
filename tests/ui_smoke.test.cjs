const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../static/radio_core.js');

const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, textContent: '', innerHTML: '', style: {}, srcObject: null,
    volume: 1, muted: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, remove() {}
  });
  return elements.get(id);
}
const ctx = vm.createContext({
  window: { MicomRadioCore: core },
  document: { getElementById: element, querySelectorAll: () => [],
    createElement: () => element('new-audio') },
  location: { protocol: 'http:', host: 'localhost:8000' },
  navigator: {}, console, Map, Set, Date,
  setTimeout: () => 42, clearTimeout: () => {}
});
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
vm.runInContext(source, ctx);
const run = code => vm.runInContext(code, ctx);

(async () => {
  await run("isPoweredOn=true; state.screen='chan-default'; updateLcd();");
  assert.equal(element('lcdTopLeft').textContent, 'CH');
  assert.equal(element('lcdFreq').textContent, 'F 14,000.00');

  await run('handleAction("menu")');
  await run('handleAction("f2")');
  assert.equal(element('lcdTopLeft').textContent, 'SMPX');
  await run('handleAction("f3")'); // RXO
  assert.equal(element('lcdTopLeft').textContent, 'RXO');
  for (const c of '1500') await run('handleAction("digit-' + c + '")');
  await run('handleAction("enter")');
  assert.equal(element('lcdTopLeft').textContent, 'FREQ');
  assert.equal(await run('currentTuning().rxHz'), 1500000);
  assert.equal(await run('currentTuning().txHz'), null);
  assert.equal(element('lcdFreq').textContent, 'R 1,500.00');

  // Duplex uses two independently entered frequencies.
  await run('handleAction("menu")');
  await run('handleAction("f2")');
  await run('handleAction("f2")'); // DPLX
  for (const c of '14000') await run('handleAction("digit-' + c + '")');
  await run('handleAction("enter")');
  assert.equal(element('lcdTopLeft').textContent, 'DPLX');
  for (const c of '15000') await run('handleAction("digit-' + c + '")');
  await run('handleAction("enter")');
  assert.equal(await run('currentTuning().rxHz'), 14000000);
  assert.equal(await run('currentTuning().txHz'), 15000000);
  assert.equal(element('lcdFreq').textContent, 'R 14,000.00');

  // Unprogrammed channel entry does not silently tune an invented frequency.
  await run('handleAction("menu")');
  await run('handleAction("f1")');
  assert.equal(element('lcdTopLeft').textContent, 'CHAN');
  await run('handleAction("digit-5")');
  await run('handleAction("enter")');
  assert.equal(element('lcdTopLeft').textContent, 'FREQ');
  assert.equal(await run('currentChannel'), 1);
  assert.equal(element('lcdFlashLine').textContent, 'NOT PROG');

  console.log('UI simulation tests passed');
})().catch(err => { console.error(err); process.exitCode = 1 });
