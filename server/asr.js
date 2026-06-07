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

export async function transcribeWav(wavBuffer, lang) {
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
  constructor({ onInterim, onFinal, direction = 'en2zh', liveStream = false }) {
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.direction = direction;
    this.liveStream = liveStream; // true = 标签页模式（1秒小块 + 文字累积）
    // 不指定源语言,让 ASR 自动检测(避免用户选错方向导致识别错误)
    this.sourceLang = null;

    this.pcmChunks = [];
    this.totalSamples = 0;
    this.processedSamples = 0;  // 已处理的总样本数(用于时间戳)
    this.segId = 0;
    this.active = false;
    this.processing = false;

    // 实时模式: 1.5秒触发一次(低延迟); 文件模式: 2.5秒
    this.chunkThreshold = liveStream ? 24000 : 40000;
    // 最小识别时长
    this.minSamples = liveStream ? 8000 : 12800;

    // VAD 端点检测: 基于 RMS 能量的语音/静音状态机
    this.vadState = 'silence'; // 'silence' | 'speech'
    this.vadSilenceSamples = 0;  // 当前连续静音样本数
    this.vadSpeechSamples = 0;   // 当前连续语音样本数
    this.vadRmsThreshold = 300;  // RMS 能量阈值（低于 = 静音）
    // 端点判定: 语音后静音超过此阈值 → 认为说话结束
    this.vadEndpointSamples = liveStream ? 9600 : 16000; // 实时0.6s, 文件1s
    // 语音起始: 需要连续语音超过此阈值才进入 speech 状态（防抖）
    this.vadSpeechOnset = 2400; // 0.15s

    // 说话人分离: 基于长静音间隔
    this.currentSpeaker = 0;
    this.speakerSilenceSamples = 0;
    this.speakerSilenceThreshold = 32000; // 2秒静音 = 说话人切换

    // ASR 请求并行
    this.pendingASR = 0;

    // 实时模式: 文字累积（多个 ASR 结果合并成完整句子）
    this.accText = '';
    this.accSegId = 0;
    this.accStartTime = 0;
    this.accEndTime = 0;
    this.accFlushTimer = null; // 备用超时（VAD 失效时兜底）
  }

  start() {
    this.active = true;
    console.log(`[ASR] 开始, 方向: ${this.direction}`);
  }

  pushAudio(pcmBuffer) {
    if (!this.active) return;
    this.pcmChunks.push(Buffer.from(pcmBuffer));
    const samples = pcmBuffer.byteLength / 2;
    this.totalSamples += samples;

    // 计算 RMS 能量 (确保 Int16Array 对齐)
    const aligned = pcmBuffer.byteOffset % 2 !== 0 ? Buffer.from(pcmBuffer) : pcmBuffer;
    const int16 = new Int16Array(aligned.buffer, aligned.byteOffset, samples);
    let sumSq = 0;
    for (let i = 0; i < int16.length; i++) sumSq += int16[i] * int16[i];
    const rms = Math.sqrt(sumSq / int16.length);

    const isSpeech = rms >= this.vadRmsThreshold;

    // 说话人分离: 长静音检测
    if (!isSpeech) {
      this.speakerSilenceSamples += samples;
    } else {
      if (this.speakerSilenceSamples >= this.speakerSilenceThreshold) {
        this.currentSpeaker = 1 - this.currentSpeaker;
        console.log(`[ASR] 说话人切换 → Speaker ${this.currentSpeaker}`);
      }
      this.speakerSilenceSamples = 0;
    }

    // VAD 状态机
    if (this.vadState === 'silence') {
      if (isSpeech) {
        this.vadSpeechSamples += samples;
        this.vadSilenceSamples = 0;
        if (this.vadSpeechSamples >= this.vadSpeechOnset) {
          this.vadState = 'speech';
        }
      } else {
        this.vadSpeechSamples = 0;
        this.vadSilenceSamples += samples;
      }
    } else {
      // vadState === 'speech'
      if (isSpeech) {
        this.vadSilenceSamples = 0;
      } else {
        this.vadSilenceSamples += samples;
        // 端点检测: 语音后足够长的静音 → 切分
        if (this.vadSilenceSamples >= this.vadEndpointSamples) {
          this.vadState = 'silence';
          this.vadSpeechSamples = 0;
          // 立即处理当前缓冲区的音频（含语音 + 尾部静音）
          if (this.totalSamples >= this.minSamples && !this.processing) {
            this._processChunk();
          }
          // 实时模式: VAD 端点也触发文字提交
          if (this.liveStream && this.accText) {
            this._flushAccumulated();
          }
          return; // 已处理，不走下面的定时触发
        }
      }
    }

    // 定时触发: 音频积累超过阈值时也处理（防止长句无停顿）
    if (this.totalSamples >= this.chunkThreshold && !this.processing) {
      this._processChunk();
    }
  }

  async flush() {
    while (this.processing || this.pendingASR > 0) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (this.totalSamples >= this.minSamples) {
      await this._processChunk();
    }
    // 等待所有并行 ASR 完成后，提交累积的文字
    while (this.pendingASR > 0) {
      await new Promise(r => setTimeout(r, 100));
    }
    this._flushAccumulated();
  }

  stop() {
    this.active = false;
    this._flushAccumulated();
    this.flush();
  }

  async _processChunk() {
    if (this.pcmChunks.length === 0) return;
    this.processing = true;

    // 快照并清空缓冲区，允许后续音频继续积累
    const chunks = this.pcmChunks;
    this.pcmChunks = [];
    this.totalSamples = 0;

    const pcmData = Buffer.concat(chunks);

    // RMS 能量检测
    const int16 = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
    let sumSq = 0;
    for (let i = 0; i < int16.length; i++) sumSq += int16[i] * int16[i];
    const rms = Math.sqrt(sumSq / int16.length);

    const sampleCount = pcmData.byteLength / 2;

    if (rms < this.vadRmsThreshold) {
      // 静音块，跳过
      this.processedSamples += sampleCount;
      this.processing = false;
      return;
    }

    // 计算时间戳，分配 segId
    const startTime = this.processedSamples / 16000;
    this.processedSamples += sampleCount;
    const endTime = this.processedSamples / 16000;
    this.segId++;
    const segId = this.segId;

    // 显示 interim 占位（实时模式用累积 segId）
    const interimId = this.liveStream && this.accText ? this.accSegId : segId;
    this.onInterim?.(interimId, this.liveStream ? this.accText : '', '...');

    // 释放 processing 锁，允许下一块并行处理
    this.processing = false;

    // 异步 ASR 调用（并行）
    this.pendingASR++;
    try {
      const wav = pcm16ToWav(pcmData);
      const rawText = await transcribeWav(wav, this.sourceLang);
      const text = cleanASRText(rawText);

      if (text) {
        if (this.liveStream) {
          // 实时模式: 累积文字，检测句子边界后才触发翻译
          this._accumulateText(text, startTime, endTime);
        } else {
          console.log(`[ASR] seg${segId} (S${this.currentSpeaker}): "${text}" [${startTime.toFixed(1)}s-${endTime.toFixed(1)}s]`);
          this.onFinal?.(segId, text, startTime, endTime, this.currentSpeaker);
        }
      }
    } finally {
      this.pendingASR--;
    }

    // 处理完后检查是否有新积累的数据
    if (this.totalSamples >= this.chunkThreshold) {
      this._processChunk();
    }
  }

  _accumulateText(text, startTime, endTime) {
    // 首次累积: 分配新 segId
    if (!this.accText) {
      this.accSegId = this.segId;
      this.accStartTime = startTime;
    }
    // 拼接文字（英文加空格，中日韩不加）
    if (this.accText && /[a-zA-Z]$/.test(this.accText) && /^[a-zA-Z]/.test(text)) {
      this.accText += ' ' + text;
    } else {
      this.accText += text;
    }
    this.accEndTime = endTime;

    // 显示 interim（让用户看到文字逐步增长）
    this.onInterim?.(this.accSegId, this.accText, '');

    // 检测句子结束: 英文 .!? 或中文。！？
    const endsWithSentence = /[.!?。！？][\s"'））》」]*$/.test(this.accText.trim());

    // 重置超时计时器
    if (this.accFlushTimer) clearTimeout(this.accFlushTimer);

    if (endsWithSentence) {
      // 句子结束，立即提交
      this._flushAccumulated();
    } else {
      // 兜底超时: VAD 会主动触发，这里只是防止极端情况无限等待
      this.accFlushTimer = setTimeout(() => this._flushAccumulated(), 4000);
    }
  }

  _flushAccumulated() {
    if (this.accFlushTimer) { clearTimeout(this.accFlushTimer); this.accFlushTimer = null; }
    if (!this.accText) return;

    const text = this.accText;
    const segId = this.accSegId;
    const startTime = this.accStartTime;
    const endTime = this.accEndTime;

    console.log(`[ASR] seg${segId} (S${this.currentSpeaker}): "${text}" [${startTime.toFixed(1)}s-${endTime.toFixed(1)}s]`);
    this.onFinal?.(segId, text, startTime, endTime, this.currentSpeaker);

    // 清空累积
    this.accText = '';
  }
}
