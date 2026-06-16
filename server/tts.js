// 服务器端 TTS - 支持声音克隆
// -----------------------------------------------------------
// 支持 SiliconFlow CosyVoice2 + OpenAI TTS
//
// 环境变量:
//   TTS_BASE_URL=https://api.siliconflow.cn/v1  (默认 SiliconFlow)
//   TTS_API_KEY=xxx  (不设则用浏览器自带 TTS)
//   TTS_MODEL=FunAudioLLM/CosyVoice2-0.5B       (默认)
//   TTS_VOICE=FunAudioLLM/CosyVoice2-0.5B:anna  (默认预设音色)

import { transcribeWav } from './asr.js';

const TTS_PRESETS = {
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/CosyVoice2-0.5B',
    voice: 'FunAudioLLM/CosyVoice2-0.5B:anna',
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

// PCM16 -> WAV
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

// 会话级声音克隆参考: { audioDataUri, transcript }
const sessionVoiceRefs = new Map();

export async function setVoiceReference(sessionId, pcmBuffer, sampleRate) {
  const wavBuf = pcm16ToWav(pcmBuffer, sampleRate);
  const base64 = wavBuf.toString('base64');
  const audioDataUri = `data:audio/wav;base64,${base64}`;

  // 用 ASR 转录参考音频（CosyVoice2 references 需要 text）
  let transcript = '';
  try {
    transcript = await transcribeWav(wavBuf);
    console.log(`[TTS] 参考音频转录: "${transcript}"`);
  } catch (err) {
    console.error('[TTS] 转录参考音频失败:', err.message);
  }

  if (!transcript) {
    console.log('[TTS] 转录为空，跳过声纹保存（将使用预设音色）');
    return;
  }

  sessionVoiceRefs.set(sessionId, { audioDataUri, transcript });
  console.log(`[TTS] 已保存语音参考样本 (${(wavBuf.byteLength / 1024).toFixed(1)}KB WAV), sessionId=${sessionId}`);
}

export function clearVoiceReference(sessionId) {
  sessionVoiceRefs.delete(sessionId);
}

// 长句拆分: 按标点分段,每段不超过 maxLen 字符
function splitLongText(text, maxLen = 50) {
  if (text.length <= maxLen) return [text];
  // 按中英文标点拆分
  const parts = text.split(/(?<=[。！？；，、.!?;,])\s*/);
  const result = [];
  let current = '';
  for (const part of parts) {
    if (current.length + part.length > maxLen && current) {
      result.push(current);
      current = part;
    } else {
      current += part;
    }
  }
  if (current) result.push(current);
  return result;
}

export async function synthesize(text, sessionId) {
  const cfg = getTTSConfig();
  if (!cfg.apiKey || !text) return null;

  const voiceRef = sessionId ? sessionVoiceRefs.get(sessionId) : null;

  // 长句拆分: 只合成第一段以降低延迟
  const parts = splitLongText(text);
  const firstPart = parts[0];

  // SiliconFlow CosyVoice: 有参考音频时用 references 克隆
  if (cfg.provider === 'siliconflow' && voiceRef) {
    return synthesizeWithClone(cfg, firstPart, voiceRef);
  }

  // 标准预设音色
  return synthesizeWithVoice(cfg, firstPart);
}

async function synthesizeWithVoice(cfg, text) {
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

async function synthesizeWithClone(cfg, text, voiceRef) {
  const url = `${cfg.baseUrl}/audio/speech`;
  // CosyVoice2 克隆: 用 references 数组，voice 和 references 互斥
  const body = {
    model: cfg.model,
    input: text,
    references: [
      {
        audio: voiceRef.audioDataUri,
        text: voiceRef.transcript,
      },
    ],
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
      // 降级为预设音色
      return synthesizeWithVoice(cfg, text);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    console.error('[TTS] 声音克隆失败:', err.message);
    return synthesizeWithVoice(cfg, text);
  }
}
