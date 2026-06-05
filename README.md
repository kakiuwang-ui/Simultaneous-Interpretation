# AI 同声传译助手

实时语音识别 + LLM 翻译 + 自动修正 + 声音克隆，支持英中双向同声传译。

## 功能特性

- **实时语音识别**：麦克风收音 → 服务端 Whisper ASR（SiliconFlow / Groq / OpenAI）
- **双向翻译**：EN → 中文 / 中文 → EN，一键切换
- **自动修正**：LLM 滑动窗口上下文翻译，后文消歧后自动回改前句译文
- **声音克隆 TTS**：自动采集说话者前 5 秒语音，通过 CosyVoice 克隆声音进行语音播报
- **双栏字幕**：原文 + 译文实时显示，已定稿 / 临时 / 已修正 三态标记
- **音频频谱**：实时可视化音频输入波形
- **文件翻译**：支持上传音视频文件离线翻译

## 快速开始

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

| 服务 | 用途 | 注册地址 |
|------|------|---------|
| DeepSeek | LLM 翻译 | https://platform.deepseek.com |
| SiliconFlow | ASR + TTS（含声音克隆） | https://siliconflow.cn |
| Groq | ASR（备选，免费快速） | https://console.groq.com |
| 通义千问 | LLM 翻译（备选） | https://dashscope.console.aliyun.com |

## 架构

```
浏览器麦克风 ──PCM 16kHz──▶ WebSocket ──▶ Node.js 服务端
                                              │
                              ┌────────────────┤
                              ▼                ▼
                     StreamingASR         语音样本采集
                   (Whisper API)         (前5秒→声音克隆)
                              │
                              ▼
                    RollingTranslator
                  (DeepSeek LLM 翻译)
                   4句滑动窗口上下文
                   自动修正前句译文
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              WebSocket 推送        CosyVoice TTS
            双栏字幕 + 修正标记     声音克隆语音播报
```

## 自动修正机制

| 层级 | 机制 | 说明 |
|------|------|------|
| ASR 识别 | interim → final | 流式识别不断更新，静音后输出最终结果 |
| 翻译回改 | LLM 滑动窗口 | 翻译新句时带前 4 句上下文，LLM 判断是否需要修正前句译文 |
| 字幕展示 | 三态标记 | 白色=已定稿，灰色=临时，黄色闪烁=已修正 |

## 声音克隆

启用服务端 TTS 后（配置 `TTS_API_KEY`），系统会：

1. 自动采集麦克风前 5 秒音频作为参考样本
2. 将参考音频发送至服务端
3. 后续 TTS 使用 CosyVoice 声音克隆 API，以说话者声音播报译文
4. 克隆失败时自动降级为预设语音

## 技术栈

- **后端**：Node.js + WebSocket (`ws`)
- **前端**：原生 HTML/CSS/JS，黑白简约主题
- **ASR**：SiliconFlow SenseVoice / Groq Whisper / OpenAI Whisper
- **翻译**：DeepSeek / 通义千问 / Kimi / 智谱 / OpenAI（兼容 OpenAI Chat API 格式）
- **TTS**：SiliconFlow CosyVoice（支持声音克隆） / OpenAI TTS / 浏览器 speechSynthesis

## 项目结构

```
├── server/
│   ├── server.js         # HTTP + WebSocket 服务，会话管理
│   ├── asr.js            # 流式 ASR（PCM→WAV→Whisper API）
│   ├── providers.js      # LLM 翻译 + 滑动窗口修正
│   ├── tts.js            # TTS 语音合成 + 声音克隆
│   ├── commit.js         # LocalAgreement-2 提交策略
│   └── .env              # 环境变量配置（不提交）
├── web/
│   ├── index.html        # 页面结构
│   ├── app.js            # 前端逻辑（音频采集、WebSocket、字幕渲染）
│   └── style.css         # 黑白简约主题样式
└── .env.example          # 环境变量模板
```

## 使用说明

1. 点击「开始」按钮，允许浏览器访问麦克风
2. 点击语言切换按钮（EN → 中文）可切换翻译方向
3. 点击「语音」按钮开启 TTS 语音播报
4. 支持上传音视频文件进行离线翻译
5. 字幕区域自动滚动，修正的译文会黄色高亮并标记「已修正」
