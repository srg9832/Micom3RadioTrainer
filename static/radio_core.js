/* MICOM-3 training radio frequency model. Values are integer Hz (10-Hz resolution).
 * Independent of the DOM and usable by both browser and Node tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MicomRadioCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_CHANNEL = 200;
  const RX_MIN_HZ = 100000;
  const TX_MIN_HZ = 1600000;
  const MAX_HZ = 30000000;

  function parseFrequency(text) {
    const clean = String(text ?? '').replace(/,/g, '').trim();
    if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(clean)) return null;
    const [whole, decimal = ''] = clean.split('.');
    const hz = Number(whole) * 1000 + Number(decimal.padEnd(2, '0')) * 10;
    return hz >= RX_MIN_HZ && hz <= MAX_HZ ? hz : null;
  }

  function formatFrequency(hz) {
    if (!Number.isInteger(hz) || hz % 10 !== 0 || hz < 0) return '';
    const whole = Math.floor(hz / 1000);
    const decimal = String(Math.floor((hz % 1000) / 10)).padStart(2, '0');
    return `${whole.toLocaleString('en-US')}.${decimal}`;
  }

  function validReceive(hz) {
    return Number.isInteger(hz) && hz % 10 === 0 && hz >= RX_MIN_HZ && hz <= MAX_HZ;
  }

  function validTransmit(hz) {
    return validReceive(hz) && hz >= TX_MIN_HZ;
  }

  function makeTuning(type, rxHz, txHz) {
    if (!['SMPX', 'DPLX', 'RXO', 'TXO'].includes(type)) return null;
    const rx = type === 'TXO' ? null : rxHz;
    const tx = type === 'RXO' ? null : (type === 'SMPX' ? rxHz : txHz);
    if (rx !== null && !validReceive(rx)) return null;
    if (tx !== null && !validTransmit(tx)) return null;
    return { type, rxHz: rx, txHz: tx };
  }

  function sameSignal(a, b) {
    return a && b && a.band === b.band && a.mode === b.mode;
  }

  function canReceive(local, remote) {
    return !!(sameSignal(local, remote) && validReceive(local.rxHz) &&
      validTransmit(remote.txHz) && local.rxHz === remote.txHz);
  }

  function canConnect(a, b) {
    return canReceive(a, b) || canReceive(b, a);
  }

  function normalizedRemote(client) {
    const legacy = parseFrequency(client.frequency);
    const splitTuning = Number.isInteger(client.rx_frequency) || Number.isInteger(client.tx_frequency);
    const rx = splitTuning ? client.rx_frequency : legacy;
    const tx = splitTuning ? client.tx_frequency : legacy;
    return { rxHz: rx, txHz: tx, band: client.band, mode: client.mode };
  }

  function nextProgrammedChannel(current, direction, channels) {
    const ids = Object.keys(channels).map(Number)
      .filter(id => Number.isInteger(id) && id >= 1 && id <= MAX_CHANNEL)
      .sort((a, b) => a - b);
    if (!ids.length) return null;
    if (direction > 0) return ids.find(id => id > current) ?? ids[0];
    return [...ids].reverse().find(id => id < current) ?? ids[ids.length - 1];
  }

  return { MAX_CHANNEL, RX_MIN_HZ, TX_MIN_HZ, MAX_HZ, parseFrequency,
    formatFrequency, validReceive, validTransmit, makeTuning,
    canReceive, canConnect, normalizedRemote, nextProgrammedChannel };
});
