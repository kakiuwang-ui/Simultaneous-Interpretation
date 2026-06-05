# AI 同声传译助手

把**单向音频流**(看英文演讲 / 技术分享 / 国际会议 / 网课时电脑播放的声音)实时翻译成**中文字幕**,并具备**自动修正**能力——后文出现后能回头纠正之前识别或翻译的错误。

> 本仓库是可运行的第一版骨架(MVP)。默认 **mock 模式**,无需任何 API key 即可启动,用脚本化数据真实演示"识别修正 + 翻译修正"的字幕效果。

## 快速开始

```bash
cd server
npm install
npm start
# 浏览器打开 http://localhost:8787
```

页面上两个按钮:

- **⚡ 跑演示**:不需要共享音频,直接观看双栏字幕的"修正"效果(推荐先看这个)。
- **▶ 开始**:弹出"共享标签页/屏幕"对话框,**务必勾选"共享音频"**,即可捕获系统播放的真实声音(走 `getDisplayMedia`)。

## 架构

```
浏览器 getDisplayMedia(捕获系统声音)
   │  降采样为 16kHz PCM,经 WebSocket 上送
   ▼
流式 ASR(interim/final 双层假设)            providers.js
   │
LocalAgreement-2 提交策略(连续两轮一致才定稿)  commit.js
   │
RollingTranslator(LLM 翻译 + 滚动上下文回改前句) providers.js
   │  WebSocket 推回
   ▼
双栏字幕:已定稿(白) / 临时(灰) / 已修正(黄闪)  web/app.js
```

## 自动修正机制(本项目核心)

| 层级 | 机制 | 代码位置 |
|------|------|----------|
| ASR 识别修正 | interim 假设不断刷新,如 `a tension → attention` | `providers.js` MOCK_SCRIPT |
| 提交稳定性 | LocalAgreement-2:连续两轮假设一致的词才定稿,避免字幕乱跳 | `commit.js` |
| 翻译回改 | LLM 带前文上下文翻译,后文消歧后回头修正前一句译文 | `providers.js` RollingTranslator + `correction` 消息 |

## 切换到真实服务(云端 / 本地)

接口已抽象在 `server/providers.js`,通过环境变量切换:

```bash
# 云端示例
ASR_PROVIDER=deepgram DEEPGRAM_API_KEY=xxx \
MT_PROVIDER=openai    OPENAI_API_KEY=xxx   npm start
```

- **ASR**:`createMockASR` 同形状替换为 Deepgram/Gladia 的流式 WebSocket;`pushAudio()` 已接好浏览器送来的 16kHz PCM。
- **翻译**:`translateOpenAI` 已留好 prompt 设计位置——把前文上下文一起喂给模型,要求在 `corrections` 字段返回对前句译文的修正。
- **本地自托管**:ASR 换 `whisper_streaming`(内置 LocalAgreement),翻译换 Hunyuan MT,均不改上层编排。

## 下一步可扩展

- 流式 TTS 中文配音(题目里的"语音形式")。
- VAD 断句 + 标点恢复,提升长音频可读性。
- 术语表 / 领域提示词,提升专业内容翻译准确度。
