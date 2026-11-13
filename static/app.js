
const RadioCore = window.MicomRadioCore;
if (!RadioCore) throw new Error('radio_core.js did not load');

const connectionStatus = document.getElementById('connectionStatus');
const sideMode = document.getElementById('sideMode');
const connectButton = document.getElementById('connectButton');
const powerKnob = document.getElementById('powerKnob');
const nameInput = document.getElementById('nameInput');
const peerList = document.getElementById('peerList');
const pttButton = document.getElementById('pttButton');
const logEl = document.getElementById('log');
const lcd = document.getElementById('lcd');
const lcdDivider = document.getElementById('lcdDivider');
const screenMessage = document.getElementById('screenMessage');
const txLed = document.getElementById('txLed');
const connLed = document.getElementById('connLed');
const hotspotButtons = Array.from(document.querySelectorAll('.hotspot[data-action]'));

const lcdTopLeft = document.getElementById('lcdTopLeft');
const lcdTopRight = document.getElementById('lcdTopRight');
const lcdFreq = document.getElementById('lcdFreq');
const lcdFlashLine = document.getElementById('lcdFlashLine');
const lcdModeLine = document.getElementById('lcdModeLine');
const lcdBwLine = document.getElementById('lcdBwLine');
const lcdBand = document.getElementById('lcdBand');
const lcdCenter = document.getElementById('lcdCenter');
const lcdBottom1 = document.getElementById('lcdBottom1');
const lcdBottom2 = document.getElementById('lcdBottom2');
const lcdBottom3 = document.getElementById('lcdBottom3');
const lcdSq = document.getElementById('lcdSq');
const lcdAgc = document.getElementById('lcdAgc');
const lcdBw = document.getElementById('lcdBw');
const lcdClip = document.getElementById('lcdClip');
const lcdNb = document.getElementById('lcdNb');
const lcdMon = document.getElementById('lcdMon');
const softEls = [1, 2, 3, 4].map(n => document.getElementById(`soft${n}`));

let ws = null;
let myId = null;
let myName = '';
let currentChannel = 1;
let localStream = null;
let localTrack = null;
let isConnected = false;
let isPoweredOn = false;
let isTransmitting = false;
let peers = new Map();
let knownClients = [];
let audioEls = new Map();
let menuTimer = null;
let modeTimer = null;
let bootTimer = null;
let flashTimer = null;
let flashActive = false;
let audioContext = null;
let staticSource = null;
let staticGain = null;
let staticFilter = null;

const rtcConfig = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
};

const state = {
  screen: 'off', // off, booting, chan-default, menu, chan-function-display, mode-select, bw-select
  lastDefaultMode: 'chan-default',
  channelSoftkeyPage: 0,
  softkeyContext: 'channel', // channel, dsp1
  menuPage: 0,
  menuCursor: 0,
  tempDigits: '',
  band: 'USB',
  monitorOn: false,
  squelchOn: true,
  clipOn: false,
  nbOn: false,
  agc: 'OFF',
  power: 'LOW',
  mode: 'SSB',
  bandwidth: '2.7',
  flashText: '',
  vfo: { type: 'SMPX', rxHz: 14000000, txHz: 14000000 },
  freqSetup: null,
};

const channelFreqs = {
  1: '14,000.00',
  2: '14,002.50',
  3: '14,005.00',
  4: '14,007.50',
};

const CHANNEL_SOFTKEY_PAGES = [
  ['', 'BAND', 'SQ', 'DSP'],
  ['PWR', 'MODE', 'AGC', 'BW'],
  ['RCLV', '', '', ''],
  ['CALL', '', '', 'MON'],
];

const DSP_PAGE_1 = ['CLAR', 'NF', 'CLIP', 'NB'];
const MENU_PAGES = [
  ['CHAN', 'FREQ', 'ALE', 'BIT'],
  ['LOCK', 'PROG', 'PSW', 'DIM'],
];
const POWER_LEVELS = ['LOW', 'MED', 'HIGH', 'MAX'];
const AGC_LEVELS = ['AG-SLOW', 'AG-FAST', 'OFF'];
const BAND_LEVELS = ['USB', 'LSB'];
const MODE_LEVELS = ['SSB', 'AME', 'PLT'];
const BW_LEVELS = ['2.1', '2.7', '3.0', '3.3'];

function log(message) {
  const stamp = new Date().toLocaleTimeString();
  logEl.textContent = `[${stamp}] ${message}\n` + logEl.textContent;
}

function setConnectionStatus(text) {
  connectionStatus.textContent = text;
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function frequencyValueForChannel(channel) {
  return channelFreqs[channel] || '';
}

function frequencyForChannel(channel) {
  const value = frequencyValueForChannel(channel);
  return value ? `F ${value}` : '';
}

function currentFrequencyValue() {
  if (state.lastDefaultMode === 'freq-default') {
    return RadioCore.formatFrequency(state.vfo.rxHz ?? state.vfo.txHz);
  }
  return frequencyValueForChannel(currentChannel);
}

function currentTuning() {
  const tuning = state.lastDefaultMode === 'freq-default'
    ? state.vfo
    : RadioCore.makeTuning('SMPX', RadioCore.parseFrequency(frequencyValueForChannel(currentChannel)),
      RadioCore.parseFrequency(frequencyValueForChannel(currentChannel)));
  return { rxHz: tuning?.rxHz ?? null, txHz: tuning?.txHz ?? null,
    band: state.band, mode: state.mode };
}

function remoteTuning(client) { return RadioCore.normalizedRemote(client); }
function matchesCurrentTuning(client) {
  return RadioCore.canReceive(currentTuning(), remoteTuning(client));
}
function connectsCurrentTuning(client) {
  return RadioCore.canConnect(currentTuning(), remoteTuning(client));
}
function membersOnSameFrequency() {
  return knownClients.filter(c => c.id === myId || connectsCurrentTuning(c));
}

function renderPeers() {
  const members = membersOnSameFrequency();
  if (!members.length) {
    peerList.innerHTML = '<div class="radio-member"><span>No radios on this frequency</span><span>RX</span></div>';
    return;
  }
  peerList.innerHTML = members.map((member) => {
    const isMe = member.id === myId;
    const transmitting = isMe ? isTransmitting : (peers.get(member.id)?.transmitting || false);
    return `
      <div class="radio-member">
        <span>${escapeHtml(member.name)}${isMe ? ' *' : ''}</span>
        <strong>${transmitting ? 'TX' : 'RX'}</strong>
      </div>`;
  }).join('');
}

async function ensureAudioContext() {
  if (audioContext) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioContext = new AC();

  const bufferSize = audioContext.sampleRate * 2;
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = (Math.random() * 2 - 1) * 0.8;
  }

  staticSource = audioContext.createBufferSource();
  staticSource.buffer = buffer;
  staticSource.loop = true;

  staticFilter = audioContext.createBiquadFilter();
  staticFilter.type = 'bandpass';
  staticFilter.frequency.value = 1700;
  staticFilter.Q.value = 0.8;

  staticGain = audioContext.createGain();
  staticGain.gain.value = 0;

  staticSource.connect(staticFilter);
  staticFilter.connect(staticGain);
  staticGain.connect(audioContext.destination);
  staticSource.start();
}

async function ensureLocalMedia() {
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  localTrack = localStream.getAudioTracks()[0];
  localTrack.enabled = false;
  log('Microphone ready.');
}

function peerConfigPayload() {
  return {
    frequency: currentFrequencyValue(),
    band: state.band,
    mode: state.mode,
    rx_frequency: currentTuning().rxHz,
    tx_frequency: currentTuning().txHz,
  };
}

async function connect() {
  if (isConnected) return;
  myName = (nameInput.value || '').trim() || `Radio-${Math.floor(Math.random() * 900 + 100)}`;
  await ensureLocalMedia();
  await ensureAudioContext();

  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'join',
      name: myName,
      channel: currentChannel,
      ...peerConfigPayload(),
    }));
    setConnectionStatus('Connected');
    isConnected = true;
    log(`Connected as ${myName}.`);
    updateLcd();
  };
  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    await handleMessage(msg);
  };
  ws.onclose = () => {
    setConnectionStatus('Offline');
    isConnected = false;
    myId = null;
    cleanupAllPeers();
    knownClients = [];
    renderPeers();
    updateAudioRouting();
    updateLcd();
  };
  ws.onerror = () => log('WebSocket error.');
}

function disconnect() {
  setTransmitState(false);
  if (ws) {
    try { ws.close(); } catch (_) {}
  }
  cleanupAllPeers();
  isConnected = false;
  knownClients = [];
  myId = null;
  renderPeers();
  updateAudioRouting();
  updateLcd();
}

async function handleMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      myId = msg.your_id;
      break;
    case 'state':
      knownClients = msg.clients || [];
      await syncPeersForCurrentTuning();
      for (const client of knownClients) {
        const peer = peers.get(client.id);
        if (peer) peer.transmitting = !!client.transmitting;
      }
      renderPeers();
      updateAudioRouting();
      break;
    case 'signal':
      await handleSignal(msg.from, msg.payload);
      break;
    case 'peer-left':
      removePeer(msg.peer_id);
      renderPeers();
      updateAudioRouting();
      break;
    case 'ptt': {
      const peer = peers.get(msg.peer_id);
      if (peer) peer.transmitting = !!msg.transmitting;
      renderPeers();
      updateAudioRouting();
      break;
    }
  }
}

function getMembersOnCurrentTuning() {
  return knownClients.filter(c => c.id !== myId && connectsCurrentTuning(c));
}

async function syncPeersForCurrentTuning() {
  const desiredIds = new Set(getMembersOnCurrentTuning().map(p => p.id));
  for (const peerId of Array.from(peers.keys())) {
    if (!desiredIds.has(peerId)) removePeer(peerId);
  }
  for (const member of getMembersOnCurrentTuning()) {
    if (!peers.has(member.id)) {
      const shouldInitiate = myId && myId < member.id;
      await createPeer(member.id, shouldInitiate);
    }
  }
}

async function createPeer(peerId, shouldInitiate) {
  const pc = new RTCPeerConnection(rtcConfig);
  peers.set(peerId, { pc, transmitting: false, pendingCandidates: [] });
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

  pc.onicecandidate = (event) => {
    if (event.candidate) sendSignal(peerId, { type: 'candidate', candidate: event.candidate });
  };
  pc.ontrack = (event) => {
    let audio = audioEls.get(peerId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audioEls.set(peerId, audio);
      document.body.appendChild(audio);
    }
    audio.srcObject = event.streams[0];
    updateAudioRouting();
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      removePeer(peerId);
      renderPeers();
      updateAudioRouting();
    }
  };

  if (shouldInitiate) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(peerId, { type: 'offer', sdp: pc.localDescription });
  }
}

async function handleSignal(fromPeerId, payload) {
  let entry = peers.get(fromPeerId);
  if (!entry) {
    await createPeer(fromPeerId, false);
    entry = peers.get(fromPeerId);
  }
  const pc = entry.pc;
  if (payload.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    await flushIceCandidates(entry);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal(fromPeerId, { type: 'answer', sdp: pc.localDescription });
  } else if (payload.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    await flushIceCandidates(entry);
  } else if (payload.type === 'candidate' && payload.candidate) {
    if (!pc.remoteDescription) entry.pendingCandidates.push(payload.candidate);
    else {
      try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); }
      catch (err) { log('ICE candidate error: ' + (err.message || err)); }
    }
  }
}

async function flushIceCandidates(entry) {
  for (const candidate of entry.pendingCandidates.splice(0)) {
    try { await entry.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch (err) { log('ICE candidate error: ' + (err.message || err)); }
  }
}

function sendSignal(target, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'signal', target, payload }));
}

function sendConfigUpdate() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'update-config', ...peerConfigPayload() }));
}

function removePeer(peerId) {
  const entry = peers.get(peerId);
  if (entry) {
    try { entry.pc.close(); } catch (_) {}
    peers.delete(peerId);
  }
  const audio = audioEls.get(peerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    audioEls.delete(peerId);
  }
}

function cleanupAllPeers() {
  for (const peerId of Array.from(peers.keys())) removePeer(peerId);
}

function updateAudioRouting() {
  const monitorEnabled = state.monitorOn && isPoweredOn;

  for (const [peerId, audio] of audioEls.entries()) {
    const client = knownClients.find(c => c.id === peerId);
    const peer = peers.get(peerId);
    const peerTalking = !!peer?.transmitting;
    const tuningMatch = !!client && matchesCurrentTuning(client);
    let shouldHearVoice = monitorEnabled && tuningMatch;

    if (state.squelchOn && !peerTalking) {
      shouldHearVoice = false;
    }

    audio.muted = !shouldHearVoice;
    audio.volume = shouldHearVoice ? 1 : 0;
  }

  if (staticGain) {
    const staticLevel = (monitorEnabled && !state.squelchOn) ? 0.025 : 0;
    staticGain.gain.value = staticLevel;
  }
}

function setTransmitState(active) {
  if (!localTrack || !isConnected || !isPoweredOn) return;
  if (active && !RadioCore.validTransmit(currentTuning().txHz)) {
    flashMessage('RX ONLY');
    return;
  }
  if (isTransmitting === active) return;
  isTransmitting = active;
  localTrack.enabled = active;
  pttButton.classList.toggle('tx', active);
  pttButton.textContent = active ? 'Transmitting' : 'Hold PTT';
  ws.send(JSON.stringify({ type: 'ptt', transmitting: active }));
  updateLcd();
  renderPeers();
}

async function switchChannel(newChannel) {
  if (!Number.isInteger(newChannel) || newChannel < 1 || newChannel > RadioCore.MAX_CHANNEL ||
      !Object.hasOwn(channelFreqs, newChannel)) {
    flashMessage('NOT PROG');
    return false;
  }
  if (newChannel === currentChannel && state.lastDefaultMode === 'chan-default') return true;
  setTransmitState(false);
  currentChannel = newChannel;
  state.lastDefaultMode = 'chan-default';
  state.tempDigits = '';
  sendConfigUpdate();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'switch-channel', channel: currentChannel, ...peerConfigPayload() }));
  }
  await syncPeersForCurrentTuning();
  log('Switched to Channel ' + currentChannel + '.');
  renderPeers();
  updateAudioRouting();
  updateLcd();
  return true;
}

function startFrequencySetup() {
  const previous = state.vfo;
  state.freqSetup = { type: previous.type, rxHz: previous.rxHz, txHz: previous.txHz,
    step: previous.type === 'TXO' ? 'tx' : 'rx', input: '' };
  state.screen = 'freq-setup';
  state.channelSoftkeyPage = 0;
  clearMenuTimer();
  updateLcd();
}

function selectFrequencyType(index) {
  const type = ['SMPX', 'DPLX', 'RXO', 'TXO'][index - 1];
  if (!type || !state.freqSetup) return;
  state.freqSetup.type = type;
  state.freqSetup.step = type === 'TXO' ? 'tx' : 'rx';
  state.freqSetup.input = '';
  updateLcd();
}

function appendFrequencyDigit(digit) {
  const setup = state.freqSetup;
  if (!setup) return;
  const value = setup.input + digit;
  if (/^\d{1,5}(?:\.\d{0,2})?$/.test(value)) setup.input = value;
  updateLcd();
}

function appendFrequencyDecimal() {
  const setup = state.freqSetup;
  if (!setup || setup.input.includes('.')) return;
  setup.input = (setup.input || '0') + '.';
  updateLcd();
}

async function confirmFrequencySetup() {
  const setup = state.freqSetup;
  if (!setup) return;
  const value = setup.input ? RadioCore.parseFrequency(setup.input) : setup[setup.step + 'Hz'];
  const isTx = setup.step === 'tx';
  if (value === null || !(isTx ? RadioCore.validTransmit(value) :
      (setup.type === 'SMPX' ? RadioCore.validTransmit(value) : RadioCore.validReceive(value)))) {
    flashMessage('INVALID FREQ');
    return;
  }
  setup[setup.step + 'Hz'] = value;
  setup.input = '';
  if (setup.type === 'DPLX' && setup.step === 'rx') {
    setup.step = 'tx';
    updateLcd();
    return;
  }
  const tuning = RadioCore.makeTuning(setup.type, setup.rxHz, setup.txHz);
  if (!tuning) { flashMessage('INVALID FREQ'); return; }
  setTransmitState(false);
  state.vfo = tuning;
  state.freqSetup = null;
  state.lastDefaultMode = 'freq-default';
  state.screen = 'freq-default';
  state.channelSoftkeyPage = 0;
  state.softkeyContext = 'channel';
  sendConfigUpdate();
  await syncPeersForCurrentTuning();
  renderPeers();
  updateAudioRouting();
  updateLcd();
  log('Frequency mode: ' + tuning.type + ' RX ' + RadioCore.formatFrequency(tuning.rxHz) +
      ' TX ' + RadioCore.formatFrequency(tuning.txHz));
}

function clearMenuTimer() {
  if (menuTimer) {
    clearTimeout(menuTimer);
    menuTimer = null;
  }
}

function clearModeTimer() {
  if (modeTimer) {
    clearTimeout(modeTimer);
    modeTimer = null;
  }
}

function clearFlashTimer() {
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
}

function armMenuTimer() {
  clearMenuTimer();
  if (state.screen === 'menu') {
    menuTimer = setTimeout(() => {
      leaveToDefault();
    }, 10000);
  }
}

function armModeTimer() {
  clearModeTimer();
  if (state.screen === 'mode-select') {
    modeTimer = setTimeout(() => {
      leaveToDefault();
    }, 10000);
  }
}

function resetContextTimerOnAction() {
  if (state.screen === 'menu') armMenuTimer();
  if (state.screen === 'mode-select') armModeTimer();
}

function leaveToDefault() {
  clearMenuTimer();
  clearModeTimer();
  state.screen = state.lastDefaultMode;
  state.tempDigits = '';
  state.softkeyContext = 'channel';
  updateLcd();
}

function showScreenMessage(text) {
  screenMessage.style.display = 'flex';
  screenMessage.textContent = text;
}

function hideScreenMessage() {
  screenMessage.style.display = 'none';
}

function flashMessage(text, duration = 1000) {
  clearFlashTimer();
  flashActive = true;
  state.flashText = text || '';
  updateLcd();
  flashTimer = setTimeout(() => {
    flashActive = false;
    state.flashText = '';
    updateLcd();
  }, duration);
}

async function powerToggle() {
  if (!isPoweredOn) {
    isPoweredOn = true;
    state.screen = 'booting';
    lcd.classList.remove('off');
    showScreenMessage('SELF TEST');
    updateLcd();
    try {
      await connect();
    } catch (err) {
      log(`Power-on failed: ${err.message || err}`);
    }
    if (bootTimer) clearTimeout(bootTimer);
    bootTimer = setTimeout(() => {
      hideScreenMessage();
      state.screen = state.lastDefaultMode;
      updateLcd();
    }, 3000);
    log('Radio powered on.');
  } else {
    log('Radio powered off.');
    if (bootTimer) clearTimeout(bootTimer);
    clearMenuTimer();
    clearModeTimer();
    clearFlashTimer();
    flashActive = false;
    disconnect();
    isPoweredOn = false;
    state.screen = 'off';
    hideScreenMessage();
    lcd.classList.add('off');
    updateAudioRouting();
    updateLcd();
  }
}

function openMenu() {
  if (!isPoweredOn || state.screen === 'booting') return;
  state.screen = 'menu';
  state.menuPage = 0;
  state.menuCursor = 0;
  state.tempDigits = '';
  armMenuTimer();
  updateLcd();
}

function menuItems() {
  return MENU_PAGES[state.menuPage];
}

function menuSelection() {
  return menuItems()[state.menuCursor] || '';
}

function enterMenuSelection() {
  const selected = menuSelection();
  if (selected === 'FREQ') {
    startFrequencySetup();
    return;
  }
  if (selected === 'CHAN') {
    state.screen = 'chan-function-display';
    state.tempDigits = '';
    clearMenuTimer();
    updateLcd();
    return;
  }
  log(`${selected} selected. Function placeholder for later.`);
  leaveToDefault();
}

function cycleChannelSoftkeys(delta) {
  state.softkeyContext = 'channel';
  state.channelSoftkeyPage = (state.channelSoftkeyPage + delta + CHANNEL_SOFTKEY_PAGES.length) % CHANNEL_SOFTKEY_PAGES.length;
  updateLcd();
}

function setSoftkeys(labels) {
  softEls.forEach((el, index) => {
    const label = labels[index] || '';
    el.textContent = label || '\u00A0';
    el.classList.toggle('empty', !label);
  });
}



function showFrequencyArea(text) {
  lcdFreq.style.display = '';
  lcdFlashLine.style.display = 'none';
  lcdFreq.textContent = text || '';
  lcdFlashLine.textContent = '';
}

function showFlashInFrequencyArea(text) {
  lcdFreq.style.display = 'none';
  lcdFlashLine.style.display = '';
  lcdFlashLine.textContent = text || '';
}

function clearSecondaryLines() {
  lcdModeLine.textContent = '';
  lcdBwLine.textContent = '';
}

function setExplicitIndicators() {
  lcdSq.textContent = state.squelchOn ? 'SQ' : '';
  lcdAgc.textContent = state.agc !== 'OFF' ? state.agc : '';
  lcdBw.textContent = state.bandwidth ? `BW ${state.bandwidth}` : '';
  lcdClip.textContent = state.clipOn ? 'CLIP' : '';
  lcdNb.textContent = state.nbOn ? 'NB' : '';
  lcdMon.textContent = state.monitorOn ? 'MON' : '';
}

function clearExplicitIndicators() {
  lcdSq.textContent = '';
  lcdAgc.textContent = '';
  lcdBw.textContent = '';
  lcdClip.textContent = '';
  lcdNb.textContent = '';
  lcdMon.textContent = '';
  clearSecondaryLines();
  lcdBand.textContent = '';
}

function defaultSoftkeys() {
  if (state.softkeyContext === 'dsp1') return DSP_PAGE_1;
  if (state.screen === 'freq-default' && state.channelSoftkeyPage === 0)
    return ['T/R', 'BAND', 'SQ', 'DSP'];
  if (state.screen === 'freq-default' && state.channelSoftkeyPage === 2)
    return ['RCLV', 'STOR', '<--', '-->'];
  return CHANNEL_SOFTKEY_PAGES[state.channelSoftkeyPage];
}

function defaultIndicators() {
  const left = [];
  const middle = [];
  const right = [];

  if (state.squelchOn) left.push('SQ');
  if (state.agc !== 'OFF') middle.push(state.agc);
  if (state.bandwidth) middle.push(`BW ${state.bandwidth}`);
  if (state.clipOn) right.push('CLIP');
  if (state.nbOn) right.push('NB');
  if (state.monitorOn) right.push('MON');

  return [left.join(' '), middle.join('  '), right.join(' ')];
}

function updateLcd() {
  sideMode.textContent = state.screen.toUpperCase();
  connLed.classList.toggle('active', isConnected);
  txLed.classList.toggle('active', isTransmitting);

  if (!isPoweredOn) {
    lcd.classList.add('off');
    lcdDivider.style.display = '';
    showScreenMessage('OFF');
    lcdTopLeft.textContent = '';
    lcdTopRight.textContent = '';
    showFrequencyArea('');
    clearSecondaryLines();
    lcdBand.textContent = '';
    lcdCenter.textContent = '';
    lcdBottom1.textContent = '';
    lcdBottom2.textContent = '';
    lcdBottom3.textContent = '';
    clearExplicitIndicators();
    setSoftkeys(['', '', '', '']);
    setConnectionStatus('Offline');
    return;
  }

  lcd.classList.remove('off');
  setConnectionStatus(isConnected ? 'Connected' : 'Standby');

  if (state.screen === 'booting') {
    lcdDivider.style.display = 'none';
    showScreenMessage('SELF TEST');
    setSoftkeys(['', '', '', '']);
    lcdTopLeft.textContent = '';
    lcdTopRight.textContent = '';
    showFrequencyArea('');
    clearSecondaryLines();
    lcdBand.textContent = '';
    lcdCenter.textContent = '';
    lcdBottom1.textContent = '';
    lcdBottom2.textContent = '';
    lcdBottom3.textContent = '';
    clearExplicitIndicators();
    return;
  }

  if (!flashActive) {
    hideScreenMessage();
  }

  if (state.screen === 'chan-default' || state.screen === 'freq-default') {
    const isFrequency = state.screen === 'freq-default';
    lcdDivider.style.display = '';
    state.lastDefaultMode = isFrequency ? 'freq-default' : 'chan-default';
    const labels = defaultSoftkeys();
    lcdTopLeft.textContent = isFrequency ? 'FREQ' : 'CH';
    lcdTopRight.textContent = isFrequency ? '' : String(currentChannel);
    if (flashActive && state.flashText) {
      showFlashInFrequencyArea(state.flashText);
    } else {
      if (isFrequency) {
        const tuning = state.vfo;
        const prefix = tuning.type === 'TXO' ? 'T' : (tuning.type === 'DPLX' || tuning.type === 'RXO') ? 'R' : 'F';
        showFrequencyArea(prefix + ' ' + RadioCore.formatFrequency(tuning.type === 'TXO' ? tuning.txHz : tuning.rxHz));
      } else showFrequencyArea(frequencyForChannel(currentChannel));
    }
    clearSecondaryLines();
    lcdBand.textContent = state.band;
    lcdCenter.textContent = '';
    lcdBottom1.textContent = '';
    lcdBottom2.textContent = '';
    lcdBottom3.textContent = '';
    setExplicitIndicators();
    setSoftkeys(labels);
    return;
  }

  if (state.screen === 'freq-setup') {
    const setup = state.freqSetup;
    const current = setup.input || RadioCore.formatFrequency(setup[setup.step + 'Hz']);
    const prefix = setup.type === 'SMPX' ? 'F' : setup.step === 'rx' ? 'R' : 'T';
    lcdDivider.style.display = '';
    lcdTopLeft.textContent = setup.type;
    lcdTopRight.textContent = '';
    if (flashActive && state.flashText) showFlashInFrequencyArea(state.flashText);
    else showFrequencyArea(prefix + ' ' + current);
    clearSecondaryLines();
    lcdBand.textContent = state.band;
    lcdCenter.textContent = '';
    lcdBottom1.textContent = '';
    lcdBottom2.textContent = '';
    lcdBottom3.textContent = '';
    setExplicitIndicators();
    setSoftkeys(setup.input ? ['', '', 'BACK', 'CLR'] : ['SMPX', 'DPLX', 'RXO', 'TXO']);
    return;
  }

  if (state.screen === 'menu') {
    lcdDivider.style.display = '';
    const items = menuItems();
    lcdTopLeft.textContent = 'MENU';
    lcdTopRight.textContent = '';
    showFrequencyArea('');
    clearSecondaryLines();
    lcdBand.textContent = '';
    lcdCenter.textContent = '';
    lcdBottom1.textContent = '';
    lcdBottom2.textContent = '';
    lcdBottom3.textContent = '';
    clearExplicitIndicators();
    setSoftkeys(items);
    return;
  }

  if (state.screen === 'chan-function-display') {
    lcdDivider.style.display = 'none';
    lcdTopLeft.textContent = 'CHAN';
    lcdTopRight.textContent = state.tempDigits || '□';
    showFrequencyArea('');
    clearSecondaryLines();
    lcdBand.textContent = '';
    lcdCenter.textContent = '';
    lcdBottom1.textContent = '';
    lcdBottom2.textContent = '';
    lcdBottom3.textContent = '';
    clearExplicitIndicators();
    setSoftkeys(['', '', '', '']);
    return;
  }

  if (state.screen === 'mode-select') {
    lcdDivider.style.display = '';
    lcdTopLeft.textContent = state.lastDefaultMode === 'freq-default' ? 'FREQ' : 'CH';
    lcdTopRight.textContent = state.lastDefaultMode === 'freq-default' ? '' : String(currentChannel);
    showFrequencyArea(`MODE: ${state.mode}`);
    clearSecondaryLines();
    lcdBand.textContent = '';
    lcdCenter.textContent = '';
    lcdBottom1.textContent = '';
    lcdBottom2.textContent = '';
    lcdBottom3.textContent = '';
    clearExplicitIndicators();
    setSoftkeys(['SSB', 'AME', 'PLT', '']);
    return;
  }

  if (state.screen === 'bw-select') {
    lcdDivider.style.display = '';
    lcdTopLeft.textContent = 'BANDWIDTH';
    lcdTopRight.textContent = '';
    showFrequencyArea(`BW: ${state.bandwidth}`);
    clearSecondaryLines();
    lcdBand.textContent = '';
    lcdCenter.textContent = '';
    lcdBottom1.textContent = '';
    lcdBottom2.textContent = '';
    lcdBottom3.textContent = '';
    clearExplicitIndicators();
    setSoftkeys(BW_LEVELS);
  }
}

function nextValue(current, values) {
  const idx = values.indexOf(current);
  return values[(idx + 1) % values.length];
}

async function handleDefaultSoftkey(index) {
  const label = defaultSoftkeys()[index - 1] || '';
  if (!label) return;

  if (state.softkeyContext === 'dsp1') {
    if (label === 'CLIP') {
      state.clipOn = !state.clipOn;
      flashMessage(state.clipOn ? 'CLIP ON' : 'CLIP OFF');
      updateLcd();
      return;
    }
    if (label === 'NB') {
      state.nbOn = !state.nbOn;
      flashMessage(state.nbOn ? 'NB ON' : 'NB OFF');
      updateLcd();
      return;
    }
    log(`${label} pressed. Function not implemented yet.`);
    return;
  }

  if (label === 'T/R') { startFrequencySetup(); return; }

  if (label === 'BAND') {
    state.band = nextValue(state.band, BAND_LEVELS);
    flashMessage(state.band, 700);
    sendConfigUpdate();
    updateAudioRouting();
    renderPeers();
    updateLcd();
    return;
  }

  if (label === 'SQ') {
    state.squelchOn = !state.squelchOn;
    flashMessage(state.squelchOn ? 'SQUELCH ON' : 'SQUELCH OFF');
    updateAudioRouting();
    updateLcd();
    return;
  }

  if (label === 'DSP') {
    state.softkeyContext = 'dsp1';
    updateLcd();
    return;
  }

  if (label === 'PWR') {
    state.power = nextValue(state.power, POWER_LEVELS);
    flashMessage(state.power);
    updateLcd();
    return;
  }

  if (label === 'MODE') {
    state.screen = 'mode-select';
    armModeTimer();
    updateLcd();
    return;
  }

  if (label === 'AGC') {
    state.agc = nextValue(state.agc, AGC_LEVELS);
    flashMessage(state.agc);
    updateLcd();
    return;
  }

  if (label === 'BW') {
    state.screen = 'bw-select';
    updateLcd();
    return;
  }

  if (label === 'MON') {
    state.monitorOn = !state.monitorOn;
    updateAudioRouting();
    updateLcd();
    return;
  }

  log(`${label} pressed.`);
}

function enterChannelSelectFromKeypad(digit) {
  if (state.screen !== 'chan-function-display') return;
  if (state.tempDigits.length >= 3) return;
  state.tempDigits = `${state.tempDigits}${digit}`;
  updateLcd();
}

async function confirmChannelSelect() {
  if (state.screen !== 'chan-function-display') return;
  const parsed = parseInt(state.tempDigits, 10);
  if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= RadioCore.MAX_CHANNEL &&
      Object.hasOwn(channelFreqs, parsed)) {
    await switchChannel(parsed);
    leaveToDefault();
  } else {
    leaveToDefault();
    flashMessage('NOT PROG');
  }
}

async function selectMode(index) {
  const selected = MODE_LEVELS[index - 1];
  if (!selected) return;
  state.mode = selected;
  sendConfigUpdate();
  cleanupAllPeers();
  await syncPeersForCurrentTuning();
  updateAudioRouting();
  renderPeers();
  updateLcd();
  armModeTimer();
}

function selectBandwidth(index) {
  const selected = BW_LEVELS[index - 1];
  if (!selected) return;
  state.bandwidth = selected;
  updateLcd();
}

async function handleFKey(index) {
  if (state.screen === 'menu') {
    state.menuCursor = index - 1;
    enterMenuSelection();
    return;
  }
  if (state.screen === 'mode-select') {
    await selectMode(index);
    return;
  }
  if (state.screen === 'bw-select') {
    selectBandwidth(index);
    return;
  }
  if (state.screen === 'freq-setup') {
    if (state.freqSetup.input) {
      if (index === 3) state.freqSetup.input = state.freqSetup.input.slice(0, -1);
      if (index === 4) state.freqSetup.input = '';
      updateLcd();
    } else selectFrequencyType(index);
    return;
  }
  if (state.screen === 'chan-default' || state.screen === 'freq-default') {
    await handleDefaultSoftkey(index);
  }
}

async function handleAction(action) {
  if (state.screen === 'booting' && action !== 'noop') return;
  if (state.screen === 'menu' || state.screen === 'mode-select') resetContextTimerOnAction();

  if (action.startsWith('digit-')) {
    const digit = action.replace('digit-', '');
    if (state.screen === 'chan-function-display') {
      enterChannelSelectFromKeypad(digit);
    } else if (state.screen === 'freq-setup') {
      appendFrequencyDigit(digit);
    }
    return;
  }

  switch (action) {
    case 'menu':
      openMenu();
      break;
    case 'esc':
      state.freqSetup = null;
      leaveToDefault();
      break;
    case 'enter':
      if (state.screen === 'menu') enterMenuSelection();
      else if (state.screen === 'chan-function-display') await confirmChannelSelect();
      else if (state.screen === 'freq-setup') await confirmFrequencySetup();
      break;
    case 'up':
      if (state.screen === 'chan-default') await switchChannel(RadioCore.nextProgrammedChannel(currentChannel, 1, channelFreqs));
      else if (state.screen === 'menu') {
        state.menuCursor = (state.menuCursor + MENU_PAGES[state.menuPage].length - 1) % MENU_PAGES[state.menuPage].length;
        updateLcd();
      }
      break;
    case 'down':
      if (state.screen === 'chan-default') await switchChannel(RadioCore.nextProgrammedChannel(currentChannel, -1, channelFreqs));
      else if (state.screen === 'menu') {
        state.menuCursor = (state.menuCursor + 1) % MENU_PAGES[state.menuPage].length;
        updateLcd();
      }
      break;
    case 'right':
    case 'more':
      if (state.screen === 'chan-default' || state.screen === 'freq-default') {
        cycleChannelSoftkeys(1);
      } else if (state.screen === 'menu') {
        state.menuPage = (state.menuPage + 1) % MENU_PAGES.length;
        state.menuCursor = 0;
        updateLcd();
      }
      break;
    case 'left':
      if (state.screen === 'chan-default' || state.screen === 'freq-default') {
        cycleChannelSoftkeys(-1);
      } else if (state.screen === 'menu') {
        state.menuPage = (state.menuPage + MENU_PAGES.length - 1) % MENU_PAGES.length;
        state.menuCursor = 0;
        updateLcd();
      }
      break;
    case 'f1':
      await handleFKey(1);
      break;
    case 'f2':
      await handleFKey(2);
      break;
    case 'f3':
      await handleFKey(3);
      break;
    case 'f4':
      await handleFKey(4);
      break;
    case 'digit-dot':
      if (state.screen === 'freq-setup') appendFrequencyDecimal();
      break;
    case 'noop':
      break;
  }
}

powerKnob.addEventListener('click', async () => {
  await ensureAudioContext();
  if (audioContext && audioContext.state === 'suspended') await audioContext.resume();
  await powerToggle();
});
connectButton.addEventListener('click', async () => {
  await ensureAudioContext();
  if (audioContext && audioContext.state === 'suspended') await audioContext.resume();
  await powerToggle();
});

pttButton.addEventListener('mousedown', async () => {
  await ensureAudioContext();
  if (audioContext && audioContext.state === 'suspended') await audioContext.resume();
  setTransmitState(true);
});
pttButton.addEventListener('mouseup', () => setTransmitState(false));
pttButton.addEventListener('mouseleave', () => setTransmitState(false));
pttButton.addEventListener('touchstart', async (e) => {
  e.preventDefault();
  await ensureAudioContext();
  if (audioContext && audioContext.state === 'suspended') await audioContext.resume();
  setTransmitState(true);
}, { passive: false });
pttButton.addEventListener('touchend', () => setTransmitState(false));

hotspotButtons.forEach(btn => {
  btn.addEventListener('click', async () => {
    await ensureAudioContext();
    if (audioContext && audioContext.state === 'suspended') await audioContext.resume();
    await handleAction(btn.dataset.action);
  });
});

log('Manual-guided frequency build R8 loaded.');
renderPeers();
updateAudioRouting();
updateLcd();
