/**
 * Dev-only browser smoke test for frequency-lab.html.
 *
 * 1. Opens the page with ?selftest=1 and waits for the internal oscillator
 *    self-test to finish. This exercises AudioContext, both analysers, the
 *    peak detector and the readout without any capture permission.
 * 2. Opens the page with ?demo=440, lets the waterfall fill for five seconds,
 *    checks the UI readouts, and saves a preview screenshot.
 *
 * Run: node verify-ui.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333 + Math.floor(Math.random() * 400);
const PROFILE = mkdtempSync(path.join(tmpdir(), 'freqlab-chrome-'));
const HTML_PATH = path.resolve('frequency-lab.html');
const SHOT_PATH = path.resolve('freqlab-preview.png');
const MOBILE_SHOT_PATH = path.resolve('freqlab-preview-mobile.png');
const TONE_WAV = path.join(tmpdir(), 'freqlab-tone-440.wav');
const BROKEN_FILE = path.join(tmpdir(), 'freqlab-broken.mp4');
const GATED_WAV = path.join(tmpdir(), 'freqlab-tone-gated.wav');
let DOWNLOAD_DIR = '';
let PAGE_URL = '';
let server = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let chrome = null;
let ws = null;
let stderr = '';

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function writeToneWav(filePath, frequency = 440, seconds = 3, sampleRate = 48000, toneSeconds = seconds) {
  const sampleCount = Math.floor(seconds * sampleRate);
  const toneSamples = Math.min(sampleCount, Math.floor(toneSeconds * sampleRate));
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < sampleCount; i++) {
    const value = i < toneSamples
      ? Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.4 * 32767)
      : 0;
    buffer.writeInt16LE(value, 44 + i * 2);
  }
  writeFileSync(filePath, buffer);
}

function cleanup() {
  try { ws?.close(); } catch (error) { /* ignore */ }
  try { chrome?.kill('SIGKILL'); } catch (error) { /* ignore */ }
  try { server?.close(); } catch (error) { /* ignore */ }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (error) { /* ignore */ }
  try { rmSync(TONE_WAV, { force: true }); } catch (error) { /* ignore */ }
  try { rmSync(GATED_WAV, { force: true }); } catch (error) { /* ignore */ }
  try { rmSync(BROKEN_FILE, { force: true }); } catch (error) { /* ignore */ }
  if (DOWNLOAD_DIR) {
    try { rmSync(DOWNLOAD_DIR, { recursive: true, force: true }); } catch (error) { /* ignore */ }
  }
}

async function waitForJson(url, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const errors = [];
  let nextId = 1;

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      errors.push(details.exception?.description || details.text || 'runtime exception');
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      errors.push(message.params.entry.text);
    }
  };
  socket.onclose = () => {
    for (const entry of pending.values()) entry.reject(new Error('DevTools socket closed'));
    pending.clear();
  };
  socket.onerror = () => {
    for (const entry of pending.values()) entry.reject(new Error('DevTools socket error'));
    pending.clear();
  };

  const ready = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  const send = (method, params = {}) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  return { socket, ready, send, errors };
}

async function evaluate(send, expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'evaluation failed');
  }
  return response.result?.value;
}

async function navigateAndWait(send, url, expectedReadyExpression) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    try {
      const ready = await evaluate(send, expectedReadyExpression);
      if (ready) return;
    } catch (error) { /* page still loading */ }
  }
  throw new Error(`page did not become ready: ${expectedReadyExpression}`);
}

async function main() {
  writeToneWav(TONE_WAV);
  writeToneWav(GATED_WAV, 440, 3, 48000, 1);
  writeFileSync(BROKEN_FILE, Buffer.from('this is not a media file\n'.repeat(100)));
  DOWNLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'freqlab-downloads-'));
  const html = readFileSync(HTML_PATH);
  server = createServer((request, response) => {
    if (request.url && request.url.startsWith('/frequency-lab.html')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  PAGE_URL = `http://127.0.0.1:${server.address().port}/frequency-lab.html`;
  console.log(`Serving page at ${PAGE_URL}`);

  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--remote-allow-origins=*',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${TONE_WAV}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--hide-scrollbars',
    '--window-size=1440,1200',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  chrome.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const version = await waitForJson(`http://127.0.0.1:${PORT}/json/version`);
  console.log(`Chrome: ${version['Browser']}`);

  const targets = await waitForJson(`http://127.0.0.1:${PORT}/json/list`);
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('no page target found');

  const cdp = connectCdp(page.webSocketDebuggerUrl);
  await cdp.ready;
  ws = cdp.socket;
  const { send } = cdp;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  try {
    await send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD_DIR,
      eventsEnabled: true,
    });
  } catch (error) {
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });
  }
  console.log('CDP ready; running browser self-test...');

  // --- functional self-test -------------------------------------------------
  await navigateAndWait(send, `${PAGE_URL}?selftest=1`, '!!window.__freqLab');
  let result = null;
  for (let i = 0; i < 120; i++) {
    result = await evaluate(send, 'window.__selfTestResult || null');
    if (result) break;
    await sleep(250);
  }

  if (!result) {
    let status = 'unknown';
    let output = 'unknown';
    try {
      status = await evaluate(send, 'document.getElementById("status")?.textContent');
      output = await evaluate(send, 'document.getElementById("selfTestOut")?.textContent');
    } catch (error) { /* page may be gone */ }
    fail(`self-test never produced a result (status: ${JSON.stringify(status)}, output: ${JSON.stringify(output)})`);
    console.error(`Chrome stderr tail:\n${stderr.slice(-3000)}`);
  } else {
    for (const check of result.checks) {
      const measured = Number.isFinite(check.measured) ? `${check.measured.toFixed(2)} Hz` : 'no reading';
      console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.target ?? '—'} Hz → ${measured}`);
    }
    if (!result.ok) fail('self-test result was not ok');
    else console.log('PASS  browser self-test (440 / 432 / 528 Hz)');
  }

  // --- demo view + readout checks -------------------------------------------
  console.log('Self-test phase done; opening demo view...');
  await navigateAndWait(send, `${PAGE_URL}?demo=440`, '!!window.__freqLab');
  await sleep(5200);

  const demo = await evaluate(send, `(() => ({
    freq: document.getElementById('freq')?.textContent,
    note: document.getElementById('noteLine')?.textContent,
    verdict: document.getElementById('verdict')?.textContent,
    pct: document.getElementById('pct10')?.textContent,
    peaks: [...document.querySelectorAll('#peakRows tr')].map((row) => row.textContent.trim()),
    specPixels: (() => {
      const canvas = document.getElementById('spectrogram');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] + data[i + 1] + data[i + 2] > 40) lit++;
      }
      return lit;
    })(),
  }))()`);

  console.log(`  readout: ${demo.freq} Hz · ${demo.note}`);
  console.log(`  verdict: ${demo.verdict} · last 10 s ${demo.pct}`);
  console.log(`  peaks: ${demo.peaks.join(' | ')}`);
  console.log(`  spectrogram non-dark pixels: ${demo.specPixels}`);

  if (!demo.freq || !Number.isFinite(Number.parseFloat(demo.freq))) fail('no numeric frequency readout');
  else if (Math.abs(Number.parseFloat(demo.freq) - 440) > 0.2) fail(`demo readout not near 440 Hz (${demo.freq})`);
  else console.log('PASS  demo readout within 0.2 Hz of 440');

  if (demo.specPixels < 500) fail(`spectrogram looks empty (${demo.specPixels} lit pixels)`);
  else console.log('PASS  spectrogram is rendering');

  if (!/consistent/i.test(demo.verdict || '')) {
    fail(`target verdict was not "consistent" (${JSON.stringify(demo.verdict)})`);
  } else {
    console.log('PASS  target evidence consistent at 440 Hz');
  }

  console.log('Capturing screenshot...');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT_PATH, Buffer.from(shot.data, 'base64'));
  const bytes = readFileSync(SHOT_PATH);
  if (bytes.length < 10000) fail(`screenshot suspiciously small (${bytes.length} bytes)`);
  else console.log(`PASS  screenshot saved (${(bytes.length / 1024).toFixed(0)} KB) -> ${SHOT_PATH}`);

  console.log('Checking pause and resume...');
  const pauseBefore = await evaluate(send, 'window.__freqLab.state.fall.columns');
  await evaluate(send, 'document.getElementById("pauseBtn").click()');
  await sleep(400);
  const paused = await evaluate(send, `(() => ({
    columns: window.__freqLab.state.fall.columns,
    label: document.getElementById('pauseBtn')?.textContent,
  }))()`);
  if (paused.label !== 'Resume') fail(`pause button label was ${JSON.stringify(paused.label)}`);
  else if (paused.columns !== pauseBefore) fail('spectrogram kept scrolling while paused');
  else console.log('PASS  pause freezes the waterfall');
  await evaluate(send, 'document.getElementById("pauseBtn").click()');
  await sleep(400);
  const resumedColumns = await evaluate(send, 'window.__freqLab.state.fall.columns');
  if (!(resumedColumns > paused.columns)) fail('spectrogram did not resume');
  else console.log('PASS  resume continues the waterfall');

  console.log('Checking invalid-target handling...');
  await evaluate(send, `(() => {
    const input = document.getElementById('targetInput');
    input.value = '99999';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const invalid = await evaluate(send, `(() => ({
    verdict: document.getElementById('verdict')?.textContent,
    aria: document.getElementById('targetInput')?.getAttribute('aria-invalid'),
  }))()`);
  if (invalid.aria !== 'true' || !/set target/i.test(invalid.verdict || '')) {
    fail(`invalid target was not rejected (${JSON.stringify(invalid)})`);
  } else {
    console.log('PASS  invalid target is rejected');
  }
  await evaluate(send, `(() => {
    const input = document.getElementById('targetInput');
    input.value = '440';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const desktopOverflow = await evaluate(send, 'document.documentElement.scrollWidth - window.innerWidth');
  if (desktopOverflow > 1) fail(`desktop layout overflows by ${desktopOverflow}px`);
  else console.log('PASS  desktop layout has no horizontal overflow');

  console.log('Checking mobile layout...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await navigateAndWait(send, `${PAGE_URL}?demo=440`, '!!window.__freqLab');
  await sleep(3000);
  const mobile = await evaluate(send, `(() => ({
    width: window.innerWidth,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    hzFont: getComputedStyle(document.getElementById('freq')).fontSize,
    side: getComputedStyle(document.querySelector('.side')).gridTemplateColumns,
  }))()`);
  console.log(`  mobile ${mobile.width}px · readout ${mobile.hzFont} · side ${mobile.side} · overflow ${mobile.overflow}px`);
  if (mobile.overflow > 1) fail(`mobile layout overflows by ${mobile.overflow}px`);
  else console.log('PASS  mobile layout has no horizontal overflow');
  const mobileShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(MOBILE_SHOT_PATH, Buffer.from(mobileShot.data, 'base64'));
  console.log(`PASS  mobile screenshot saved -> ${MOBILE_SHOT_PATH}`);
  await send('Emulation.clearDeviceMetricsOverride');

  // --- microphone path (fake device fed by the generated 440 Hz WAV) -------
  console.log('Testing microphone capture with a fake 440 Hz device...');
  await navigateAndWait(send, PAGE_URL, '!!window.__freqLab');
  await sleep(300);
  await evaluate(send, 'document.getElementById("micBtn").click()');
  await sleep(1800);
  const mic = await evaluate(send, `(() => ({
    freq: document.getElementById('freq')?.textContent,
    status: document.getElementById('status')?.textContent,
    specPixels: (() => {
      const canvas = document.getElementById('spectrogram');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] + data[i + 1] + data[i + 2] > 40) lit++;
      }
      return lit;
    })(),
  }))()`);
  const micHz = Number.parseFloat(mic.freq);
  console.log(`  mic readout: ${mic.freq} Hz · ${mic.status}`);
  if (!Number.isFinite(micHz) || Math.abs(micHz - 440) > 1) {
    fail(`microphone path did not read 440 Hz (${mic.freq})`);
  } else {
    console.log('PASS  microphone path reads 440 Hz');
  }
  if (mic.specPixels < 400) fail(`microphone spectrogram looks empty (${mic.specPixels})`);
  await evaluate(send, 'document.getElementById("stopBtn").click()');
  await sleep(300);
  const micStopped = await evaluate(send, 'document.getElementById("stopBtn").disabled && document.getElementById("freq").textContent === "—"');
  if (!micStopped) fail('microphone stop did not reset the readout');
  else console.log('PASS  microphone stop resets cleanly');

  // --- local file path ------------------------------------------------------
  console.log('Testing local file analysis with the same WAV...');
  await navigateAndWait(send, PAGE_URL, '!!window.__freqLab');
  await sleep(300);
  await send('DOM.enable');
  const documentNode = await send('DOM.getDocument', { depth: -1 });
  const fileNode = await send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector: '#fileInput',
  });
  await send('DOM.setFileInputFiles', { files: [GATED_WAV], nodeId: fileNode.nodeId });
  await evaluate(send, 'document.getElementById("fileInput").dispatchEvent(new Event("change", { bubbles: true }))');
  await sleep(900);
  const fileResult = await evaluate(send, `(() => ({
    freq: document.getElementById('freq')?.textContent,
    status: document.getElementById('status')?.textContent,
    playerHidden: document.getElementById('playerWrap')?.hidden,
    fileName: document.getElementById('fileName')?.textContent,
  }))()`);
  const fileHz = Number.parseFloat(fileResult.freq);
  console.log(`  file readout: ${fileResult.freq} Hz · ${fileResult.fileName} · ${fileResult.status}`);
  if (fileResult.playerHidden) fail('file player was not shown');
  else if (!Number.isFinite(fileHz) || Math.abs(fileHz - 440) > 1) {
    fail(`file path did not read 440 Hz (${fileResult.freq})`);
  } else {
    console.log('PASS  local file path reads 440 Hz');
  }
  console.log('Checking CSV/PNG export...');
  await evaluate(send, 'document.getElementById("exportCsv").click()');
  await evaluate(send, 'document.getElementById("exportPng").click()');
  let downloads = [];
  for (let i = 0; i < 30; i++) {
    downloads = readdirSync(DOWNLOAD_DIR);
    if (downloads.some((name) => name.endsWith('.csv')) && downloads.some((name) => name.endsWith('.png'))) break;
    await sleep(200);
  }
  const csvName = downloads.find((name) => name.endsWith('.csv'));
  const pngName = downloads.find((name) => name.endsWith('.png'));
  if (!csvName) {
    fail(`CSV export did not download (${downloads.join(', ') || 'empty directory'})`);
  } else {
    const lines = readFileSync(path.join(DOWNLOAD_DIR, csvName), 'utf8').trim().split('\n');
    if (!lines[0].startsWith('t_s,') || lines.length < 2) {
      fail(`CSV export looks wrong (${lines.length} lines)`);
    } else {
      console.log(`PASS  CSV export (${lines.length - 1} rows)`);
    }
  }
  if (!pngName) {
    fail('PNG export did not download');
  } else {
    const size = readFileSync(path.join(DOWNLOAD_DIR, pngName)).length;
    if (size < 10000) fail(`PNG export suspiciously small (${size} bytes)`);
    else console.log(`PASS  PNG export (${(size / 1024).toFixed(0)} KB)`);
  }

  console.log('Checking that silence clears the live readout...');
  await sleep(1500);
  const silence = await evaluate(send, `(() => ({
    freq: document.getElementById('freq')?.textContent,
    verdict: document.getElementById('verdict')?.textContent,
    note: document.getElementById('noteLine')?.textContent,
  }))()`);
  console.log(`  silence readout: ${silence.freq} · ${silence.verdict} · ${silence.note}`);
  if (silence.freq !== '—') fail(`silence left a stale frequency (${silence.freq})`);
  else if (!/no signal/i.test(silence.verdict || '')) fail(`silence did not report no signal (${silence.verdict})`);
  else console.log('PASS  silence clears the readout and target state');

  console.log('Checking playback end reset...');
  await sleep(1300);
  const ended = await evaluate(send, `(() => ({
    status: document.getElementById('status')?.textContent,
    sessionSignal: window.__freqLab.state.sessionSignal,
    freq: document.getElementById('freq')?.textContent,
  }))()`);
  if (!/Playback ended/.test(ended.status || '')) {
    fail(`playback end was not reported (${ended.status})`);
  } else if (ended.sessionSignal !== 0) {
    fail(`playback end did not reset evidence (${ended.sessionSignal})`);
  } else {
    console.log('PASS  playback end resets evidence');
  }

  await evaluate(send, 'document.getElementById("stopBtn").click()');
  await sleep(300);
  const fileStopped = await evaluate(send, 'document.getElementById("playerWrap").hidden && document.getElementById("freq").textContent === "—"');
  if (!fileStopped) fail('file stop did not hide the player and reset the readout');
  else console.log('PASS  file stop cleans up');

  console.log('Checking idle redraw after resize...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(500);
  const idle = await evaluate(send, `(() => {
    const canvas = document.getElementById('spectrum');
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 25) lit++;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      lit,
      fallVisible: !!window.__freqLab.state.fall,
    };
  })()`);
  if (!idle.width || idle.lit < 100) fail(`idle spectrum did not redraw after resize (${idle.lit} lit pixels)`);
  else if (idle.fallVisible) fail('stopped session kept a spectrogram texture');
  else console.log('PASS  idle grids redraw after resize');
  await send('Emulation.clearDeviceMetricsOverride');

  console.log('Testing corrupt file handling...');
  const errorCountBeforeBroken = cdp.errors.length;
  await navigateAndWait(send, PAGE_URL, '!!window.__freqLab');
  await sleep(300);
  const brokenDocument = await send('DOM.getDocument', { depth: -1 });
  const brokenFileNode = await send('DOM.querySelector', {
    nodeId: brokenDocument.root.nodeId,
    selector: '#fileInput',
  });
  await send('DOM.setFileInputFiles', { files: [BROKEN_FILE], nodeId: brokenFileNode.nodeId });
  await evaluate(send, 'document.getElementById("fileInput").dispatchEvent(new Event("change", { bubbles: true }))');
  await sleep(1400);
  const broken = await evaluate(send, `(() => ({
    status: document.getElementById('status')?.textContent,
    stopDisabled: document.getElementById('stopBtn')?.disabled,
    playerHidden: document.getElementById('playerWrap')?.hidden,
    freq: document.getElementById('freq')?.textContent,
  }))()`);
  if (!/decod|could not|unsupported/i.test(broken.status || '')) {
    fail(`corrupt file was not reported (${broken.status})`);
  } else if (!broken.stopDisabled || !broken.playerHidden || broken.freq !== '—') {
    fail('corrupt file left a running session');
  } else {
    console.log('PASS  corrupt file is rejected and cleaned up');
  }
  // The browser logs its own decode error for this intentional case; it is not an app exception.
  cdp.errors.length = errorCountBeforeBroken;

  // --- file:// guidance ----------------------------------------------------
  console.log('Checking file:// guidance...');
  await navigateAndWait(send, pathToFileURL(HTML_PATH).href, '!!window.__freqLab');
  await sleep(300);
  const filePage = await evaluate(send, `(() => ({
    noticeHidden: document.getElementById('protocolNotice')?.hidden,
    noticeText: document.getElementById('protocolNotice')?.textContent,
  }))()`);
  if (filePage.noticeHidden !== false || !/localhost/.test(filePage.noticeText || '')) {
    fail('file:// notice was not shown');
  } else {
    console.log('PASS  file:// shows local-server guidance');
  }
  await evaluate(send, 'document.getElementById("micBtn").click()');
  await sleep(200);
  const guardedMic = await evaluate(send, `(() => ({
    status: document.getElementById('status')?.textContent,
    freq: document.getElementById('freq')?.textContent,
    stopDisabled: document.getElementById('stopBtn')?.disabled,
  }))()`);
  if (!/localhost/.test(guardedMic.status || '')) {
    fail(`file:// microphone click did not explain the protocol (${guardedMic.status})`);
  } else if (guardedMic.freq !== '—' || guardedMic.stopDisabled !== true) {
    fail('file:// microphone click started an unexpected session');
  } else {
    console.log('PASS  file:// microphone click is guarded with guidance');
  }

  if (cdp.errors.length) {
    console.error('Page errors:');
    for (const error of cdp.errors) console.error(`  ${error}`);
    fail('page reported runtime errors');
  } else {
    console.log('PASS  no runtime errors reported');
  }
}

main()
  .catch((error) => {
    fail(error.stack || error.message);
    if (typeof stderr === 'string') console.error(`Chrome stderr tail:\n${stderr.slice(-3000)}`);
  })
  .finally(() => {
    cleanup();
    setTimeout(() => process.exit(process.exitCode || 0), 400);
  });
