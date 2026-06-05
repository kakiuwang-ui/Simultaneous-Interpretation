// 前端逻辑
// -----------------------------------------------------------
// 混合 ASR 模式:
//   服务器配置了 ASR_API_KEY → 服务器端 Whisper ASR
//   未配置 → 浏览器 Web Speech API (需 Chrome + 可访问 Google)
// 音频始终通过 getUserMedia 采集,用于频谱显示 + 服务器 ASR

const $ = (id) => document.getElementById(id);
const sourceEl = $('source');
const targetEl = $('target');
const statusEl = $('status');
const statusPill = $('statusPill');

let ws = null;
let mediaStream = null;
let audioCtx = null;
let analyser = null;
let scriptNode = null;
let animFrameId = null;
let recognition = null;
let asrMode = 'server'; // 'server' or 'browser'
let ttsEnabled = false;
let ttsQueue = [];
let ttsSpeaking = false;
let ttsMode = 'browser'; // 'server' or 'browser'
let pendingTTSAudio = null; // 等待接收的服务器 TTS 音频信息

const sourceLines = new Map();
const targetLines = new Map();

let currentSegId = 0;

// 翻译方向
let direction = 'en2zh';

const LANG_CONFIG = {
  en2zh: { asrLang: 'en-US', fromLabel: 'EN', toLabel: '中文', sourceLang: 'English', targetLang: '中文', hint: '请说英文...' },
  zh2en: { asrLang: 'zh-CN', fromLabel: '中文', toLabel: 'EN', sourceLang: '中文', targetLang: 'English', hint: '请说中文...' },
};

function updateLangUI() {
  const cfg = LANG_CONFIG[direction];
  $('langFrom').textContent = cfg.fromLabel;
  $('langTo').textContent = cfg.toLabel;
  $('sourceLang').textContent = cfg.sourceLang;
  $('targetLang').textContent = cfg.targetLang;
  $('langToggle').classList.toggle('reversed', direction === 'zh2en');
}

function toggleDirection() {
  direction = direction === 'en2zh' ? 'zh2en' : 'en2zh';
  updateLangUI();
}

function setStatus(s, live = false) {
  statusEl.textContent = s;
  statusPill.classList.toggle('live', live);
}

function markActive(paneEl) { paneEl.closest('.pane').classList.add('has-content'); }

function connectWS() {
  return new Promise((resolve) => {
    ws = new WebSocket(`ws://${location.host}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { setStatus('已连接'); resolve(); };
    ws.onclose = () => setStatus('连接已关闭');
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        // 服务器 TTS 音频(mp3)
        if (ttsEnabled && pendingTTSAudio) {
          playAudioBuffer(e.data);
          pendingTTSAudio = null;
        }
        return;
      }
      handleMessage(JSON.parse(e.data));
    };
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'ready':
      asrMode = msg.asrMode || 'server';
      ttsMode = msg.ttsMode || 'browser';
      setStatus('实时翻译中', true);
      $('modeLabel').textContent = `${msg.mode}`;
      $('hint').textContent = '正在监听语音,字幕将实时出现并自动修正';
      // 如果是浏览器 ASR 模式,启动 Web Speech API
      if (asrMode === 'browser') {
        startBrowserASR();
      }
      break;
    case 'asr_partial':
      renderSource(msg.id, msg.committed, msg.pending, false);
      break;
    case 'asr_final':
      renderSource(msg.id, msg.text, '', true);
      break;
    case 'translation':
      renderTarget(msg.id, msg.target, false);
      // 浏览器 TTS(仅当服务器没配 TTS 时)
      if (ttsMode !== 'server') speakText(msg.target);
      break;
    case 'correction':
      renderTarget(msg.id, msg.target, true);
      break;
    case 'tts_audio':
      // 服务器即将发送音频二进制数据
      pendingTTSAudio = msg;
      break;
  }
}

function renderSource(id, committed, pending, isFinal) {
  let rec = sourceLines.get(id);
  if (!rec) {
    const el = document.createElement('div');
    el.className = 'line';
    const committedEl = document.createElement('span');
    committedEl.className = 'committed';
    const pendingEl = document.createElement('span');
    pendingEl.className = 'pending';
    el.append(committedEl, document.createTextNode(' '), pendingEl);
    sourceEl.appendChild(el);
    markActive(sourceEl);
    rec = { el, committedEl, pendingEl };
    sourceLines.set(id, rec);
  }
  rec.committedEl.textContent = committed || '';
  rec.pendingEl.textContent = pending ? ' ' + pending : '';
  rec.el.classList.toggle('is-final', isFinal);
  scroll(sourceEl);
}

function renderTarget(id, text, isCorrection) {
  let rec = targetLines.get(id);
  if (!rec) {
    const el = document.createElement('div');
    el.className = 'line';
    const textEl = document.createElement('span');
    textEl.className = 'committed';
    el.appendChild(textEl);
    targetEl.appendChild(el);
    markActive(targetEl);
    rec = { el, textEl };
    targetLines.set(id, rec);
  }
  rec.textEl.textContent = text;
  if (isCorrection) {
    rec.el.classList.add('flash-correct');
    if (!rec.el.querySelector('.corrected-tag')) {
      const tag = document.createElement('span');
      tag.className = 'corrected-tag';
      tag.textContent = '已修正';
      rec.el.appendChild(tag);
    }
    setTimeout(() => rec.el.classList.remove('flash-correct'), 1600);
  }
  scroll(targetEl);
}

function scroll(el) { el.scrollTop = el.scrollHeight; }

// ---------- TTS 语音播报 ----------
let voicesLoaded = false;
let zhVoice = null;
let enVoice = null;

function loadVoices() {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return;
  voicesLoaded = true;
  // 优先选择本地中文语音
  zhVoice = voices.find(v => v.lang === 'zh-CN' && v.localService) ||
            voices.find(v => v.lang.startsWith('zh')) ||
            voices.find(v => v.name.includes('Chinese') || v.name.includes('中文'));
  enVoice = voices.find(v => v.lang === 'en-US' && v.localService) ||
            voices.find(v => v.lang.startsWith('en'));
  console.log('[TTS] 中文语音:', zhVoice?.name, '英文语音:', enVoice?.name);
}
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

// 语音样本（用于服务器端声音克隆）
let voiceSampleSent = false;
let voiceSampleBuffer = [];
let voiceSampleSize = 0;
const VOICE_SAMPLE_DURATION = 5; // 采集5秒作为参考音频
const VOICE_SAMPLE_RATE = 16000;
const VOICE_SAMPLE_TOTAL = VOICE_SAMPLE_RATE * VOICE_SAMPLE_DURATION;

function collectVoiceSample(pcm16) {
  if (voiceSampleSent || !ws || ws.readyState !== WebSocket.OPEN) return;
  voiceSampleBuffer.push(pcm16);
  voiceSampleSize += pcm16.length;
  if (voiceSampleSize >= VOICE_SAMPLE_TOTAL) {
    // 合并所有 PCM 块
    const merged = new Int16Array(voiceSampleSize);
    let offset = 0;
    for (const chunk of voiceSampleBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    // 截取刚好 5 秒
    const sample = merged.slice(0, VOICE_SAMPLE_TOTAL);
    // 发送给服务器
    ws.send(JSON.stringify({ type: 'voice_sample', sampleRate: VOICE_SAMPLE_RATE, samples: VOICE_SAMPLE_TOTAL }));
    ws.send(sample.buffer);
    voiceSampleSent = true;
    voiceSampleBuffer = [];
    console.log('[TTS] 语音样本已发送 (5秒)');
  }
}

function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  $('ttsBtn').classList.toggle('active', ttsEnabled);
  if (!ttsEnabled) {
    speechSynthesis.cancel();
    ttsQueue = [];
    ttsSpeaking = false;
  }
}

function speakText(text) {
  if (!ttsEnabled || !text) return;
  ttsQueue.push(text);
  if (!ttsSpeaking) processQueue();
}

function processQueue() {
  if (ttsQueue.length === 0) { ttsSpeaking = false; return; }
  ttsSpeaking = true;
  const text = ttsQueue.shift();

  const utter = new SpeechSynthesisUtterance(text);
  if (direction === 'en2zh') {
    utter.lang = 'zh-CN';
    utter.rate = 1.1;
    if (zhVoice) utter.voice = zhVoice;
  } else {
    utter.lang = 'en-US';
    utter.rate = 1.0;
    if (enVoice) utter.voice = enVoice;
  }
  utter.volume = 1;
  utter.onend = () => processQueue();
  utter.onerror = () => processQueue();
  speechSynthesis.speak(utter);
}

function playAudioBuffer(arrayBuf) {
  const blob = new Blob([arrayBuf], { type: 'audio/mp3' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  audio.play().catch(() => {});
}

// ---------- 音频频谱可视化 ----------
function setupSpectrum() {
  const canvas = $('spectrumCanvas');
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext('2d');
  const bufLen = analyser.frequencyBinCount;
  const dataArr = new Uint8Array(bufLen);

  function draw() {
    animFrameId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArr);

    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    const bars = Math.min(64, bufLen);
    const barW = w / bars;
    const gap = 1 * devicePixelRatio;

    for (let i = 0; i < bars; i++) {
      const val = dataArr[i] / 255;
      const barH = val * h * 0.9;
      const x = i * barW;
      const opacity = 0.3 + val * 0.7;
      ctx.fillStyle = `rgba(232, 232, 232, ${opacity})`;
      ctx.fillRect(x + gap / 2, h - barH, barW - gap, barH);
    }
  }
  draw();
}

function stopSpectrum() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}

// ---------- 降采样 PCM ----------
function downsampleToPCM16(buffer, inRate, outRate) {
  const ratio = inRate / outRate;
  const outLen = Math.floor(buffer.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s = Math.max(-1, Math.min(1, buffer[Math.floor(i * ratio)]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// ---------- 浏览器 Web Speech API (fallback) ----------
function startBrowserASR() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('hint').textContent = '浏览器不支持语音识别,请配置 ASR_API_KEY 或使用 Chrome';
    return;
  }

  const langCfg = LANG_CONFIG[direction];
  currentSegId = 0;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = langCfg.asrLang;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;
      if (!text.trim()) continue;

      if (result.isFinal) {
        currentSegId++;
        ws.send(JSON.stringify({ type: 'asr_final', id: currentSegId, text }));
      } else {
        ws.send(JSON.stringify({ type: 'asr_interim', id: currentSegId + 1, text }));
      }
    }
  };

  recognition.onerror = (event) => {
    console.warn('[ASR] 浏览器ASR错误:', event.error);
    if (event.error === 'not-allowed') {
      $('hint').textContent = '麦克风权限被拒绝';
    } else if (event.error === 'network') {
      $('hint').textContent = '浏览器语音识别网络错误(可能被墙),请配置 ASR_API_KEY';
    }
  };

  recognition.onend = () => {
    if ($('stopBtn').disabled === false) {
      try { recognition.start(); } catch (e) { /* ignore */ }
    }
  };

  recognition.start();
}

// ---------- 麦克风采集 + 发送 ----------
async function startCapture() {
  clearSubtitles();
  await connectWS();
  ws.send(JSON.stringify({ type: 'start', direction }));

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    setStatus('麦克风不可用');
    $('hint').textContent = '请允许浏览器访问麦克风';
    return;
  }

  // 建立音频处理链
  audioCtx = new AudioContext();
  const src = audioCtx.createMediaStreamSource(mediaStream);

  // 分析器(频谱)
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.75;
  src.connect(analyser);

  // ScriptProcessor 采集并降采样发送(服务器 ASR 需要)
  scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
  src.connect(scriptNode);
  scriptNode.connect(audioCtx.destination);

  const inRate = audioCtx.sampleRate;
  scriptNode.onaudioprocess = (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    const pcm16 = downsampleToPCM16(input, inRate, 16000);
    ws.send(pcm16.buffer);
    // 采集前5秒作为声音克隆参考
    collectVoiceSample(pcm16);
  };

  setupSpectrum();
  toggleButtons(true);
  const langCfg = LANG_CONFIG[direction];
  $('hint').textContent = `正在通过麦克风收音,${langCfg.hint}`;
}

// ---------- 文件上传 ----------
let fileAbort = null;

async function startFileUpload(file) {
  clearSubtitles();
  const bar = $('uploadBar');
  const nameEl = $('uploadName');
  const statusEl2 = $('uploadStatus');
  const fill = $('progressFill');

  bar.hidden = false;
  nameEl.textContent = file.name;
  statusEl2.textContent = '解码中...';
  fill.style.width = '0%';

  await connectWS();
  ws.send(JSON.stringify({ type: 'start', mode: 'file', filename: file.name, direction }));

  // 解码音频文件
  let audioBuffer;
  try {
    const arrayBuf = await file.arrayBuffer();
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 16000);
    audioBuffer = await offlineCtx.decodeAudioData(arrayBuf);
  } catch (err) {
    statusEl2.textContent = '解码失败: ' + err.message;
    return;
  }

  // 降采样为 16kHz PCM16
  const inRate = audioBuffer.sampleRate;
  const inData = audioBuffer.getChannelData(0);
  const pcm16 = downsampleToPCM16(inData, inRate, 16000);

  // 分块发送
  const chunkSize = 1600;
  const totalChunks = Math.ceil(pcm16.length / chunkSize);
  let cancelled = false;
  fileAbort = () => { cancelled = true; };

  toggleButtons(true);
  statusEl2.textContent = '发送中...';

  for (let i = 0; i < totalChunks; i++) {
    if (cancelled) break;
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, pcm16.length);
    const chunk = pcm16.slice(start, end);
    ws.send(chunk.buffer);

    const pct = Math.round(((i + 1) / totalChunks) * 100);
    fill.style.width = pct + '%';
    statusEl2.textContent = `${pct}%`;

    await new Promise((r) => setTimeout(r, 50));
  }

  if (!cancelled) {
    fill.style.width = '100%';
    statusEl2.textContent = '已完成';
    ws.send(JSON.stringify({ type: 'file_done' }));
  } else {
    statusEl2.textContent = '已取消';
  }
  fileAbort = null;
}

function clearSubtitles() {
  sourceEl.innerHTML = '';
  targetEl.innerHTML = '';
  sourceLines.clear();
  targetLines.clear();
  sourceEl.closest('.pane').classList.remove('has-content');
  targetEl.closest('.pane').classList.remove('has-content');
}

function toggleButtons(running) {
  $('startBtn').disabled = running;
  $('uploadBtn').classList.toggle('disabled', running);
  $('fileInput').disabled = running;
  $('stopBtn').disabled = !running;
}

function stop() {
  if (fileAbort) fileAbort();
  if (recognition) { try { recognition.stop(); } catch(e) {} recognition = null; }
  if (scriptNode) { scriptNode.disconnect(); scriptNode = null; }
  stopSpectrum();
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  analyser = null;
  if (ws) ws.close();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  speechSynthesis.cancel();
  ttsQueue = [];
  ttsSpeaking = false;
  voiceSampleSent = false;
  voiceSampleBuffer = [];
  voiceSampleSize = 0;
  toggleButtons(false);
  setStatus('已停止');
}

$('startBtn').onclick = startCapture;
$('stopBtn').onclick = stop;
$('ttsBtn').onclick = toggleTTS;
$('langToggle').onclick = toggleDirection;
updateLangUI();
$('fileInput').onchange = (e) => {
  const file = e.target.files[0];
  if (file) startFileUpload(file);
  e.target.value = '';
};
