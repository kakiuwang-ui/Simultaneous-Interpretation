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
let isFileMode = false; // 文件模式下禁用轮播

// 翻译方向
let direction = 'en2zh';

const LANG_CONFIG = {
  en2zh: { asrLang: 'en-US', fromLabel: 'EN', toLabel: '中文', sourceLang: 'English', targetLang: '中文', hint: '请说英文...' },
  zh2en: { asrLang: 'zh-CN', fromLabel: '中文', toLabel: 'EN', sourceLang: '中文', targetLang: 'English', hint: '请说中文...' },
  ja2zh: { asrLang: 'ja', fromLabel: '日本語', toLabel: '中文', sourceLang: '日本語', targetLang: '中文', hint: '日本語で話してください...' },
  zh2ja: { asrLang: 'zh-CN', fromLabel: '中文', toLabel: '日本語', sourceLang: '中文', targetLang: '日本語', hint: '请说中文...' },
  ko2zh: { asrLang: 'ko', fromLabel: '한국어', toLabel: '中文', sourceLang: '한국어', targetLang: '中文', hint: '한국어로 말해주세요...' },
  zh2ko: { asrLang: 'zh-CN', fromLabel: '中文', toLabel: '한국어', sourceLang: '中文', targetLang: '한국어', hint: '请说中文...' },
  en2ja: { asrLang: 'en-US', fromLabel: 'EN', toLabel: '日本語', sourceLang: 'English', targetLang: '日本語', hint: 'Speak English...' },
  ja2en: { asrLang: 'ja', fromLabel: '日本語', toLabel: 'EN', sourceLang: '日本語', targetLang: 'English', hint: '日本語で話してください...' },
  en2ko: { asrLang: 'en-US', fromLabel: 'EN', toLabel: '한국어', sourceLang: 'English', targetLang: '한국어', hint: 'Speak English...' },
  ko2en: { asrLang: 'ko', fromLabel: '한국어', toLabel: 'EN', sourceLang: '한국어', targetLang: 'English', hint: '한국어로 말해주세요...' },
  ja2ko: { asrLang: 'ja', fromLabel: '日本語', toLabel: '한국어', sourceLang: '日本語', targetLang: '한국어', hint: '日本語で話してください...' },
  ko2ja: { asrLang: 'ko', fromLabel: '한국어', toLabel: '日本語', sourceLang: '한국어', targetLang: '日本語', hint: '한국어로 말해주세요...' },
};

// 语言代码 → 显示名
const LANG_LABELS = { en: 'English', zh: '中文', ja: '日本語', ko: '한국어' };

function deriveDirection() {
  const from = $('langFrom').value;
  const to = $('langTo').value;
  const key = from + '2' + to;
  if (LANG_CONFIG[key]) {
    direction = key;
  }
}

function updateLangUI() {
  deriveDirection();
  const cfg = LANG_CONFIG[direction];
  if (!cfg) return;
  $('sourceLang').textContent = cfg.sourceLang;
  $('targetLang').textContent = cfg.targetLang;
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
      if (msg.startTime != null) {
        segTimestamps.set(msg.id, { start: msg.startTime, end: msg.endTime });
      }
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

// 每段字幕的时间戳 (文件模式用)
const segTimestamps = new Map(); // id -> { start, end } (秒)

function renderSource(id, committed, pending, isFinal) {
  let rec = sourceLines.get(id);
  if (!rec) {
    const el = document.createElement('div');
    el.className = 'line';
    el.dataset.segId = id;
    const committedEl = document.createElement('span');
    committedEl.className = 'committed';
    const pendingEl = document.createElement('span');
    pendingEl.className = 'pending';
    el.append(committedEl, document.createTextNode(' '), pendingEl);
    sourceEl.appendChild(el);
    markActive(sourceEl);
    rec = { el, committedEl, pendingEl };
    sourceLines.set(id, rec);

    // 双击编辑原文
    el.addEventListener('dblclick', () => startEditSource(id));
  }
  rec.committedEl.textContent = committed || '';
  rec.pendingEl.textContent = pending ? ' ' + pending : '';
  rec.el.classList.toggle('is-final', isFinal);
  carouselUpdate(sourceEl, sourceLines);
}

function startEditSource(id) {
  const rec = sourceLines.get(id);
  if (!rec) return;
  const el = rec.el;
  const oldText = rec.committedEl.textContent;

  // 已在编辑中则跳过
  if (el.querySelector('.edit-input')) return;

  // 隐藏原内容，显示输入框
  rec.committedEl.hidden = true;
  rec.pendingEl.hidden = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-input';
  input.value = oldText;
  el.appendChild(input);
  input.focus();
  input.select();

  const finish = () => {
    const newText = input.value.trim();
    input.remove();
    rec.committedEl.hidden = false;
    rec.pendingEl.hidden = false;

    if (!newText) {
      // 空文本 = 删除这一行
      deleteSegment(id);
    } else if (newText !== oldText) {
      rec.committedEl.textContent = newText;
      rec.pendingEl.textContent = '';
      // 发送重新翻译请求
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'retranslate', id, text: newText }));
      }
    }
  };

  input.addEventListener('blur', finish, { once: true });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = oldText; input.blur(); }
  });
}

function deleteSegment(id) {
  const srcRec = sourceLines.get(id);
  if (srcRec) { srcRec.el.remove(); sourceLines.delete(id); }
  const tgtRec = targetLines.get(id);
  if (tgtRec) { tgtRec.el.remove(); targetLines.delete(id); }
  segTimestamps.delete(id);
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
  carouselUpdate(targetEl, targetLines);
}

// ---------- 轮播字幕：只显示最近 N 条 ----------
const CAROUSEL_MAX = 1; // 只显示当前一条

function carouselShowAround(centerId, containerEl, linesMap) {
  const ids = [...linesMap.keys()];
  const centerIdx = ids.indexOf(centerId);
  if (centerIdx === -1) return;
  for (let i = 0; i < ids.length; i++) {
    const rec = linesMap.get(ids[i]);
    if (!rec) continue;
    // 隐藏已过的（当前之前的），显示当前及之后的
    if (i < centerIdx) {
      rec.el.classList.add('carousel-hide');
    } else {
      rec.el.classList.remove('carousel-hide');
    }
  }
}

function carouselUpdate(containerEl, linesMap) {
  // 实时模式和文件模式都滚动到底部，显示所有句子
  containerEl.scrollTop = containerEl.scrollHeight;
}

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
  isFileMode = false;
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
  isFileMode = true;
  clearSubtitles();
  const bar = $('uploadBar');
  const nameEl = $('uploadName');
  const statusEl2 = $('uploadStatus');
  const fill = $('progressFill');

  bar.hidden = false;
  nameEl.textContent = file.name;
  fill.style.width = '0%';

  // 视频预览
  const preview = $('videoPreview');
  const player = $('previewPlayer');
  if (file.type.startsWith('video/')) {
    const url = URL.createObjectURL(file);
    player.src = url;
    preview.hidden = false;
    // 不自动播放,等处理完后用户手动播放
    player.ontimeupdate = () => syncSubtitlesWithVideo(player.currentTime);
    // 暂停时恢复所有行可见
    player.onpause = () => {
      for (const [, rec] of sourceLines) rec.el.classList.remove('carousel-hide');
      for (const [, rec] of targetLines) rec.el.classList.remove('carousel-hide');
    };
  } else {
    preview.hidden = true;
    player.src = '';
  }

  // 上传文件到服务端,由 ffmpeg 转码
  statusEl2.textContent = '上传中...';
  toggleButtons(true);

  let cancelled = false;
  const abortCtrl = new AbortController();
  fileAbort = () => { cancelled = true; abortCtrl.abort(); };

  let pcm16;
  try {
    const resp = await fetch('/upload', {
      method: 'POST',
      body: file,
      signal: abortCtrl.signal,
    });
    if (!resp.ok) {
      statusEl2.textContent = '转码失败: ' + await resp.text();
      toggleButtons(false);
      return;
    }
    const buf = await resp.arrayBuffer();
    pcm16 = new Int16Array(buf);
  } catch (err) {
    if (cancelled) { statusEl2.textContent = '已取消'; }
    else { statusEl2.textContent = '上传失败: ' + err.message; }
    toggleButtons(false);
    return;
  }

  statusEl2.textContent = '发送中...';
  await connectWS();
  ws.send(JSON.stringify({ type: 'start', mode: 'file', filename: file.name, direction }));

  // 分块发送 PCM 到 WebSocket ASR
  // 每次发 8000 samples (0.5秒), 间隔 100ms
  const chunkSize = 8000;
  const totalChunks = Math.ceil(pcm16.length / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    if (cancelled) break;
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, pcm16.length);
    const chunk = pcm16.slice(start, end);
    // .slice() 返回新 TypedArray, 其 .buffer 是独立的副本
    ws.send(chunk.buffer);

    const pct = Math.round(((i + 1) / totalChunks) * 100);
    fill.style.width = pct + '%';
    statusEl2.textContent = `${pct}%`;

    await new Promise((r) => setTimeout(r, 100));
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

// ---------- 视频字幕同步 ----------
let activeSegId = null;

function syncSubtitlesWithVideo(currentTime) {
  let matchId = null;
  let nearestId = null;
  let nearestDist = Infinity;
  for (const [id, ts] of segTimestamps) {
    if (currentTime >= ts.start && currentTime < ts.end) {
      matchId = id;
      break;
    }
    // 找最近的已过段（用于间隙时显示）
    if (currentTime >= ts.start) {
      const dist = currentTime - ts.end;
      if (dist >= 0 && dist < nearestDist) {
        nearestDist = dist;
        nearestId = id;
      }
    }
  }
  // 间隙时保持显示最近的段
  const showId = matchId ?? nearestId;
  if (showId === activeSegId) return;
  activeSegId = showId;

  // 清除所有高亮
  for (const [, rec] of sourceLines) rec.el.classList.remove('active-seg');
  for (const [, rec] of targetLines) rec.el.classList.remove('active-seg');

  if (showId != null) {
    if (matchId != null) {
      const srcRec = sourceLines.get(matchId);
      const tgtRec = targetLines.get(matchId);
      if (srcRec) srcRec.el.classList.add('active-seg');
      if (tgtRec) tgtRec.el.classList.add('active-seg');
    }
    // 轮播模式: 以当前段为中心显示
    carouselShowAround(showId, sourceEl, sourceLines);
    carouselShowAround(showId, targetEl, targetLines);
  }
}

function clearSubtitles() {
  sourceEl.innerHTML = '';
  targetEl.innerHTML = '';
  sourceLines.clear();
  targetLines.clear();
  segTimestamps.clear();
  activeSegId = null;
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

// ---------- 导出 SRT 字幕 ----------
function formatSRTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function exportSRT() {
  const ids = [...sourceLines.keys()];
  if (ids.length === 0) return;

  let srt = '';
  let idx = 1;
  for (const id of ids) {
    const srcRec = sourceLines.get(id);
    const tgtRec = targetLines.get(id);
    const ts = segTimestamps.get(id);
    const srcText = srcRec ? srcRec.committedEl.textContent : '';
    const tgtText = tgtRec ? tgtRec.textEl.textContent : '';
    if (!srcText && !tgtText) continue;

    const start = ts ? formatSRTTime(ts.start) : formatSRTTime((idx - 1) * 5);
    const end = ts ? formatSRTTime(ts.end) : formatSRTTime(idx * 5);

    srt += `${idx}\n`;
    srt += `${start} --> ${end}\n`;
    srt += srcText + '\n';
    if (tgtText) srt += tgtText + '\n';
    srt += '\n';
    idx++;
  }

  const blob = new Blob([srt], { type: 'text/srt;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `subtitles_${Date.now()}.srt`;
  a.click();
  URL.revokeObjectURL(url);
}

$('startBtn').onclick = startCapture;
$('stopBtn').onclick = stop;
$('ttsBtn').onclick = toggleTTS;
$('exportBtn').onclick = exportSRT;

// 语言选择器
$('langFrom').onchange = () => {
  // 如果源和目标相同，自动换掉目标
  if ($('langFrom').value === $('langTo').value) {
    const others = ['en','zh','ja','ko'].filter(v => v !== $('langFrom').value);
    $('langTo').value = others[0];
  }
  updateLangUI();
};
$('langTo').onchange = () => {
  if ($('langTo').value === $('langFrom').value) {
    const others = ['en','zh','ja','ko'].filter(v => v !== $('langTo').value);
    $('langFrom').value = others[0];
  }
  updateLangUI();
};

// 交换按钮
$('langSwap').onclick = () => {
  const btn = $('langSwap');
  btn.classList.add('spinning');
  const tmp = $('langFrom').value;
  $('langFrom').value = $('langTo').value;
  $('langTo').value = tmp;
  updateLangUI();
  setTimeout(() => btn.classList.remove('spinning'), 400);
};

updateLangUI();
$('fileInput').onchange = (e) => {
  const file = e.target.files[0];
  if (file) startFileUpload(file);
  e.target.value = '';
};
