// 服务器端 ASR - 缓冲 PCM 音频,定期调用 Whisper API 转文字
// -----------------------------------------------------------
// 简单分段策略(与第一版一致):
//   每 2.5 秒积累音频 → 清空缓冲区 → 调 API 识别
//   发 interim "..." 占位 → 发 final 完整文本 → 触发翻译

// ============ WAV 编码 ============

function pcm16ToWav(pcmBuffer, sampleRate = 16000, channels = 1) {
  const byteRate = sampleRate * channels * 2;
  const dataSize = pcmBuffer.byteLength;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
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

// ============ 清理 ASR 输出 ============

function cleanASRText(text) {
  return text
    .replace(/<\|[^|]*\|>/g, '')   // SenseVoice 标签: <|HAPPY|> <|BGM|> 等
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{200D}\u{20E3}]/gu, '')
    .trim();
}

// ============ 调用 Whisper API ============

async function transcribeWav(wavBuffer, lang) {
  const cfg = getASRConfig();
  if (!cfg.apiKey) {
    console.error('[ASR] API_KEY 未设置');
    return '';
  }

  const url = `${cfg.baseUrl}/audio/transcriptions`;
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const parts = [];

  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
    `Content-Type: audio/wav\r\n\r\n`
  );
  parts.push(wavBuffer);
  parts.push('\r\n');

  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `${cfg.model}\r\n`
  );

  // 指定识别语言(避免自动检测出错)
  if (lang) {
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\n` +
      `${lang}\r\n`
    );
  }

  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
    `json\r\n`
  );

  parts.push(`--${boundary}--\r\n`);

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
    // 从 direction 前缀提取源语言,传给 ASR API
    this.sourceLang = direction.split('2')[0]; // en2zh→'en', zh2ja→'zh', etc.

    this.pcmChunks = [];
    this.totalSamples = 0;
    this.processedSamples = 0;  // 已处理的总样本数(用于时间戳)
    this.segId = 0;
    this.active = false;
    this.processing = false;

    // 每 2.5 秒触发一次识别
    this.chunkThreshold = 40000;
    // 最小 0.8 秒才值得识别
    this.minSamples = 12800;
  }

  start() {
    this.active = true;
    console.log(`[ASR] 开始, 方向: ${this.direction}`);
  }

  pushAudio(pcmBuffer) {
    if (!this.active) return;
    this.pcmChunks.push(Buffer.from(pcmBuffer));
    this.totalSamples += pcmBuffer.byteLength / 2;

    if (this.totalSamples >= this.chunkThreshold && !this.processing) {
      this._processChunk();
    }
  }

  async flush() {
    while (this.processing) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (this.totalSamples >= this.minSamples) {
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
    this.pcmChunks = [];
    this.totalSamples = 0;

    const pcmData = Buffer.concat(chunks);

    // 能量检测
    const int16 = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
    let energy = 0;
    for (let i = 0; i < int16.length; i++) {
      energy += Math.abs(int16[i]);
    }
    energy /= int16.length;
    if (energy < 200) {
      this.processing = false;
      return;
    }

    // 计算时间戳
    const sampleCount = pcmData.byteLength / 2;
    const startTime = this.processedSamples / 16000;
    this.processedSamples += sampleCount;
    const endTime = this.processedSamples / 16000;

    this.segId++;
    const segId = this.segId;

    // 发送 interim 占位(灰色 "...")
    this.onInterim?.(segId, '', '...');

    // 识别
    const wav = pcm16ToWav(pcmData);
    const rawText = await transcribeWav(wav, this.sourceLang);
    const text = cleanASRText(rawText);

    if (text) {
      console.log(`[ASR] seg${segId}: "${text}" [${startTime.toFixed(1)}s-${endTime.toFixed(1)}s]`);
      this.onFinal?.(segId, text, startTime, endTime);
    }

    this.processing = false;

    // 处理完后检查是否有新积累的数据
    if (this.totalSamples >= this.chunkThreshold) {
      this._processChunk();
    }
  }
}
