import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

// 加载 server/.env（确保从任意工作目录启动都能找到）
const __server_dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__server_dir, '.env') });

// 同声传译助手 - 后端编排
// -----------------------------------------------------------
// 数据流:
//   浏览器麦克风 --PCM--> 本服务
//     -> StreamingASR(缓冲音频 -> Whisper API 识别)
//     -> RollingTranslator(LLM 翻译 + 回头修正前句)
//     -> WebSocket 推回浏览器:双栏字幕 + 译文修正
import { WebSocketServer } from 'ws';
import { RollingTranslator, detectLang, autoCorrectDirection } from './providers.js';
import { StreamingASR, isASRConfigured } from './asr.js';
import { isTTSConfigured, synthesize, setVoiceReference, clearVoiceReference } from './tts.js';

const __dirname = __server_dir;
const WEB_DIR = path.join(__dirname, '..', 'web');
const PORT = process.env.PORT || 8787;

// ---------- yt-dlp + ffmpeg: 在线视频 URL → 实时 PCM 流 ----------
function streamUrlAudio(url) {
  // yt-dlp 提取最佳音频流 URL, ffmpeg 转码为 16kHz PCM16 单声道
  const ytdlp = spawn('yt-dlp', [
    '-f', 'bestaudio',
    '--no-playlist',
    '-o', '-',          // 输出到 stdout
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const ff = spawn('ffmpeg', [
    '-i', 'pipe:0',     // 从 stdin 读取
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    '-f', 's16le',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  ytdlp.stdout.pipe(ff.stdin);

  ytdlp.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.log('[yt-dlp]', line);
  });
  ff.stderr.on('data', () => {}); // suppress ffmpeg logs

  const cleanup = () => {
    try { ytdlp.kill(); } catch (e) {}
    try { ff.kill(); } catch (e) {}
  };

  ytdlp.on('error', (err) => {
    console.error('[yt-dlp] 启动失败:', err.message);
    cleanup();
  });
  ff.on('error', (err) => {
    console.error('[ffmpeg] 启动失败:', err.message);
    cleanup();
  });

  return { pcmStream: ff.stdout, cleanup, ytdlp, ff };
}

// ---------- ffmpeg 转码: 任意音视频 -> 16kHz PCM16 ----------
function convertToPCM(inputPath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const ff = spawn('ffmpeg', [
      '-i', inputPath, '-vn',
      '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
      '-f', 's16le', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', () => {}); // suppress ffmpeg logs
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}`));
      resolve(Buffer.concat(chunks));
    });
    ff.on('error', reject);
  });
}

// ---------- 静态文件服务 + 文件上传 ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  // 文件上传接口: POST /upload
  if (req.method === 'POST' && req.url === '/upload') {
    const tmpFile = path.join(os.tmpdir(), `si_upload_${Date.now()}`);
    const ws2 = req.headers['x-ws-id']; // 可选: 关联 WebSocket 会话
    const out = fs.createWriteStream(tmpFile);
    req.pipe(out);
    out.on('finish', async () => {
      try {
        const pcm = await convertToPCM(tmpFile);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'X-Sample-Rate': '16000',
          'X-Samples': String(pcm.byteLength / 2),
        });
        res.end(pcm);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('ffmpeg error: ' + err.message);
      } finally {
        fs.unlink(tmpFile, () => {});
      }
    });
    return;
  }

  let urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(WEB_DIR, urlPath);
  if (!filePath.startsWith(WEB_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- WebSocket:每个连接 = 一路同传会话 ----------
const wss = new WebSocketServer({ server });

let sessionCounter = 0;
// OBS overlay 广播: 活跃会话 → 所有 overlay 客户端
const overlayClients = new Set();
function broadcastToOverlays(msg) {
  const data = JSON.stringify(msg);
  for (const oc of overlayClients) {
    if (oc.readyState === oc.OPEN) oc.send(data);
  }
}

wss.on('connection', (ws) => {
  const sessionId = `s${++sessionCounter}_${Date.now()}`;
  console.log(`[ws] 客户端已连接 (${sessionId})`);
  let translator = null;
  let asr = null;
  let sessionDirection = 'en2zh'; // 用户选择的翻译方向
  let pendingVoiceSample = null; // 等待接收的语音样本二进制数据
  let urlStream = null; // URL 模式的音频流

  const send = (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };

  const serverTTS = isTTSConfigured();

  // 翻译已定稿原文,广播译文 + 修正 + TTS 音频
  async function translateAndEmit(segId, sourceText) {
    if (!translator) return;
    // 自动检测语言,修正翻译方向
    const detected = detectLang(sourceText);
    const correctedDir = autoCorrectDirection(detected, sessionDirection);
    if (correctedDir !== sessionDirection) {
      console.log(`[MT] 语言自动检测: "${detected}", 方向修正 ${sessionDirection} → ${correctedDir}`);
    }
    // 流式翻译: 逐步发送 partial 译文
    const onPartial = (partial) => {
      send({ type: 'translation_partial', id: segId, partial });
    };
    const dirOverride = correctedDir !== translator.direction ? correctedDir : undefined;
    const { target, corrections } = await translator.translate(segId, sourceText, onPartial, dirOverride);
    const transMsg = { type: 'translation', id: segId, source: sourceText, target };
    send(transMsg);
    broadcastToOverlays(transMsg);
    for (const c of corrections) {
      const corrMsg = { type: 'correction', id: c.id, target: c.target };
      send(corrMsg);
      broadcastToOverlays(corrMsg);
    }
    // 服务器端 TTS (支持声音克隆)
    if (serverTTS && target) {
      const audio = await synthesize(target, sessionId);
      if (audio && ws.readyState === ws.OPEN) {
        // 先发 JSON 告知即将发送音频,再发二进制
        send({ type: 'tts_audio', id: segId, format: 'mp3', size: audio.byteLength });
        ws.send(audio);
      }
    }
  }

  ws.on('message', async (raw, isBinary) => {
    if (isBinary) {
      // 检查是否是语音克隆参考样本
      if (pendingVoiceSample) {
        const sr = pendingVoiceSample.sampleRate;
        pendingVoiceSample = null; // 立即清除，防止后续 PCM 被误认为声纹
        setVoiceReference(sessionId, raw, sr); // 异步处理，不阻塞消息接收
        return;
      }
      // PCM 音频数据 -> 送入 ASR
      if (asr) asr.pushAudio(raw);
      return;
    }

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'start': {
        // OBS overlay 客户端: 只接收广播，不创建翻译器
        if (msg.mode === 'overlay') {
          overlayClients.add(ws);
          send({ type: 'ready', mode: 'overlay', asrMode: 'none', ttsMode: 'none' });
          console.log(`[ws] OBS overlay 客户端已注册`);
          break;
        }

        const mode = process.env.MT_PROVIDER || 'deepseek';
        const dir = msg.direction || 'en2zh';
        sessionDirection = dir;
        const serverASR = isASRConfigured();
        const isFile = msg.mode === 'file';
        const isTab = msg.mode === 'tab';
        translator = new RollingTranslator({ direction: dir });

        // 文件/标签页模式用服务器 ASR; 实时麦克风模式用浏览器 Web Speech API(逐词显示、低延迟)
        if ((isFile || isTab) && serverASR) {
          asr = new StreamingASR({
            direction: dir,
            liveStream: isTab,
            onInterim: (segId, committed, pending) => {
              send({ type: 'asr_partial', id: segId, committed, pending });
            },
            onFinal: (segId, text, startTime, endTime, speaker) => {
              const asrMsg = { type: 'asr_final', id: segId, text, startTime, endTime, speaker };
              send(asrMsg);
              broadcastToOverlays(asrMsg);
              translateAndEmit(segId, text);
            },
          });
          asr.start();
        }

        const asrMode = ((isFile || isTab) && serverASR) ? 'server' : 'browser';
        const modeLabel = isFile ? 'file' : isTab ? 'tab' : 'live';
        console.log(`[ws] 会话开始, 翻译: ${mode}, 方向: ${dir}, 模式: ${modeLabel}, ASR: ${asrMode === 'server' ? (process.env.ASR_PROVIDER || 'siliconflow') : 'browser'}, TTS: ${serverTTS ? 'server' : 'browser'}`);
        send({ type: 'ready', mode, asrMode, ttsMode: serverTTS ? 'server' : 'browser' });
        break;
      }

      // 浏览器端 ASR 发来的识别结果(fallback 模式)
      case 'asr_interim': {
        const words = (msg.text || '').split(/\s+/).filter(Boolean);
        if (words.length === 0) break;
        send({ type: 'asr_partial', id: msg.id, committed: '', pending: msg.text });
        break;
      }
      case 'asr_final': {
        const text = (msg.text || '').trim();
        if (!text) break;
        const asrFinalMsg = { type: 'asr_final', id: msg.id, text, speaker: msg.speaker };
        send(asrFinalMsg);
        broadcastToOverlays(asrFinalMsg);
        translateAndEmit(msg.id, text);
        break;
      }

      case 'voice_sample':
        // 前端即将发送语音克隆参考音频(二进制 PCM16)
        pendingVoiceSample = { sampleRate: msg.sampleRate || 16000, samples: msg.samples || 0 };
        console.log(`[ws] 等待接收语音样本...`);
        break;

      case 'retranslate': {
        // 用户编辑了原文，重新翻译
        const newText = (msg.text || '').trim();
        if (!newText || !translator) break;
        // 更新历史记录中的原文
        const hist = translator.history.find(h => h.id === msg.id);
        if (hist) hist.source = newText;
        console.log(`[ws] 重新翻译 seg${msg.id}: "${newText}"`);
        translateAndEmit(msg.id, newText);
        break;
      }

      case 'feedback':
        // 用户标记译文不准确
        if (translator && msg.id != null) {
          translator.addFeedback(msg.id);
          console.log(`[ws] 用户反馈: seg${msg.id} 翻译不准确`);
        }
        break;

      case 'start_url': {
        // 在线视频 URL 模式: yt-dlp + ffmpeg 提取音频 → 服务器 ASR
        const urlDir = msg.direction || 'en2zh';
        sessionDirection = urlDir;
        const videoUrl = (msg.url || '').trim();
        if (!videoUrl) { send({ type: 'error', message: 'URL 不能为空' }); break; }

        const serverASR2 = isASRConfigured();
        if (!serverASR2) { send({ type: 'error', message: '服务器 ASR 未配置 (需要 ASR_API_KEY)' }); break; }

        const mode2 = process.env.MT_PROVIDER || 'deepseek';
        translator = new RollingTranslator({ direction: urlDir });
        asr = new StreamingASR({
          direction: urlDir,
          liveStream: true,
          onInterim: (segId, committed, pending) => {
            send({ type: 'asr_partial', id: segId, committed, pending });
          },
          onFinal: (segId, text, startTime, endTime, speaker) => {
            const asrMsg = { type: 'asr_final', id: segId, text, startTime, endTime, speaker };
            send(asrMsg);
            broadcastToOverlays(asrMsg);
            translateAndEmit(segId, text);
          },
        });
        asr.start();

        console.log(`[ws] URL 模式开始, 方向: ${urlDir}, URL: ${videoUrl}`);
        send({ type: 'ready', mode: mode2, asrMode: 'server', ttsMode: serverTTS ? 'server' : 'browser' });
        send({ type: 'url_status', status: 'extracting', message: '正在提取音频流...' });

        // 启动 yt-dlp + ffmpeg 流
        urlStream = streamUrlAudio(videoUrl);

        urlStream.ytdlp.on('close', (code) => {
          if (code !== 0) {
            send({ type: 'url_status', status: 'error', message: `yt-dlp 提取失败 (code ${code})，请检查 URL` });
          }
        });

        let urlStarted = false;
        urlStream.pcmStream.on('data', (chunk) => {
          if (!urlStarted) {
            urlStarted = true;
            send({ type: 'url_status', status: 'streaming', message: '正在实时翻译...' });
          }
          if (asr) asr.pushAudio(chunk);
        });

        urlStream.pcmStream.on('end', () => {
          console.log('[ws] URL 音频流结束');
          if (asr) asr.flush();
          send({ type: 'url_status', status: 'done', message: '音频流已结束' });
          urlStream = null;
        });

        urlStream.pcmStream.on('error', () => {
          send({ type: 'url_status', status: 'error', message: '音频流读取错误' });
          urlStream = null;
        });

        break;
      }

      case 'stop_url':
        if (urlStream) {
          urlStream.cleanup();
          urlStream = null;
        }
        if (asr) { asr.flush(); asr.stop(); asr = null; }
        console.log('[ws] URL 模式已停止');
        break;

      case 'file_done':
        console.log('[ws] 文件音频传输完成');
        if (asr) asr.flush();
        break;
    }
  });

  ws.on('close', () => {
    if (urlStream) { urlStream.cleanup(); urlStream = null; }
    if (asr) asr.stop();
    clearVoiceReference(sessionId);
    overlayClients.delete(ws);
    console.log(`[ws] 会话结束 (${sessionId})`);
  });
});

server.listen(PORT, () => {
  console.log(`\n  同声传译助手 已启动`);
  console.log(`  打开:  http://localhost:${PORT}`);
  console.log(`  翻译:  ${process.env.MT_PROVIDER || 'deepseek'}`);
  console.log(`  ASR:   ${process.env.ASR_PROVIDER || 'siliconflow'}\n`);
});
