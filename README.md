# AI 同声传译助手

实时语音识别 + LLM 翻译 + 自动修正 + 声音克隆，支持中英日韩多语言同声传译。

## 项目演示地址
https://www.bilibili.com/video/BV1MEEt6zEKa/

## 功能特性

- **实时语音识别**：麦克风实时收音 → 浏览器 Web Speech API（逐词显示、低延迟）+ 服务端 Whisper 双路 ASR 并行
- **多语言翻译**：支持中文、英语、日语、韩语之间 12 个方向的互译，双下拉选择器 + 一键交换
- **自动修正**：LLM 8 句滑动窗口上下文翻译，后文消歧后自动回改前句译文
- **声音克隆 TTS**：自动采集说话者前 5 秒语音，通过 CosyVoice2 克隆声音进行语音播报
- **双栏字幕**：原文 + 译文实时显示，已定稿 / 临时 / 已修正 三态标记
- **画中画字幕**：Document PiP 浮窗字幕，始终置顶显示
- **音频频谱**：实时可视化音频输入波形
- **5 种输入模式**：麦克风实时 / 音视频文件上传 / 浏览器标签页捕获 / 在线视频 URL / OBS 字幕叠加
- **视频字幕同步**：播放视频时字幕跟随播放进度，已过字幕自动隐藏
- **原文编辑**：双击原文可编辑，修改后自动重新翻译
- **导出字幕**：一键导出 SRT 字幕文件（含原文和译文）
- **多 Provider 支持**：LLM / ASR / TTS 各支持多家供应商，统一抽象 + 三层 fallback 降级

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
浏览器（5 种输入模式）
  │
  │  麦克风: getUserMedia → 16kHz PCM16 → WebSocket 二进制帧直传
  │  文件:   POST /upload → ffmpeg 转码 → PCM16 → WebSocket
  │  标签页: getDisplayMedia → AudioContext 重采样 → WebSocket
  │
  ├──▶ 浏览器 Web Speech API（实时字幕，~0ms 延迟）
  │      LocalAgreement-2 字幕稳定算法
  │
  ▼
Node.js 服务端
  │
  ├──▶ StreamingASR (SenseVoice / Whisper)
  │      VAD 双阈值端点检测 + 5秒分段 + 0.5秒重叠
  │
  ├──▶ RollingTranslator (DeepSeek LLM)
  │      8句滑动窗口 + 流式 Regex 提取 + 自动修正前句
  │
  ├──▶ CosyVoice2 TTS (声音克隆)
  │      5秒自动采集 + JSON+Binary 两帧模式
  │
  ▼
WebSocket 推送 → 双栏字幕 + 画中画浮窗 + 语音播报
```

## 核心算法

| 算法 | 说明 |
|------|------|
| LocalAgreement-2 | 比较相邻两次 ASR 结果，只提交一致的前缀，避免字幕闪烁 |
| VAD 双阈值端点检测 | 能量上升超阈值开始录音，下降低于阈值且持续静音后切断，减少无效请求 |
| 滑动窗口翻译 | 携带前 8 句上下文，LLM 可回溯修正前句译文（如 "bank" 消歧） |
| 流式 JSON 提取 | Regex 从不完整的流式 LLM 输出中提取翻译结果，实现边生成边显示 |

## 自动修正机制

| 层级 | 机制 | 说明 |
|------|------|------|
| ASR 识别 | interim → final | 流式识别不断更新，静音后输出最终结果 |
| 翻译回改 | LLM 滑动窗口 | 翻译新句时带前 8 句上下文，LLM 判断是否需要修正前句译文 |
| 字幕展示 | 三态标记 | 白色=已定稿，灰色=临时，黄色闪烁=已修正 |
| 人工修正 | 双击编辑原文 | 编辑原文后服务端自动重新翻译 |

## 项目结构

```
├── server/
│   ├── server.js         # HTTP + WebSocket + ffmpeg 文件转码
│   ├── asr.js            # 流式 ASR（VAD + 分段 + 重叠 + 语言检测）
│   ├── providers.js      # 多 Provider 统一抽象 + LLM 翻译 + 滑动窗口修正
│   ├── tts.js            # TTS 语音合成 + 声音克隆（CosyVoice2）
│   ├── commit.js         # LocalAgreement-2 提交策略
│   └── .env              # 环境变量配置（不提交）
├── web/
│   ├── index.html        # 主应用页面
│   ├── app.js            # 前端逻辑（音频采集、5种输入模式、字幕渲染、画中画）
│   ├── style.css         # 黑白简约主题样式
│   ├── demo.html         # 技术演示页（架构图、算法、协议、选型分析）
│   ├── demo.css          # 演示页样式
│   └── overlay.html      # OBS 字幕叠加页
├── docs/
│   ├── design.md         # 技术设计文档（含问题排查记录）
│   ├── feature-plan-v2.md # 功能规划文档
│   └── presentation.md   # 演示稿 + 面试 Q&A
└── .env.example          # 环境变量模板
```

## 使用说明

1. 点击「开始」按钮，允许浏览器访问麦克风
2. 在顶栏语言选择器中分别选择源语言和目标语言，点击中间箭头可一键交换方向
3. 支持 EN、中文、日本語、한국어 四种语言的任意方向互译（12 个翻译方向）
4. 点击「语音」按钮开启 TTS 语音播报（自动克隆说话者声音）
5. 支持 5 种输入模式：麦克风实时、音视频文件上传、浏览器标签页捕获、在线视频 URL、OBS 字幕叠加
6. 实时模式下字幕轮播显示当前一句；文件模式下显示完整列表
7. 双击原文可编辑，修改后译文自动更新
8. 视频播放时字幕自动同步，已播完的字幕隐藏，暂停时恢复全部
9. 修正的译文会黄色高亮并标记「已修正」
10. 点击「导出SRT」按钮下载字幕文件

## 技术栈

- **后端**：Node.js + WebSocket (`ws`) + ffmpeg
- **前端**：原生 HTML/CSS/JS，零框架依赖，黑白简约主题
- **ASR**：SiliconFlow SenseVoice / Groq Whisper / OpenAI Whisper + 浏览器 Web Speech API
- **翻译**：DeepSeek / 通义千问 / Kimi / 智谱 / OpenAI / SiliconFlow（6 家 Provider 可切换）
- **TTS**：SiliconFlow CosyVoice2（声音克隆） / OpenAI TTS / 浏览器 speechSynthesis
