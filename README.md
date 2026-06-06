# AI 同声传译助手

实时语音识别 + LLM 翻译 + 自动修正 + 声音克隆，支持中英日韩多语言同声传译。

## 功能特性

- **实时语音识别**：麦克风实时收音 → 浏览器 Web Speech API（逐词显示、低延迟）；文件上传 → 服务端 Whisper ASR（SiliconFlow SenseVoice）
- **多语言翻译**：支持中文、英语、日语、韩语之间 12 个方向的互译，双下拉选择器 + 一键交换
- **自动修正**：LLM 滑动窗口上下文翻译，后文消歧后自动回改前句译文
- **声音克隆 TTS**：自动采集说话者前 5 秒语音，通过 CosyVoice 克隆声音进行语音播报
- **双栏字幕**：原文 + 译文实时显示，已定稿 / 临时 / 已修正 三态标记
- **字幕滚动**：所有字幕实时滚动显示，自动跟随最新内容
- **原文编辑**：双击原文可编辑，修改后自动重新翻译
- **视频字幕同步**：播放视频时字幕跟随播放进度，已过字幕自动隐藏
- **音频频谱**：实时可视化音频输入波形
- **文件翻译**：支持上传任意格式音视频文件（服务端 ffmpeg 转码）
- **视频预览**：上传视频文件后自动显示视频播放器
- **导出字幕**：一键导出 SRT 字幕文件（含原文和译文）

## 快速开始

### 前置依赖

- Node.js 18+
- ffmpeg（`brew install ffmpeg`）

### 安装运行

```bash
cd server
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 API Key

npm start
# 浏览器打开 http://localhost:8787
```

## 环境变量配置

在 `server/.env` 中配置：

```bash
# 翻译 LLM（必填）
MT_PROVIDER=deepseek          # deepseek / qwen / kimi / zhipu / openai
LLM_API_KEY=sk-xxx

# ASR 语音识别（推荐配置，否则降级为浏览器 Web Speech API）
ASR_PROVIDER=siliconflow      # siliconflow / groq / openai
ASR_API_KEY=xxx

# TTS 语音合成（可选，不配则用浏览器自带语音）
TTS_PROVIDER=siliconflow      # siliconflow / openai
TTS_API_KEY=xxx
```

### API Key 获取

| 服务 | 用途 | 注册地址 | 费用 |
|------|------|---------|------|
| DeepSeek | LLM 翻译 | https://platform.deepseek.com | 按量付费 |
| SiliconFlow | ASR + TTS（含声音克隆） | https://cloud.siliconflow.cn | ASR 免费 |
| Groq | ASR（备选，免费快速） | https://console.groq.com | 免费 |
| 通义千问 | LLM 翻译（备选） | https://dashscope.console.aliyun.com | 按量付费 |

## 架构

```
浏览器麦克风 / 上传文件
  │
  │  麦克风: getUserMedia → 16kHz PCM16 → WebSocket
  │  文件:   POST /upload → ffmpeg 转码 → PCM16 → WebSocket
  │
  ▼
Node.js 服务端
  │
  ├──▶ StreamingASR (Whisper API)
  │      5秒分段 + 0.5秒重叠 + 自动语言检测
  │
  ├──▶ RollingTranslator (DeepSeek LLM)
  │      4句滑动窗口 + 自动修正前句
  │
  ├──▶ CosyVoice TTS (声音克隆)
  │
  ▼
WebSocket 推送 → 双栏字幕 + 语音播报
```

## 自动修正机制

| 层级 | 机制 | 说明 |
|------|------|------|
| ASR 识别 | interim → final | 流式识别不断更新，静音后输出最终结果 |
| 翻译回改 | LLM 滑动窗口 | 翻译新句时带前 4 句上下文，LLM 判断是否需要修正前句译文 |
| 字幕展示 | 三态标记 | 白色=已定稿，灰色=临时，黄色闪烁=已修正 |
| 人工修正 | 双击编辑原文 | 编辑原文后服务端自动重新翻译 |

## 项目结构

```
├── server/
│   ├── server.js         # HTTP + WebSocket + ffmpeg 文件转码
│   ├── asr.js            # 流式 ASR（5秒分段 + 重叠 + 自动语言检测）
│   ├── providers.js      # LLM 翻译 + 滑动窗口修正
│   ├── tts.js            # TTS 语音合成 + 声音克隆
│   ├── commit.js         # LocalAgreement-2 提交策略
│   └── .env              # 环境变量配置（不提交）
├── web/
│   ├── index.html        # 页面结构（含视频预览）
│   ├── app.js            # 前端逻辑（音频采集、文件上传、字幕渲染）
│   └── style.css         # 黑白简约主题样式
├── docs/
│   └── design.md         # 技术设计文档（含问题排查记录）
└── .env.example          # 环境变量模板
```

## 使用说明

1. 点击「开始」按钮，允许浏览器访问麦克风
2. 在顶栏语言选择器中分别选择源语言和目标语言，点击中间箭头可一键交换方向
3. 支持 EN、中文、日本語、한국어 四种语言的任意方向互译（12 个翻译方向）
4. 点击「语音」按钮开启 TTS 语音播报
5. 支持上传任意格式音视频文件（mp4、mkv、avi、mp3、wav 等）
6. 实时模式下字幕轮播显示当前一句；文件模式下显示完整列表
7. 双击原文可编辑，修改后译文自动更新
8. 视频播放时字幕自动同步，已播完的字幕隐藏，暂停时恢复全部
9. 修正的译文会黄色高亮并标记「已修正」
10. 点击「导出SRT」按钮下载字幕文件

## 技术栈

- **后端**：Node.js + WebSocket (`ws`) + ffmpeg
- **前端**：原生 HTML/CSS/JS，黑白简约主题
- **ASR**：SiliconFlow SenseVoice（自动语言检测） / Groq Whisper / OpenAI Whisper
- **翻译**：DeepSeek / 通义千问 / Kimi / 智谱 / OpenAI（兼容 OpenAI Chat API 格式）
- **TTS**：SiliconFlow CosyVoice（支持声音克隆） / OpenAI TTS / 浏览器 speechSynthesis
