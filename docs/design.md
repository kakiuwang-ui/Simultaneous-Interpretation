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
浏览器麦克风 / 上传文件
  │  getUserMedia + ScriptProcessor（麦克风）
  │  POST /upload → ffmpeg 转码（文件）
  │  统一降采样为 16kHz PCM16
  ▼
WebSocket 上传
  │
  ├──▶ StreamingASR (asr.js)
  │      缓冲 PCM → 拼接为 WAV → Whisper API 识别
  │      每 5 秒触发一次识别
  │      0.5 秒尾部重叠（避免断词）
  │      静音检测（能量 < 50 跳过）
  │      自动语言检测（无需指定语言）
  │      处理完毕自动续处理剩余数据
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

### 2.5 文件上传与 ffmpeg 转码

1. 前端将原始音视频文件 POST 到 `/upload` 接口
2. 服务端保存为临时文件，调用 ffmpeg 转码为 16kHz 单声道 PCM16
3. 转码后的 PCM 数据返回给前端
4. 前端分块（每块 0.5 秒）通过 WebSocket 发送给 ASR
5. 视频文件同时在前端显示视频预览播放器

**为什么用 ffmpeg 而不是浏览器解码？**
- 浏览器 `AudioContext.decodeAudioData` 对视频格式支持有限（mkv、某些 mp4 编码会失败）
- ffmpeg 支持几乎所有音视频格式，转码可靠
- 服务端处理避免了浏览器兼容性问题

---

## 3. 技术选型

| 组件 | 主选方案 | 备选 | 说明 |
|------|---------|------|------|
| **运行时** | Node.js | - | API 生态好，WebSocket 原生支持 |
| **前端** | 原生 HTML/CSS/JS | - | 零依赖，黑白简约主题 |
| **ASR** | SiliconFlow SenseVoice | Groq Whisper, OpenAI Whisper | 国内可访问，免费，支持自动语言检测 |
| **翻译** | DeepSeek Chat | Qwen, Kimi, 智谱, OpenAI | 中文翻译质量好，便宜 |
| **TTS** | SiliconFlow CosyVoice | OpenAI TTS, 浏览器 speechSynthesis | 支持声音克隆 |
| **通信** | WebSocket | - | 全双工，低延迟 |
| **文件转码** | ffmpeg | 浏览器 AudioContext | 格式兼容性好，支持所有音视频格式 |

---

## 4. 项目结构

```
├── server/
│   ├── server.js           # HTTP 静态服务 + 文件上传接口 + WebSocket 会话管理
│   ├── asr.js              # 流式 ASR: PCM 缓冲 → WAV → Whisper API
│   ├── providers.js        # LLM 翻译: RollingTranslator + 多 Provider
│   ├── tts.js              # TTS: CosyVoice 声音克隆 + 标准语音合成
│   ├── commit.js           # LocalAgreement-2 提交策略
│   ├── package.json        # Node.js 依赖 (ws, dotenv)
│   └── .env                # API Key 配置（不入库）
│
├── web/
│   ├── index.html          # 页面: 顶栏 + 控制条 + 视频预览 + 频谱 + 双栏字幕
│   ├── app.js              # 音频采集 + 文件上传 + WebSocket + 字幕渲染 + TTS
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
| `retranslate` | `id`, `text` | 用户编辑原文后重新翻译 |
| `file_done` | - | 文件音频传输完成 |
| (binary) | - | PCM16 音频数据 / 语音样本数据 |

### 服务端 → 客户端

| type | 字段 | 说明 |
|------|------|------|
| `ready` | `mode`, `asrMode`, `ttsMode` | 会话就绪 |
| `asr_partial` | `id`, `committed`, `pending` | ASR 临时识别结果 |
| `asr_final` | `id`, `text`, `startTime`, `endTime` | ASR 最终识别结果（含时间戳） |
| `translation` | `id`, `source`, `target` | 翻译结果 |
| `correction` | `id`, `target` | 译文修正 |
| `tts_audio` | `id`, `format`, `size` | TTS 音频即将发送（后跟二进制 mp3） |
| (binary) | - | TTS mp3 音频数据 |

---

## 6. 关键实现细节

### 6.1 ASR 缓冲策略 (asr.js)

- PCM 音频以 8000 样本（0.5 秒）为单位接收
- 缓冲到 80000 样本（5 秒）触发一次 Whisper API 调用
- **尾部重叠**：每段保留最后 0.5 秒（8000 样本）拼到下一段开头，避免单词在分段边界被截断
- 能量检测：若缓冲区平均能量 < 50 则跳过（静音）
- **自动语言检测**：不传 `language` 参数，让 SenseVoice 自动识别中/英文
- **续处理**：每次识别完成后检查是否有新积累的数据达到阈值，自动触发下一次识别
- `flush()` 等待当前处理完成后再处理剩余数据，确保文件末尾不丢失

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

### 6.5 文件上传 (server.js + app.js)

- 前端将原始文件 POST 到 `/upload`，无需浏览器解码
- 服务端用 `child_process.spawn('ffmpeg', ...)` 转码，输出管道直接读取
- 临时文件用完即删，避免磁盘占用
- 视频文件上传后前端用 `URL.createObjectURL` 创建预览播放器

### 6.6 原文编辑与重新翻译

- 双击原文行进入编辑模式，显示 inline `<input>` 输入框
- 按 Enter 确认、Escape 取消、失焦自动保存
- 编辑后发送 `retranslate` 消息到服务端，更新翻译历史并重新翻译
- 清空原文则删除该行（原文 + 译文同时删除）

### 6.7 字幕轮播与视频同步

**实时模式（麦克风）**：
- 轮播显示：只显示当前最新一句，旧的自动隐藏
- 隐藏行使用 `position: absolute; visibility: hidden` 避免布局跳动

**文件模式（上传处理中）**：
- 传统滚动列表，所有字幕可见，自动滚到底部
- 使用 `scroll-mode` CSS 类切换为 `overflow-y: auto`

**视频播放模式（处理完后播放）**：
- 播放时自动切换为轮播，已过字幕隐藏，当前及未来字幕可见
- ASR 输出时间戳（`processedSamples / 16000`），用于字幕与视频对齐
- 段间隙时保持显示最近的已播完段，避免字幕消失
- 暂停时恢复所有字幕可见，方便浏览和编辑

---

## 7. 开发过程中遇到的问题与解决方案

### 7.1 浏览器无法解码视频文件

**问题**：使用 `OfflineAudioContext.decodeAudioData` 解码上传的视频文件时报错 "Decoding failed"。浏览器的 Web Audio API 对视频格式（mp4、mkv 等）支持不完整，尤其是某些编码格式。

**尝试**：先改用 `AudioContext.decodeAudioData`（兼容性略好），但仍然无法处理所有格式。

**最终方案**：将文件上传到服务端，用 ffmpeg 进行转码。ffmpeg 支持几乎所有音视频格式，转码输出为标准 16kHz PCM16，彻底解决兼容性问题。

**为什么不在前端用 ffmpeg.wasm？** 因为 ffmpeg.wasm 体积大（~30MB），加载慢，且需要特殊 HTTP 头（SharedArrayBuffer），部署复杂。服务端 ffmpeg 更简单可靠。

### 7.2 ASR 识别效果不理想

**问题**：初始方案每 2.5 秒分段一次，能量阈值设为 200，固定指定语言为英文。导致：
- 短音频片段缺乏上下文，识别准确率低
- 分段可能在单词中间截断
- 中文视频用英文模式识别，结果完全错误
- 能量阈值过高，安静语音被误跳过

**解决方案**：
1. **增大分段至 5 秒**：给 ASR 模型更多上下文，准确率显著提升
2. **0.5 秒尾部重叠**：上一段末尾的 0.5 秒拼到下一段开头，避免截断
3. **自动语言检测**：去掉 `language` 参数，让 SenseVoice 自动判断语言
4. **降低能量阈值至 50**：避免漏掉较安静的语音

### 7.3 Web Speech API 在国内不可用

**问题**：浏览器的 Web Speech API 依赖 Google 语音服务，在国内被 GFW 屏蔽，导致麦克风录音后无法识别。

**解决方案**：实现服务端 ASR，使用 SiliconFlow 提供的 SenseVoice 模型（国内可访问，免费）。保留浏览器 ASR 作为降级方案（未配置 API Key 时使用）。

### 7.4 文件上传后 ASR 丢失数据

**问题**：文件音频通过 WebSocket 快速发送，ASR 的 `_processChunk` 是异步操作（等待 API 返回），处理期间 `processing=true` 阻止新的识别。但新数据仍在缓冲。当 `file_done` 到达时调用 `flush()`，如果此时还在 processing 则 flush 直接跳过，导致大量音频未被识别。

**解决方案**：
1. `flush()` 改为 `while(processing) await sleep(100)` 等待当前处理完成
2. `_processChunk` 完成后自动检查 `totalSamples >= chunkThreshold`，触发续处理
3. 加大每次发送的数据块（0.5 秒）和间隔（100ms），减少积压

### 7.5 翻译方向切换的 UI 问题

**问题**：切换翻译方向时，按钮标签交换（EN ↔ 中文）的同时箭头也旋转 180 度。结果 `中文 ← EN` 和 `EN → 中文` 表达的是同一个意思，用户无法区分方向。

**解决方案**：去掉箭头旋转逻辑，只交换标签文字。箭头始终朝右，`EN → 中文` 切换后变为 `中文 → EN`，语义清晰。

### 7.6 浏览器 TTS 无中文语音

**问题**：浏览器 `speechSynthesis` 设置 `utterance.lang = 'zh-CN'` 后仍输出英文机器人声，因为系统可能没有安装中文语音包。

**解决方案**：优先使用服务端 TTS（SiliconFlow CosyVoice，支持中文和声音克隆）。浏览器 TTS 作为降级方案，通过 `getVoices()` 枚举可用语音并选择匹配的中文语音。
