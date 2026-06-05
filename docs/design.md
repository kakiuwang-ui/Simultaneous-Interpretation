# AI 同声传译助手 - 技术设计文档

## 1. 项目概述

### 1.1 题目要求

开发一款 AI 同声传译助手，实时翻译英语/中文音频流为目标语言字幕和语音，具备自动修正能力。

### 1.2 核心需求

| 维度 | 实现 |
|------|------|
| 翻译方向 | **双向**：EN ↔ 中文，一键切换 |
| 输入源 | 麦克风实时收音 / 上传音视频文件 |
| 输出形式 | 双栏字幕（原文 + 译文）+ 语音播报（TTS） |
| 实时性 | 流式处理，字幕实时出现 |
| 纠错能力 | ASR interim→final 修正 + LLM 上下文回溯修正前句译文 |
| 声音克隆 | 采集说话者声音样本，用克隆声音播报译文 |

---

## 2. 技术架构

### 2.1 整体数据流

```
浏览器麦克风
  │  getUserMedia + ScriptProcessor
  │  降采样为 16kHz PCM16
  ▼
WebSocket 上传
  │
  ├──▶ StreamingASR (asr.js)
  │      缓冲 PCM → 拼接为 WAV → Whisper API 识别
  │      每 2.5 秒触发一次识别
  │      静音检测（能量 < 200 跳过）
  │      输出: asr_partial / asr_final
  │
  ├──▶ 语音样本采集（前 5 秒）
  │      PCM16 → WAV → base64 data URI
  │      保存为 CosyVoice 声音克隆参考
  │
  ▼
RollingTranslator (providers.js)
  │  DeepSeek / Qwen / Kimi / 智谱 / OpenAI
  │  4 句滑动窗口上下文
  │  LLM 同时输出当前翻译 + 前句修正
  │
  ├──▶ translation 消息 → 前端译文栏
  ├──▶ correction 消息 → 前端修正高亮
  │
  ▼
TTS (tts.js)
  │  SiliconFlow CosyVoice（支持声音克隆）
  │  OpenAI TTS（备选）
  │  浏览器 speechSynthesis（降级方案）
  │
  ▼
WebSocket 推送 → 浏览器渲染双栏字幕 + 播放音频
```

### 2.2 混合 ASR 模式

| 模式 | 条件 | 实现 |
|------|------|------|
| 服务端 ASR | 配置了 `ASR_API_KEY` | PCM → WAV → Whisper API（SiliconFlow/Groq/OpenAI） |
| 浏览器 ASR | 未配置 API Key | Web Speech API（需 Chrome + 可访问 Google） |

音频数据始终通过 WebSocket 上传（用于频谱可视化 + 服务端 ASR）。

### 2.3 自动修正机制

#### A. ASR 层修正

- 流式 ASR 返回 interim（临时）和 final（最终）结果
- 字幕 UI 中 interim 灰色显示，final 白色锁定
- 浏览器 ASR 模式：Web Speech API 原生支持 `interimResults`

#### B. 翻译层修正（核心特性）

LLM 翻译时携带前 4 句上下文，要求返回：
- `target`：当前句翻译
- `corrections`：对前句的修正（如有）

```
段 1: "The model shows good performance"
翻译: "该模型表现良好"

段 2: "especially in few-shot learning scenarios"
翻译: "特别是在少样本学习场景中"
修正段 1: "该模型表现良好" → "这个模型表现出色"（结合后文语境调整）
```

LLM Prompt 要求以 JSON 格式返回 `{ target, corrections }` ，corrections 数组中每项包含 `{ id, target }` 。

### 2.4 声音克隆

1. 前端自动采集麦克风前 5 秒 PCM16 音频
2. 通过 WebSocket 发送 `voice_sample` 消息 + 二进制 PCM 数据
3. 服务端将 PCM 转为 WAV，base64 编码为 data URI
4. 后续 TTS 调用 CosyVoice API 时传入 `reference_audio` 参数
5. 克隆失败自动降级为预设语音

---

## 3. 技术选型

| 组件 | 主选方案 | 备选 | 说明 |
|------|---------|------|------|
| **运行时** | Node.js | - | API 生态好，WebSocket 原生支持 |
| **前端** | 原生 HTML/CSS/JS | - | 零依赖，黑白简约主题 |
| **ASR** | SiliconFlow SenseVoice | Groq Whisper, OpenAI Whisper | 国内可访问，成本低 |
| **翻译** | DeepSeek Chat | Qwen, Kimi, 智谱, OpenAI | 中文翻译质量好，便宜 |
| **TTS** | SiliconFlow CosyVoice | OpenAI TTS, 浏览器 speechSynthesis | 支持声音克隆 |
| **通信** | WebSocket | - | 全双工，低延迟 |

---

## 4. 项目结构

```
├── server/
│   ├── server.js           # HTTP 静态服务 + WebSocket 会话管理
│   ├── asr.js              # 流式 ASR: PCM 缓冲 → WAV → Whisper API
│   ├── providers.js        # LLM 翻译: RollingTranslator + 多 Provider
│   ├── tts.js              # TTS: CosyVoice 声音克隆 + 标准语音合成
│   ├── commit.js           # LocalAgreement-2 提交策略
│   ├── package.json        # Node.js 依赖 (ws, dotenv)
│   └── .env                # API Key 配置（不入库）
│
├── web/
│   ├── index.html          # 页面: 顶栏 + 控制条 + 频谱 + 双栏字幕
│   ├── app.js              # 音频采集 + WebSocket + 字幕渲染 + TTS
│   └── style.css           # 黑白简约主题 + 响应式
│
├── src/interp/             # Python 框架（预留，未启用）
├── .env.example            # 环境变量模板
└── .gitignore
```

---

## 5. WebSocket 消息协议

### 客户端 → 服务端

| type | 字段 | 说明 |
|------|------|------|
| `start` | `direction`, `mode?`, `filename?` | 开始会话 |
| `asr_interim` | `id`, `text` | 浏览器 ASR 临时结果 |
| `asr_final` | `id`, `text` | 浏览器 ASR 最终结果 |
| `voice_sample` | `sampleRate`, `samples` | 声音克隆参考（后跟二进制 PCM） |
| `file_done` | - | 文件音频传输完成 |
| (binary) | - | PCM16 音频数据 / 语音样本数据 |

### 服务端 → 客户端

| type | 字段 | 说明 |
|------|------|------|
| `ready` | `mode`, `asrMode`, `ttsMode` | 会话就绪 |
| `asr_partial` | `id`, `committed`, `pending` | ASR 临时识别结果 |
| `asr_final` | `id`, `text` | ASR 最终识别结果 |
| `translation` | `id`, `source`, `target` | 翻译结果 |
| `correction` | `id`, `target` | 译文修正 |
| `tts_audio` | `id`, `format`, `size` | TTS 音频即将发送（后跟二进制 mp3） |
| (binary) | - | TTS mp3 音频数据 |

---

## 6. 关键实现细节

### 6.1 ASR 缓冲策略 (asr.js)

- PCM 音频以 4096 样本为单位接收
- 缓冲到 40000 样本（2.5 秒）触发一次 Whisper API 调用
- 能量检测：若缓冲区均方根能量 < 200 则跳过（静音）
- PCM16 → WAV 格式转换（44 字节头 + PCM 数据）
- WAV 通过 multipart/form-data 上传至 Whisper API

### 6.2 滑动窗口翻译 (providers.js)

- 维护最近 4 句翻译历史
- 翻译时将历史上下文 + 当前句拼入 LLM prompt
- LLM 返回 JSON: `{ target: "当前翻译", corrections: [{ id, target }] }`
- 修正通过 `correction` 消息推送到前端

### 6.3 声音克隆 (tts.js)

- 每个 WebSocket 会话独立维护参考音频
- PCM16 → WAV → base64 data URI
- CosyVoice API `reference_audio` 参数传入 data URI
- 会话结束时自动清理参考音频

### 6.4 前端音频处理 (app.js)

- `getUserMedia` 采集麦克风
- `AudioContext` → `AnalyserNode`（频谱可视化）+ `ScriptProcessor`（PCM 发送）
- 降采样：浏览器原生采样率 → 16kHz PCM16
- 前 5 秒音频同时用于声音克隆样本采集
