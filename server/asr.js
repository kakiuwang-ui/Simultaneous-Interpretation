// 服务器端 ASR - 缓冲 PCM 音频,定期调用 Whisper API 转文字
// -----------------------------------------------------------
// 支持 OpenAI Whisper 格式的 API (SiliconFlow / Groq / OpenAI 等)
//
// 环境变量:
//   ASR_BASE_URL=https://api.siliconflow.cn/v1   (默认 SiliconFlow)
//   ASR_API_KEY=xxx
//   ASR_MODEL=FunAudioLLM/SenseVoiceSmall        (默认)
//   ASR_LANG=en  或  zh

// ============ WAV 编码 ============

function pcm16ToWav(pcmBuffer, sampleRate = 16000, channels = 1) {
  const byteRate = sampleRate * channels * 2;
  const dataSize = pcmBuffer.byteLength;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);        // fmt chunk size
  header.writeUInt16LE(1, 20);         // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);        // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, Buffer.from(pcmBuffer)]);
}

// ============ ASR 配置 ============

const ASR_PRESETS = {
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
  },
};

function getASRConfig() {
  const provider = process.env.ASR_PROVIDER || 'siliconflow';
  const preset = ASR_PRESETS[provider] || {};
  return {
    provider,
    baseUrl: process.env.ASR_BASE_URL || preset.baseUrl || '',
    model: process.env.ASR_MODEL || preset.model || '',
    apiKey: process.env.ASR_API_KEY || '',
  };
}

export function isASRConfigured() {
  const cfg = getASRConfig();
  return !!cfg.apiKey;
}

// ============ 调用 Whisper API ============

async function transcribeWav(wavBuffer, lang = 'en') {
  const cfg = getASRConfig();
  if (!cfg.apiKey) {
    console.error('[ASR] API_KEY 未设置');
    return '';
  }

  const url = `${cfg.baseUrl}/audio/transcriptions`;

  // 构建 multipart/form-data
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const parts = [];

  // file 字段
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
    `Content-Type: audio/wav\r\n\r\n`
  );
  parts.push(wavBuffer);
  parts.push('\r\n');

  // model 字段
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `${cfg.model}\r\n`
  );

  // language 字段
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="language"\r\n\r\n` +
    `${lang}\r\n`
  );

  // response_format
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
    `json\r\n`
  );

  parts.push(`--${boundary}--\r\n`);

  // 合并 parts 为单个 Buffer
  const bodyParts = parts.map(p => typeof p === 'string' ? Buffer.from(p) : p);
  const body = Buffer.concat(bodyParts);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ASR] API 错误 ${res.status}: ${errText}`);
      return '';
    }

    const data = await res.json();
    return (data.text || '').trim();
  } catch (err) {
    console.error('[ASR] 识别失败:', err.message);
    return '';
  }
}

// ============ 流式 ASR 会话 ============

export class StreamingASR {
  constructor({ onInterim, onFinal, direction = 'en2zh' }) {
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.direction = direction;
    this.lang = direction === 'zh2en' ? 'zh' : 'en';

    this.pcmChunks = [];       // 当前积累的 PCM 数据
    this.totalSamples = 0;     // 当前缓冲区的样本数
    this.segId = 0;
    this.active = false;
    this.processing = false;

    // 每 2.5 秒的音频触发一次识别(16kHz * 2.5s = 40000 samples)
    this.chunkThreshold = 40000;
    // 最小 0.8 秒才值得识别
    this.minSamples = 12800;
  }

  start() {
    this.active = true;
    console.log(`[ASR] 开始, 语言: ${this.lang}`);
  }

  pushAudio(pcmBuffer) {
    if (!this.active) return;
    this.pcmChunks.push(Buffer.from(pcmBuffer));
    // pcmBuffer 是 Int16 = 2 bytes per sample
    this.totalSamples += pcmBuffer.byteLength / 2;

    if (this.totalSamples >= this.chunkThreshold && !this.processing) {
      this._processChunk();
    }
  }

  // 强制处理剩余音频
  async flush() {
    if (this.totalSamples >= this.minSamples && !this.processing) {
      await this._processChunk();
    }
  }

  stop() {
    this.active = false;
    this.flush();
  }

  async _processChunk() {
    if (this.pcmChunks.length === 0) return;
    this.processing = true;

    // 取出当前所有缓冲
    const chunks = this.pcmChunks;
    const samples = this.totalSamples;
    this.pcmChunks = [];
    this.totalSamples = 0;

    const pcmData = Buffer.concat(chunks);

    // 简单能量检测 - 如果太安静就跳过
    const int16 = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
    let energy = 0;
    for (let i = 0; i < int16.length; i++) {
      energy += Math.abs(int16[i]);
    }
    energy /= int16.length;
    if (energy < 200) {
      // 太安静,跳过
      this.processing = false;
      return;
    }

    this.segId++;
    const segId = this.segId;

    // 发送 interim 状态
    this.onInterim?.(segId, '...');

    // 转 WAV 并调 API
    const wav = pcm16ToWav(pcmData);
    const text = await transcribeWav(wav, this.lang);

    if (text) {
      console.log(`[ASR] seg${segId}: "${text}"`);
      this.onFinal?.(segId, text);
    }

    this.processing = false;
  }
}
