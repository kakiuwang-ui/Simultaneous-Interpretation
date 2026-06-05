// 服务器端 TTS - 支持声音克隆
// -----------------------------------------------------------
// 支持 OpenAI TTS 格式的 API + CosyVoice 声音克隆
//
// 环境变量:
//   TTS_BASE_URL=https://api.siliconflow.cn/v1   (默认 SiliconFlow)
//   TTS_API_KEY=xxx  (不设则用浏览器自带 TTS)
//   TTS_MODEL=FunAudioLLM/CosyVoice2-0.5B       (默认)
//   TTS_VOICE=中文女                              (默认,有克隆音频时自动忽略)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TTS_PRESETS = {
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/CosyVoice2-0.5B',
    voice: '中文女',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'tts-1',
    voice: 'alloy',
  },
};

function getTTSConfig() {
  const provider = process.env.TTS_PROVIDER || 'siliconflow';
  const preset = TTS_PRESETS[provider] || {};
  return {
    provider,
    baseUrl: process.env.TTS_BASE_URL || preset.baseUrl || '',
    model: process.env.TTS_MODEL || preset.model || '',
    voice: process.env.TTS_VOICE || preset.voice || '',
    apiKey: process.env.TTS_API_KEY || '',
  };
}

export function isTTSConfigured() {
  return !!getTTSConfig().apiKey;
}

// PCM16 -> WAV (用于声音克隆参考音频)
function pcm16ToWav(pcm16Buffer, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm16Buffer.byteLength;
  const headerSize = 44;
  const buf = Buffer.alloc(headerSize + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  Buffer.from(pcm16Buffer).copy(buf, headerSize);
  return buf;
}

// 会话级声音克隆参考音频
const sessionVoiceRefs = new Map();

export function setVoiceReference(sessionId, pcmBuffer, sampleRate) {
  const wavBuf = pcm16ToWav(pcmBuffer, sampleRate);
  const base64 = wavBuf.toString('base64');
  const dataUri = `data:audio/wav;base64,${base64}`;
  sessionVoiceRefs.set(sessionId, dataUri);
  console.log(`[TTS] 已保存语音参考样本 (${(pcmBuffer.byteLength / 1024).toFixed(1)}KB WAV), sessionId=${sessionId}`);
}

export function clearVoiceReference(sessionId) {
  sessionVoiceRefs.delete(sessionId);
}

export async function synthesize(text, sessionId) {
  const cfg = getTTSConfig();
  if (!cfg.apiKey || !text) return null;

  const voiceRef = sessionId ? sessionVoiceRefs.get(sessionId) : null;

  // SiliconFlow CosyVoice 声音克隆: 使用 reference_audio 参数
  if (cfg.provider === 'siliconflow' && voiceRef) {
    return synthesizeWithClone(cfg, text, voiceRef);
  }

  // 标准 OpenAI TTS 接口
  const url = `${cfg.baseUrl}/audio/speech`;
  const body = {
    model: cfg.model,
    input: text,
    voice: cfg.voice,
    response_format: 'mp3',
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[TTS] API 错误 ${res.status}: ${errText}`);
      return null;
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    console.error('[TTS] 合成失败:', err.message);
    return null;
  }
}

async function synthesizeWithClone(cfg, text, referenceAudioDataUri) {
  const url = `${cfg.baseUrl}/audio/speech`;
  const body = {
    model: cfg.model,
    input: text,
    voice: cfg.voice,
    reference_audio: referenceAudioDataUri,
    response_format: 'mp3',
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[TTS] 声音克隆 API 错误 ${res.status}: ${errText}`);
      // 降级为普通 TTS
      return synthesizeFallback(cfg, text);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    console.error('[TTS] 声音克隆失败:', err.message);
    return synthesizeFallback(cfg, text);
  }
}

async function synthesizeFallback(cfg, text) {
  const url = `${cfg.baseUrl}/audio/speech`;
  const body = {
    model: cfg.model,
    input: text,
    voice: cfg.voice,
    response_format: 'mp3',
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}
