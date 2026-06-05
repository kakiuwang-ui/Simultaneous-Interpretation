import 'dotenv/config';

// 同声传译助手 - 后端编排
// -----------------------------------------------------------
// 数据流:
//   浏览器麦克风 --PCM--> 本服务
//     -> StreamingASR(缓冲音频 -> Whisper API 识别)
//     -> RollingTranslator(LLM 翻译 + 回头修正前句)
//     -> WebSocket 推回浏览器:双栏字幕 + 译文修正

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RollingTranslator } from './providers.js';
import { StreamingASR, isASRConfigured } from './asr.js';
import { isTTSConfigured, synthesize, setVoiceReference, clearVoiceReference } from './tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');
const PORT = process.env.PORT || 8787;

// ---------- 静态文件服务 ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
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

wss.on('connection', (ws) => {
  const sessionId = `s${++sessionCounter}_${Date.now()}`;
  console.log(`[ws] 客户端已连接 (${sessionId})`);
  let translator = null;
  let asr = null;
  let pendingVoiceSample = null; // 等待接收的语音样本二进制数据

  const send = (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };

  const serverTTS = isTTSConfigured();

  // 翻译已定稿原文,广播译文 + 修正 + TTS 音频
  async function translateAndEmit(segId, sourceText) {
    if (!translator) return;
    const { target, corrections } = await translator.translate(segId, sourceText);
    send({ type: 'translation', id: segId, source: sourceText, target });
    for (const c of corrections) {
      send({ type: 'correction', id: c.id, target: c.target });
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

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      // 检查是否是语音克隆参考样本
      if (pendingVoiceSample) {
        setVoiceReference(sessionId, raw, pendingVoiceSample.sampleRate);
        pendingVoiceSample = null;
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
        const mode = process.env.MT_PROVIDER || 'deepseek';
        const dir = msg.direction || 'en2zh';
        const serverASR = isASRConfigured();
        translator = new RollingTranslator({ direction: dir });

        if (serverASR) {
          // 服务器端 ASR
          asr = new StreamingASR({
            direction: dir,
            onInterim: (segId, text) => {
              send({ type: 'asr_partial', id: segId, committed: '', pending: text });
            },
            onFinal: (segId, text) => {
              send({ type: 'asr_final', id: segId, text });
              translateAndEmit(segId, text);
            },
          });
          asr.start();
        }

        console.log(`[ws] 会话开始, 翻译: ${mode}, 方向: ${dir}, ASR: ${serverASR ? (process.env.ASR_PROVIDER || 'siliconflow') : 'browser'}, TTS: ${serverTTS ? 'server' : 'browser'}`);
        send({ type: 'ready', mode, asrMode: serverASR ? 'server' : 'browser', ttsMode: serverTTS ? 'server' : 'browser' });
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
        send({ type: 'asr_final', id: msg.id, text });
        translateAndEmit(msg.id, text);
        break;
      }

      case 'voice_sample':
        // 前端即将发送语音克隆参考音频(二进制 PCM16)
        pendingVoiceSample = { sampleRate: msg.sampleRate || 16000, samples: msg.samples || 0 };
        console.log(`[ws] 等待接收语音样本...`);
        break;

      case 'file_done':
        console.log('[ws] 文件音频传输完成');
        if (asr) asr.flush();
        break;
    }
  });

  ws.on('close', () => {
    if (asr) asr.stop();
    clearVoiceReference(sessionId);
    console.log(`[ws] 会话结束 (${sessionId})`);
  });
});

server.listen(PORT, () => {
  console.log(`\n  同声传译助手 已启动`);
  console.log(`  打开:  http://localhost:${PORT}`);
  console.log(`  翻译:  ${process.env.MT_PROVIDER || 'deepseek'}`);
  console.log(`  ASR:   ${process.env.ASR_PROVIDER || 'siliconflow'}\n`);
});
