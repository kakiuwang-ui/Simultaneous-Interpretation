# AI 同声传译助手 - 技术设计文档

## 1. 项目概述

### 1.1 题目要求

开发一款 AI 同声传译助手，实时翻译英语/中文音频流为目标语言字幕和语音，具备自动修正能力。

### 1.2 核心需求

| 维度 | 实现 |
|------|------|
| 翻译方向 | **多语言**：中文、英语、日语、韩语 12 方向互译，双下拉选择器 + 一键交换 |
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
  ├──▶ ASR 语音识别（双模式）
  │      【实时麦克风模式】浏览器 Web Speech API
  │        逐词显示、低延迟、语言由浏览器指定
  │      【文件上传模式】服务器 StreamingASR (asr.js)
  │        缓冲 PCM → 拼接为 WAV → Whisper API 识别
  │        每 2.5 秒触发一次识别
  │        静音检测（能量 < 200 跳过）
  │        明确指定源语言（从 direction 提取）
  │        处理完毕自动续处理剩余数据
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
│   ├── style.css           # 黑白简约主题 + 响应式
│   └── overlay.html        # OBS 字幕叠加页面（透明背景，浏览器源）
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
| `feedback` | `id` | 用户标记译文不准确 |
| `file_done` | - | 文件音频传输完成 |
| (binary) | - | PCM16 音频数据 / 语音样本数据 |

### 服务端 → 客户端

| type | 字段 | 说明 |
|------|------|------|
| `ready` | `mode`, `asrMode`, `ttsMode` | 会话就绪 |
| `asr_partial` | `id`, `committed`, `pending` | ASR 临时识别结果 |
| `asr_final` | `id`, `text`, `startTime`, `endTime`, `speaker` | ASR 最终识别结果（含时间戳和说话人） |
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
- PCM16 → WAV → base64 data URI → ASR 转录获取 transcript
- CosyVoice2 API 使用 `references` 数组（含 `audio` data URI + `text` 转录文本）
- `voice` 和 `references` 互斥，克隆时不传 `voice`
- 转录为空时跳过克隆，降级为预设音色（`FunAudioLLM/CosyVoice2-0.5B:anna`）
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

**实时模式（麦克风）和文件模式**：
- `.subtitles` 默认 `overflow-y: auto` + `scroll-behavior: smooth`，所有字幕可见，自动滚到底部
- 与第一版一致的简单滚动行为

**视频播放模式（处理完后播放）**：
- 播放时自动切换为轮播，已过字幕隐藏，当前及未来字幕可见
- ASR 输出时间戳（`processedSamples / 16000`），用于字幕与视频对齐
- 段间隙时保持显示最近的已播完段，避免字幕消失
- 暂停时恢复所有字幕可见，方便浏览和编辑

### 6.8 多语言翻译与语言选择器

**支持语言**：EN、中文、日本語、한국어（4 种语言，12 个翻译方向）

**语言选择器 UI**：
- 顶栏双下拉选择器：左侧选源语言，右侧选目标语言
- 中间箭头按钮可一键交换源↔目标，带旋转动画
- 选择源/目标时自动避免相同语言（自动切换另一侧）
- 选择后自动推导 `direction` 键（如 `en2ja`），更新字幕栏标题

**翻译 Prompt**：
- 每个方向有独立的 system prompt（`SYSTEM_PROMPTS` 对象）
- system prompt 使用目标语言书写，确保 LLM 输出正确语种
- user prompt 追加目标语言提示（`TARGET_LANG_HINT`），如 `日本語に翻訳してください`

### 6.9 SRT 字幕导出

- 下拉菜单提供 3 种导出模式：双语字幕、仅原文、仅译文
- 文件模式有精确时间戳（来自 ASR `processedSamples / 16000`）
- 实时模式无时间戳时按 5 秒间隔估算
- 使用 Blob + `<a>` 下载，文件名含类型和时间戳

### 6.10 翻译上下文记忆与术语表

- 上下文窗口从 4 句扩大到 8 句，提供更好的翻译连贯性
- LLM 翻译时额外输出 `terms` 字段（术语对照），累积为全局术语表
- 后续翻译 prompt 注入术语表，确保同一术语始终统一翻译
- 术语表上限 30 条，FIFO 淘汰

### 6.11 说话人分离

- 基于静音间隔的简单说话人切换检测（非 ML 方案）
- 服务器端 ASR：连续静音 > 2 秒时切换说话人标记（Speaker 0 / 1 交替）
- 浏览器 ASR：利用两次 `asr_final` 之间的时间间隔判断说话人切换
- 前端为不同说话人分配不同颜色左边框和标签（蓝色 A / 橙色 B）
- 译文自动继承对应原文的说话人标记

### 6.12 流式 TTS 优化

- 长句拆分：超过 50 字符的译文按标点拆分，只合成第一段以降低延迟
- TTS 队列跳过：新译文到达时跳过队列中的旧文本，直接播放最新内容
- 回声防止：TTS 播放期间暂停 ASR 和麦克风 PCM 发送

### 6.13 会话持久化

- 使用 localStorage 自动保存字幕数据（原文、译文、时间戳、说话人标记）
- 页面刷新后自动恢复上次的字幕记录和语言方向
- 开始新会话时自动清除旧记录

### 6.14 翻译质量反馈

- 译文行 hover 时显示反馈按钮，点击标记"翻译不准确"
- 反馈发送到服务端，记录在 RollingTranslator 中（最多保留 3 条）
- 后续翻译 prompt 注入反馈信息，提示 LLM 改进类似翻译

### 6.15 OBS 实时字幕叠加

- 独立的 `/overlay.html` 页面，透明背景，只显示最新一条字幕
- OBS 作为浏览器源捕获，适用于直播场景
- URL 参数控制显示模式：`?mode=source|target|both`
- 通过 WebSocket 接收广播消息，无需独立翻译会话
- 主页面提供"复制 OBS 链接"按钮

---

## 7. 开发过程中遇到的问题与解决方案

### 7.1 浏览器无法解码视频文件

**问题**：使用 `OfflineAudioContext.decodeAudioData` 解码上传的视频文件时报错 "Decoding failed"。浏览器的 Web Audio API 对视频格式（mp4、mkv 等）支持不完整，尤其是某些编码格式。

**尝试**：先改用 `AudioContext.decodeAudioData`（兼容性略好），但仍然无法处理所有格式。

**最终方案**：将文件上传到服务端，用 ffmpeg 进行转码。ffmpeg 支持几乎所有音视频格式，转码输出为标准 16kHz PCM16，彻底解决兼容性问题。

**为什么不在前端用 ffmpeg.wasm？** 因为 ffmpeg.wasm 体积大（~30MB），加载慢，且需要特殊 HTTP 头（SharedArrayBuffer），部署复杂。服务端 ffmpeg 更简单可靠。

### 7.2 实时模式 ASR 方案演进

**问题**：最初配置了 `ASR_API_KEY` 后，系统将所有模式（包括实时麦克风）都切换到服务器端 Whisper ASR。服务器 ASR 每 2.5 秒积攒一段才识别，无法逐词显示，延迟明显。且 SenseVoice 的自动语言检测不稳定，可能将英文识别成中文。

**尝试的方案**：
1. 缩短分段时间、增加尾部重叠 → 导致重复文字，效果更差
2. 降低能量阈值 → 更多噪音误识别

**最终方案**：双模式 ASR
- **实时麦克风模式**：始终使用浏览器 Web Speech API（逐词显示、低延迟、语言准确）
- **文件上传模式**：使用服务器 Whisper ASR（SiliconFlow SenseVoice，支持任意格式）
- 服务器 ASR 明确指定源语言（从 `direction` 提取，如 `en2zh` → `lang='en'`），避免自动检测出错

### 7.3 dotenv 环境变量加载路径

**问题**：`.env` 文件在 `server/` 目录下，但 `import 'dotenv/config'` 默认从进程工作目录（项目根目录）加载 `.env`，导致从根目录启动 `node server/server.js` 时 `LLM_API_KEY` 等环境变量未被加载，翻译功能失效。

**解决方案**：改用 `dotenv.config({ path: path.join(__server_dir, '.env') })`，明确指定 `.env` 路径为 `server/.env`，确保从任意工作目录启动都能正确加载。

### 7.4 文件上传后 ASR 丢失数据

**问题**：文件音频通过 WebSocket 快速发送，ASR 的 `_processChunk` 是异步操作（等待 API 返回），处理期间 `processing=true` 阻止新的识别。但新数据仍在缓冲。当 `file_done` 到达时调用 `flush()`，如果此时还在 processing 则 flush 直接跳过，导致大量音频未被识别。

**解决方案**：
1. `flush()` 改为 `while(processing) await sleep(100)` 等待当前处理完成
2. `_processChunk` 完成后自动检查 `totalSamples >= chunkThreshold`，触发续处理
3. 加大每次发送的数据块（0.5 秒）和间隔（100ms），减少积压

### 7.5 语言选择器从单按钮到双下拉

**演进**：
1. 最初用单个按钮循环切换语言方向，箭头旋转导致语义不清
2. 改为单个 `<select>` 下拉列出所有方向（如 `EN → 中文`），选项过多
3. 最终采用双下拉选择器 + 中间交换箭头按钮，直觉清晰

**实现细节**：
- 两个 `<select>` 各含 4 种语言，样式为 pill 形状（`appearance: none` + 自定义下拉箭头 SVG）
- 交换按钮点击时值互换，带 180 度旋转动画（`swap-spin` keyframe，0.4s）
- 选择时自动防止源=目标（自动将另一侧切换为第一个不同的语言）
- `deriveDirection()` 根据 from/to 值拼接 direction 键（如 `en2ja`）

### 7.6 字幕轮播跳动和消失问题

**问题**：实时模式下轮播字幕会上下跳动，甚至完全不显示。

**原因分析**：
1. 使用 `display: none` 隐藏旧行会触发布局 reflow，配合 `justify-content: center` 导致剩余行上下跳动
2. 三层渐变设计（显示/半透明/隐藏）在 `CAROUSEL_MAX=1` 时，`age===0` 的当前行被误归入半透明层

**解决方案**：
1. 隐藏行改用 `position: absolute; visibility: hidden`，不影响布局流
2. 容器改为 `justify-content: flex-start`，行从顶部排列
3. 简化为二层设计：当前及之后的行可见，之前的行隐藏
4. 文件模式加 `scroll-mode` 类恢复 `overflow-y: auto` 传统滚动

### 7.7 浏览器 TTS 无中文语音

**问题**：浏览器 `speechSynthesis` 设置 `utterance.lang = 'zh-CN'` 后仍输出英文机器人声，因为系统可能没有安装中文语音包。

**解决方案**：优先使用服务端 TTS（SiliconFlow CosyVoice，支持中文和声音克隆）。浏览器 TTS 作为降级方案，通过 `getVoices()` 枚举可用语音并选择匹配的中文语音。
