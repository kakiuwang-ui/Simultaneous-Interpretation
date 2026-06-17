# AI 同声传译助手 — 演示稿 + 面试 Q&A

---

## 一、演示稿（配合 demo.html 页面讲解，约 15-20 分钟）

### 开场（1 分钟）

> 大家好，今天给大家介绍我做的一个项目——AI 同声传译助手。
>
> 这是一个实时语音识别 + LLM 翻译 + 语音合成的全链路系统，支持中英日韩四种语言、12 个翻译方向的实时同声传译。
>
> 核心卖点是三个：**实时性**——说话的同时就能看到字幕和译文；**自动纠正**——后文出现新信息后 LLM 会自动回改前面的译文；**声音克隆**——用说话人自己的声音播报译文。
>
> 整个项目前端零框架依赖，纯 Vanilla JS，后端 Node.js，没有用 React、Vue 这些。

### 系统架构（2 分钟）

> （滚动到架构图）
>
> 先看整体数据流。音频从浏览器出发，经过 6 个处理节点：Browser → WebSocket → ASR → LLM Translation → TTS → Speaker。端到端延迟控制在 3 秒以内。
>
> 绿色节点是浏览器侧的，金色节点是服务端的 AI 处理环节。
>
> 下面是三种主要的音频输入路径——麦克风实时、文件上传、标签页捕获，每种走不同的 ASR 策略。
>
> 再看语言矩阵：4 种语言两两互译，12 个方向，每个方向都有独立的 System Prompt。系统还能通过 Unicode 码点自动检测输入语言，自动修正翻译方向。

### 技术栈 + 选型（3 分钟）

> （滚动到技术栈和选型）
>
> 技术栈分四列：ASR 用 Web Speech API + SenseVoice/Whisper 双路；翻译用 DeepSeek LLM；TTS 用 CosyVoice2 做声音克隆；基础设施是 Node.js + WebSocket + Vanilla JS。
>
> 重点说一下技术选型的思路。**每个选择大家都可以点击看详细原因。**
>
> 比如前端为什么不用 React？因为这个项目的交互本质就是 WebSocket 消息驱动 DOM 更新，字幕更新只是 `textContent` 赋值，Virtual DOM 的 diff 在这里完全没有意义。整个前端就 3 个文件，零构建、零依赖。
>
> 再比如实时通信为什么用原生 WebSocket 而不是 Socket.IO？因为我需要直接传二进制 PCM16 音频帧，WebSocket 原生支持二进制帧，Socket.IO 反而要多一层编码。
>
> 翻译为什么用 LLM 而不是 Google Translate？因为 LLM 能做上下文感知翻译——8 句滑动窗口、术语记忆、回溯纠正，这些传统 NMT 做不到。

### 项目结构（30 秒）

> （滚动到项目结构）
>
> 整个项目就 10 个核心文件——server 目录 5 个 JS 文件，web 目录 5 个前端文件，加一个 .env 配置文件。
>
> 后端分工很清晰：server.js 负责 HTTP 服务和 WebSocket 连接管理；asr.js 封装流式 ASR 和 VAD；providers.js 处理 LLM 翻译和滑动窗口；tts.js 管 TTS 合成和声音克隆；commit.js 是 LocalAgreement-2 算法。
>
> 前端 app.js 一个文件约 1200 行包含全部逻辑，没有构建步骤。三行 .env 配置填好 API Key 就能跑。

### 五种输入模式（3 分钟）

> （滚动到功能模式）
>
> 系统支持 5 种输入模式，每种的数据流路径不同：
>
> **麦克风实时**是最核心的模式。getUserMedia 采集音频，降采样到 16kHz PCM16，通过 WebSocket 二进制帧发到服务端。同时浏览器端启动 Web Speech API 做本地 ASR，两路结果互补——浏览器 ASR 零延迟逐词显示，服务端 ASR 更准确。
>
> **文件上传**走服务端 FFmpeg 转码，然后客户端模拟实时流——把 PCM 切成 0.5 秒的块，每 100ms 发一块，服务端用同一套 VAD + ASR 管线处理。上传视频还能自动创建播放器，字幕跟播放进度同步。
>
> **标签页捕获**用 getDisplayMedia 获取浏览器标签页的音频，可以实时翻译 YouTube、网课等内容。配合 Document Picture-in-Picture API 做了个悬浮字幕窗口，始终置顶显示。
>
> **在线视频 URL** 全部在服务端处理——yt-dlp 拉取音频流通过管道直接喂给 FFmpeg 转码，再进 ASR，支持 1000+ 网站。
>
> **OBS 字幕叠加**是为直播场景做的，overlay.html 是一个只读 WebSocket 客户端，透明背景，在 OBS 里作为浏览器源叠加到直播画面上。

### 前端渲染（2 分钟）

> （滚动到前端渲染，先演示频谱）
>
> 这里可以现场演示一下音频频谱。（点击开启麦克风）大家可以看到 64 个频率竖条在实时跳动，这是用 AnalyserNode + Canvas requestAnimationFrame 60fps 绘制的。
>
> 字幕布局是 CSS Grid 双栏——左边原文、右边译文，1px 分隔线。每行字幕分 committed（白色）和 pending（灰色）两个 span，视觉上就能区分已确认和正在识别的文字。
>
> 标签页模式的画中画窗口用 Document PiP API 实现——`documentPictureInPicture.requestWindow({width:500, height:180})`，拿到新 window 后注入自定义 CSS + DOM，所有 WebSocket 消息通过 `updatePiPSubtitles()` 同步更新悬浮窗字幕。如果浏览器不支持 Document PiP（比如 Firefox），降级为 `window.open()` 普通弹窗，功能不变只是不能始终置顶。

### 核心算法（3 分钟）

> （滚动到算法区）
>
> 四个核心算法：
>
> **VAD 状态机**——30 行代码实现双阈值语音端点检测。silence 状态下累积语音样本超过 0.15 秒就进入 speech 状态；speech 状态下静音超过 0.6 秒就触发端点，把积累的音频送去 ASR。实时和文件模式用不同的阈值参数。
>
> **LocalAgreement-2**——字幕稳定算法，来自 whisper_streaming。核心思想：只有连续两次 ASR 假设在前缀上一致，才把那部分定稿。比如两次假设都有 "The quick brown" 这个前缀，就 commit 这三个词，后面的继续等确认。
>
> **流式翻译**——8 句滑动窗口上下文 + 30 条术语表注入 Prompt。LLM 输出结构化 JSON，包含 target（译文）、corrections（回溯纠正）、terms（术语）。流式输出时用 Regex 实时匹配不完整 JSON 中的 target 字段，边生成边显示。
>
> **声音克隆**——前 5 秒音频自动采集，浏览器收集 80000 个 PCM16 样本，发到服务端，手动拼 WAV 头 → Base64 → ASR 转录 → 存入 session。之后 TTS 合成时通过 references 数组传入参考音频，CosyVoice2 就能用说话人的声音合成译文。

### 自动纠正机制（1 分钟）

> （滚动到纠正管线）
>
> 翻译质量靠四层纠正保证：
> - Layer 1：ASR 级——interim 逐步稳定为 final
> - Layer 2：LLM 翻译回改——后文消歧后自动修正前句
> - Layer 3：视觉反馈——白色定稿、灰色临时、黄色闪烁已修正
> - Layer 4：人工兜底——双击原文编辑，自动重新翻译

### 延迟优化（1 分钟）

> （滚动到延迟图）
>
> 这张甘特图展示了端到端延迟的每个环节。关键优化点：
> - ASR 并行——用 pendingASR 计数器，不等上一次识别完成就可以送下一块
> - 流式翻译——Regex 提取不完整 JSON，约 10 个字就开始显示
> - TTS 拆段——长文本按标点拆分，只合成第一段，省掉 70% 合成时间

### WebSocket 消息协议（1.5 分钟）

> （滚动到协议部分）
>
> 先看四个设计决策：
>
> **为什么音频用二进制帧？** PCM16 音频每秒 32KB，如果用 JSON + Base64 编码体积膨胀 33%，还要每帧 JSON.parse。直接发 ArrayBuffer，服务端用 `isBinary` 判断即可。
>
> **声纹和 TTS 为什么用 JSON 头 + Binary 两帧？** 这些是一次性大二进制数据，需要携带元信息（采样率、格式、大小）。把元信息放 JSON 头，数据紧跟二进制帧，比 Base64 塞进 JSON 高效得多。用 `pendingVoiceSample` 标志位区分"下一帧是声纹还是普通音频"。
>
> **ASR 和翻译为什么各分 partial 和 final？** 同传要求边说边出字幕——`asr_partial` 携带 committed + pending 两部分分别渲染白色和灰色；`translation_partial` 让用户不用等整句翻译完。Final 消息触发后续流程。
>
> **为什么 16 种消息类型不合并？** 看起来多，但每种职责明确——比如 asr_partial 和 asr_final 如果合成一个用 `isFinal` 区分，前端每次都要 if-else。分开后 switch-case 分发，每个 handler 只做一件事，可读性最好。`type` 字段就是个字符串，零性能开销。
>
> 整个协议 16 种消息类型——上行 8 种（start、start_url、voice_sample、PCM 音频、asr_interim、retranslate、feedback、file_done），下行 8 种（ready、asr_partial、asr_final、translation_partial、translation、correction、tts_audio、error）。

### 多 Provider 架构（1 分钟）

> （滚动到 Provider 部分）
>
> 为什么要支持多 Provider？三个原因：**成本控制**——DeepSeek ¥1/百万 token，GPT-4o 贵 20 倍，开发测试用免费额度，生产用高质量模型；**容灾降级**——三层 fallback 链，服务端 ASR 挂了降级浏览器 Web Speech API，CosyVoice 挂了降级预设音色再降级 speechSynthesis；**场景适配**——日韩翻译 DeepSeek 更好，SenseVoice 支持 50+ 语言自动检测，按场景选最优组合。
>
> LLM 翻译支持 5+1 个提供商（DeepSeek、通义千问、Kimi、OpenAI、智谱 + 自定义）；ASR 支持 3 个云端引擎加浏览器降级；TTS 支持 2 个云端加浏览器降级。全部使用 OpenAI 兼容 API 格式，每个服务只需 3 个环境变量即可切换。

### 现场演示（2-3 分钟）

> 接下来我打开实际应用演示一下。
>
> （打开 localhost:8787，演示麦克风模式 → 说几句英文 → 看字幕实时出现 → 看译文滚动 → 听 TTS 播报）
>
> 大家注意看：字幕是逐步稳定的，白色部分不会再变，灰色部分还在更新。译文也是边生成边显示的，不用等整句翻译完。

### 关键数据 + 收尾（30 秒）

> （滚动到数据统计）
>
> 最后用一组数字总结：12 个翻译方向、5 种输入模式、6 个 LLM 提供商、3 个 ASR 引擎、8 句上下文窗口、0.6 秒端点延迟、5 秒声音采样、0 前端依赖。
>
> 技术亮点回顾：
> 1. 全链路实时——从语音到字幕到翻译到播报，端到端 < 3 秒
> 2. 四层自动纠正——ASR 稳定、LLM 回改、视觉反馈、人工兜底
> 3. 声音克隆——5 秒采样复刻说话人音色
> 4. 多 Provider 容灾——三层 fallback，改一行 .env 切换
> 5. 零前端依赖——纯 Vanilla JS，10 个文件搞定
> 6. 多模式输入——麦克风、文件、标签页、URL、OBS 五种场景全覆盖
>
> 以上就是我的介绍，欢迎大家提问。

---

## 二、功能实现详解（每个功能怎么做、为什么这样做）

### 1. 实时语音识别（双路 ASR 并行）

**代码位置：**
- 浏览器端 ASR：`web/app.js:563-616` — `startBrowserASR()` 启动 Web Speech API
- 服务端 StreamingASR 类：`server/asr.js:146-398` — 完整的流式 ASR 会话管理
- ASR 引擎配置：`server/asr.js:32-57` — `ASR_PRESETS` + `getASRConfig()`
- Whisper API 调用：`server/asr.js:75-142` — `transcribeWav()` multipart/form-data 构建
- 服务端创建 ASR 实例：`server/server.js:227-242` — 根据模式选择 server/browser ASR

**怎么做的：**

> 通俗来说：同时开两条路做语音识别。一条是浏览器自带的语音识别（像手机语音输入法一样，说一个字就出一个字，速度极快但偶尔不准）；另一条是把录音发到服务器，用更强大的 AI 模型识别（更准但要等一会儿）。用户看到的字幕来自浏览器那条路（实时感强），翻译用的是服务器那条路（准确度高）。两条路同时跑，取长补短。

- 浏览器端：`new SpeechRecognition()` 设置 `continuous: true, interimResults: true`，`onresult` 回调里区分 `isFinal` 和 interim，interim 发 `asr_interim` 消息让服务端回传 `asr_partial`（显示灰色文字），final 发 `asr_final` 触发翻译
- 服务端：`StreamingASR` 类接收 PCM 二进制帧，内部 VAD 状态机检测语音端点后切分音频块，拼 WAV 头调用 Whisper/SenseVoice API 识别，返回 `asr_partial`（committed + pending）和 `asr_final`
- 两路独立运行，浏览器 ASR 负责字幕实时显示（~0ms 延迟），服务端 ASR 负责准确识别 + 翻译触发

**为什么这样做：**
- 单用服务端 ASR 延迟太高（VAD 端点 0.6s + 网络 + 识别 ≈ 1.5s），用户说话后很久才出字
- 单用浏览器 ASR 不够——不支持标签页音频、不支持文件、Firefox/Safari 兼容差
- 双路互补：浏览器提供即时感知，服务端提供准确性和兼容性

### 2. VAD 端点检测（语音活动检测）

**代码位置：**
- VAD 参数定义：`server/asr.js:167-175` — 阈值、端点时长、语音起始防抖
- VAD 状态机：`server/asr.js:224-257` — `pushAudio()` 中的 silence/speech 双状态切换
- RMS 能量计算：`server/asr.js:204-209` — PCM16 样本平方和 → 均方根
- 端点触发处理：`server/asr.js:243-254` — 静音超时后切分并送 ASR

**怎么做的：**

> 通俗来说：系统不断"听"麦克风的音量大小。如果声音大（有人在说话），就开始录音；如果声音变小（说话停顿了），就等一小会儿（0.6 秒），确认是真的停了而不是喘口气，然后把这段录音剪下来送去识别。就像一个智能录音笔，自动帮你按"一句话说完了"来断句。为了防止咳嗽、键盘敲击等突发噪声被当成说话，还加了一个"至少连续说 0.15 秒才算开始说话"的门槛。

- 每帧 PCM 计算 RMS 能量：`sumSq += int16[i]²`，`rms = sqrt(sumSq / length)`
- 双阈值状态机：`silence` 状态下连续语音超过 `vadSpeechOnset`（0.15s）进入 `speech`；`speech` 状态下连续静音超过 `vadEndpointSamples`（实时 0.6s / 文件 1.0s）触发端点
- 端点触发后立即处理缓冲区音频，同时重置状态机

**为什么这样做：**
- Whisper 不是流式模型，需要一段完整音频才能识别，VAD 负责在句子自然停顿处切分
- `vadSpeechOnset` 防抖：避免瞬间噪声（键盘声、咳嗽）误触发
- 实时 / 文件模式用不同参数：实时要快（0.6s），文件不怕等（1.0s 避免切断长停顿）
- 30 行代码零依赖，比 Silero VAD（需 ONNX Runtime 2MB）轻量得多

### 3. LocalAgreement-2 字幕稳定算法

**代码位置：**
- 完整算法实现：`server/commit.js:11-57` — `LocalAgreement` 类（update / flush / reset）
- 词归一化函数：`server/commit.js:59-61` — `normalize()` 小写 + 去标点
- 前端 committed/pending 渲染：`web/app.js:207-238` — `renderSource()` 白色/灰色双 span

**怎么做的：**

> 通俗来说：语音识别器在你说话的过程中会反复"改主意"——比如你说"我今天"，它先猜"我经"，再猜"我今天"，猜来猜去字幕就会跳来跳去。这个算法的办法是：**只有连续两次猜的结果前几个词一样，才把这些词"钉死"显示出来**，后面还没确定的词用灰色显示。就像老师批改作业，同一个答案写了两遍才给打勾。这样用户看到白色字就不会再变了，灰色字还在"思考中"。

- `commit.js` 维护 `committed[]`（已定稿词）和 `prevHypothesis[]`（上一次 ASR 假设）
- `update(words)`: 从 `committed.length` 位置开始，逐词比较 `words[i]` 和 `prevHypothesis[i]`（normalize 后小写去标点），一致则 commit，不一致则停止
- `flush(words)`: 句子结束时强制把剩余假设全部定稿
- 前端 committed 显示白色，pending 显示灰色

**为什么这样做：**
- 直接显示 ASR interim → 字幕疯狂跳动（用户无法阅读）
- 直接等 final → 延迟太高（整句说完才显示）
- LA-2 是折中：只有连续两次假设一致的前缀才定稿，既能尽快出字，又保证已显示的不会变
- 来自 whisper_streaming 论文，是流式同传的经典做法

### 4. 流式翻译 + 上下文窗口

**代码位置：**
- RollingTranslator 类：`server/providers.js:361-401` — 历史窗口、术语表、反馈管理
- translateLLM 核心函数：`server/providers.js:403-501` — fetch + SSE 流式读取
- 流式 Regex 提取 target：`server/providers.js:467-476` — 不完整 JSON 中实时匹配
- Prompt 构建：`server/providers.js:325-357` — `buildUserPrompt()` 术语 + 反馈 + 上下文
- 12 方向 System Prompt：`server/providers.js:97-307` — `SYSTEM_PROMPTS` 对象
- 术语表 FIFO 淘汰：`server/providers.js:383-388` — glossary Map 上限 30 条

**怎么做的：**

> 通俗来说：每翻译一句话，都把前面 8 句的原文和译文一起"喂"给 AI，让它知道上下文是什么。就像同传译员翻译时脑子里记着前面说了什么一样。AI 翻译的同时还会自动记录术语（比如"Transformer"翻译成什么），下次遇到同样的词就保持一致。
>
> 更巧妙的是"边翻边显"：AI 一个字一个字地输出翻译结果，系统不等它说完，用正则表达式从半成品的输出中"偷看"已经生成的部分，立刻显示给用户。就像考试时答案还没写完，但已经能看到前几行了。

- `RollingTranslator` 类维护 `history[]` 和 `glossary` Map（30 条术语）
- 翻译时取最近 8 句 `history.slice(-contextSize)` 构建 Prompt，注入术语表和用户反馈
- LLM 返回结构化 JSON：`{target, corrections[], terms[]}`
- 流式输出时逐 chunk 拼接，用 Regex `/"target"\s*:\s*"((?:[^"\\]|\\.)*)"/` 实时提取 target 字段，通过 `onPartial` 回调发送 `translation_partial` 给前端
- 完整 JSON 解析后提取 corrections 发送 `correction` 消息，提取 terms 更新术语表

**为什么这样做：**
- 8 句窗口是实验平衡点：更多 → prompt 太长影响速度，更少 → 上下文不够消歧
- 结构化 JSON 一次调用同时拿到译文、纠正、术语——比纯文本 + 后处理效率高
- Regex 提取不完整 JSON：不等完整响应，约 10 字符就开始显示，体感延迟极低
- 术语表 FIFO 淘汰保持 30 条上限，避免 prompt 膨胀

### 5. 自动纠正（corrections 回溯修正）

**代码位置：**
- Prompt 中 corrections 要求：`server/providers.js:104-116` — System Prompt JSON 格式定义
- 服务端解析并广播：`server/server.js:175-179` — `translateAndEmit()` 中遍历 corrections
- 前端修正渲染：`web/app.js:336-345` — `renderTarget()` 黄色闪烁 + 「已修正」标签
- corrections 回写历史：`server/providers.js:374` — 更新 history 影响后续翻译上下文

**怎么做的：**

> 通俗来说：AI 每翻译一句新话，都会"回头看看"前面翻得对不对。如果发现之前翻错了（比如新信息让前面的歧义消除了），就会告诉系统"第 3 句应该改成 XXX"。系统收到后自动把对应那行译文换掉，还会闪一下黄色提醒用户"这句被改过了"。改完的译文也会更新到记忆里，这样后续翻译时 AI 看到的上下文就是修正过的版本。

- System Prompt 要求 LLM：如果根据当前句发现前句译文有误，在 `corrections` 数组中指出 `{id, target}`
- 服务端解析后对每个 correction 发送 `{type: 'correction', id, target}` 消息
- 前端 `renderTarget()` 接收后：替换对应 id 的译文文本，添加 `.flash-correct` 类触发黄色闪烁动画，插入「已修正」标签
- 修正后的译文同步更新 `history[]`，影响后续翻译的上下文

**为什么这样做：**
- 同传的本质问题：翻译时后文还没出来，前文可能翻错（如 "bank" 在金融/地理语境下不同）
- 传统 NMT（如 Google Translate）是无状态的，翻完就不管了
- LLM + 滑动窗口能"回看"前文并修正，是 LLM 翻译独有的优势
- 视觉反馈（黄色闪烁 + 标签）让用户知道哪句被改了，不会困惑

### 6. 声音克隆 TTS

**代码位置：**
- 前端声纹采集：`web/app.js:401-433` — `collectVoiceSample()` 逐帧收集 PCM16
- 前端发送两帧：`web/app.js:425-427` — JSON 头 + ArrayBuffer 二进制
- 服务端声纹处理：`server/tts.js:73-94` — `setVoiceReference()` WAV 编码 + ASR 转录
- PCM16 → WAV 编码：`server/tts.js:43-68` — `pcm16ToWav()` 手动拼 44 字节头
- 合成入口：`server/tts.js:119-136` — `synthesize()` 拆段 + 选择克隆/预设
- 克隆合成：`server/tts.js:171-209` — `synthesizeWithClone()` references 数组调用
- 长句拆分：`server/tts.js:101-117` — `splitLongText()` 按标点切分 ≤50 字符
- 前端音频播放：`web/app.js:505-512` — `playAudioBuffer()` Blob → Audio
- 回声防护：`web/app.js:486-503` — `pauseRecognitionDuring()` 暂停 ASR + 静音

**怎么做的：**

> 通俗来说：系统偷偷录你说话的前 5 秒当作"声音样本"，发给服务器。服务器把这段录音转成音频文件格式，同时用语音识别得到你说了什么字（克隆接口需要知道音频对应的文字）。之后每次要朗读翻译结果时，就把你的声音样本和要朗读的文字一起发给声音克隆 AI，它就能用你的声音来念翻译。
>
> 为了让用户不用等太久，长句子会按标点拆开，只念第一段（≤50 字）。播放时还会暂停录音，防止系统把自己念的话又录进去形成"套娃"。如果克隆失败就自动切换成普通机器人声音，保证不卡住。

- 前端：`collectVoiceSample()` 在 ScriptProcessor 的 `onaudioprocess` 中逐帧收集 PCM16，满 80000 样本（5s@16kHz）后发送——先发 JSON `{type: 'voice_sample', sampleRate: 16000}`，再发 `sample.buffer` 二进制
- 服务端：`setVoiceReference()` 先同步清除 `pendingVoiceSample` 标志，然后异步处理——`pcm16ToWav()` 手动拼 44 字节 WAV 头 → Base64 data URI → 调 `transcribeWav()` 获取 transcript → 存入 `sessionVoiceRefs` Map
- 合成时：`synthesize()` 调用 `splitLongText()` 按标点拆分（≤50 字符），只合成第一段。如果有 voiceRef，用 `references: [{audio, text}]` 数组调用 CosyVoice2；克隆失败则降级为预设音色
- 前端播放：收到 `tts_audio` JSON 后等下一帧二进制 → `new Blob() → new Audio().play()`，播放期间 `pauseRecognitionDuring()` 暂停 ASR + 静音 PCM 防回声

**为什么这样做：**
- 5 秒采集时长：多次实验的平衡——太短（1-2s）克隆效果差，太长用户等太久
- JSON + Binary 两帧模式：声纹是一次性大二进制数据 + 元信息，比 Base64 塞 JSON 高效
- 只合成第一段：同传场景用户持续说话，等全文合成（可能 200 字 → 5-6s）延迟不可接受，第一段（≤50 字 → ~1s）包含最关键信息
- 三层回声防护：单靠 `echoCancellation` 对合成语音效果差，必须在应用层暂停识别 + 静音

### 7. 多 Provider 统一抽象

**代码位置：**
- LLM Provider 预设：`server/providers.js:14-35` — `PRESETS` 对象（5+1 个提供商）
- LLM 配置读取：`server/providers.js:37-46` — `getLLMConfig()` 环境变量 → 配置
- ASR Provider 预设：`server/asr.js:33-46` — `ASR_PRESETS`（3 个引擎）
- TTS Provider 预设：`server/tts.js:13-24` — `TTS_PRESETS`（2 个引擎）
- 统一 API 调用：`server/providers.js:411-430` — fetch OpenAI 兼容格式
- 降级判断：`server/server.js:244-246` — `asrMode` server/browser 选择

**怎么做的：**

> 通俗来说：所有 AI 服务商（不管是 DeepSeek、通义千问还是 OpenAI）都长得差不多——调用地址不同，但请求格式一样（都兼容 OpenAI 格式）。所以系统只要维护一个"通讯录"，每个服务商存好地址和模型名，切换时改一个环境变量就行，代码完全不用动。就像换手机卡一样，手机（代码）不变，插哪张卡（服务商）就用哪家的网络。ASR 和 TTS 也是同样的思路。

- `providers.js` 的 `PRESETS` 对象：每个 provider 配置 `{baseUrl, model}`，`getLLMConfig()` 从环境变量读取 provider 名后选配置
- 翻译函数 `translateLLM()` 用统一的 `fetch(url + '/chat/completions', {model, messages, stream})` 调用，所有 provider 都遵循 OpenAI Chat API 格式
- ASR 同理：`ASR_PRESETS` 配置 3 个引擎（siliconflow/groq/openai），`transcribeWav()` 用统一的 multipart/form-data 调 `/audio/transcriptions`
- TTS 同理：`TTS_PRESETS` 配 2 个引擎，`synthesize()` 调统一的 `/audio/speech`
- 每个服务只需 3 个环境变量：`XXX_PROVIDER` + `XXX_API_KEY` + 可选 `XXX_BASE_URL`

**为什么这样做：**
- 成本控制：DeepSeek ¥1/百万 token vs GPT-4o ¥20/百万，开发测试用免费额度
- 容灾降级：服务端 ASR 挂了 → 浏览器 Web Speech API，CosyVoice 挂了 → 预设音色 → speechSynthesis
- 场景适配：SenseVoice 支持 50+ 语言自动检测，DeepSeek 日韩翻译更好
- 加新 provider 只需在 PRESETS 里加 3 行配置，零代码改动

### 8. 五种输入模式

**代码位置：**
- 麦克风采集：`web/app.js:777-823` — `startCapture()` getUserMedia + AudioContext + ScriptProcessor
- 文件上传前端：`web/app.js:828-931` — `startFileUpload()` POST /upload + 分块发送
- 文件上传服务端：`server/server.js:75-91` — `convertToPCM()` FFmpeg 转码
- 文件上传 HTTP 接口：`server/server.js:97-119` — POST /upload 处理
- 标签页捕获：`web/app.js:680-746` — `startTabAudioCapture()` getDisplayMedia
- 在线视频 URL 前端：`web/app.js:749-764` — `startUrlTranslation()`
- 在线视频 URL 服务端：`server/server.js:30-72` — `streamUrlAudio()` yt-dlp + FFmpeg 管道
- URL 模式消息处理：`server/server.js:294-356` — start_url case
- OBS overlay 广播：`server/server.js:136-142` — `broadcastToOverlays()`
- OBS overlay 注册：`server/server.js:211-215` — overlay mode 处理
- overlay 页面：`web/overlay.html` — 只读 WebSocket 客户端

**怎么做的：**

> 通俗来说：五种模式的音频来源不同，但最终都变成同一种格式（16kHz 单声道 PCM）喂给同一套识别+翻译管线：
> - **麦克风**：直接录你的声音
> - **文件上传**：把音视频文件用 FFmpeg 转码后，假装成"实时录音"一小段一小段地发
> - **标签页捕获**：录下你正在看的网页（比如 YouTube）的声音
> - **在线视频 URL**：服务器帮你下载视频音频，直接在服务器上处理
> - **OBS 字幕**：一个透明背景的网页，只显示字幕，可以叠加到直播画面上
>
> 就像五根不同的水管，最终都接到同一个水龙头（ASR + 翻译）。

**麦克风实时（核心模式）：**
- `getUserMedia({audio: {echoCancellation, noiseSuppression, autoGainControl}})` → `AudioContext` → `ScriptProcessor`（4096 buffer）→ `downsampleToPCM16()` 降到 16kHz → `ws.send(pcm16.buffer)` 二进制帧
- 同时启动 Web Speech API + 频谱可视化

**文件上传：**
- `POST /upload` 上传文件 → 服务端 `convertToPCM()` 用 FFmpeg `-ac 1 -ar 16000 -f s16le` 转码 → 返回 PCM Buffer
- 前端切成 0.5s 块（8000 samples），`setInterval(100ms)` 逐块 `ws.send()` 模拟实时流
- 视频文件自动创建 `<video>` 播放器，字幕通过 `segTimestamps` 与播放进度同步

**标签页捕获：**
- `getDisplayMedia({video: true, audio: true})` → 停掉视频轨 → `AudioContext` 重采样 → WebSocket
- 先 `openPiPSubtitles()` 创建浮窗（需 user gesture），再 getDisplayMedia
- 标签页音频不走 Web Speech API（它只能识别麦克风），完全依赖服务端 ASR

**在线视频 URL：**
- 前端发 `{type: 'start_url', url}` → 服务端 `streamUrlAudio()` 启动 yt-dlp 管道 → FFmpeg 转码 → `pcmStream.on('data')` 逐块喂入 ASR
- yt-dlp stdout → FFmpeg stdin 管道直连，零中间文件

**OBS 字幕叠加：**
- `overlay.html` 是只读 WebSocket 客户端，发 `{type: 'start', mode: 'overlay'}`
- 服务端把它加入 `overlayClients` Set，每次 asr_final / translation / correction 都 `broadcastToOverlays()`
- 透明背景 CSS，在 OBS 里作为浏览器源叠加

**为什么 5 种模式：**
- 覆盖所有使用场景：会议/上课（麦克风）、已有录音（文件）、在线课程（标签页）、YouTube（URL）、直播（OBS）
- 复用同一套服务端 ASR + 翻译管线，只是音频输入源不同

### 9. 画中画悬浮字幕（Document PiP）

**代码位置：**
- PiP 窗口创建：`web/app.js:619-660` — `openPiPSubtitles()` Document PiP + 降级弹窗
- PiP 字幕更新：`web/app.js:662-677` — `updatePiPSubtitles()` 跨窗口 DOM 操作
- PiP 调用时机：`web/app.js:686` — 标签页捕获前先开 PiP（需 user gesture）

**怎么做的：**

> 通俗来说：用浏览器的"画中画"功能弹出一个小窗口，这个小窗口会始终悬浮在所有窗口上面。往里面塞两行字——上面显示原文，下面显示译文，每收到新的翻译就更新文字。这样你在看视频/上网课的时候，字幕小窗口一直浮在画面上，不会被挡住。如果浏览器不支持这个功能，就退而求其次用普通弹窗代替。

- `documentPictureInPicture.requestWindow({width:500, height:180})` 获取独立浮窗
- 向新 window 注入自定义 CSS（暗色背景、字体大小）+ DOM（`#pipSource` + `#pipTarget`）
- 每收到 WebSocket 消息（asr_partial/asr_final/translation_partial/translation/correction），都调 `updatePiPSubtitles(source, target)` 通过 `pipWindow.document.getElementById()` 更新文本
- 不支持 Document PiP 的浏览器（Firefox/Safari）降级为 `window.open()` 普通弹窗

**为什么这样做：**
- 标签页捕获模式下，用户在看视频，字幕窗口需要始终置顶不被遮挡
- Document PiP 是 Chrome 116+ 的 API，创建的窗口自动 always-on-top
- 降级方案保证功能可用，只是失去"置顶"能力

### 10. 音频频谱可视化

**代码位置：**
- 频谱绘制：`web/app.js:515-544` — `setupSpectrum()` AnalyserNode + Canvas 60fps
- 停止频谱：`web/app.js:546-548` — `stopSpectrum()` cancelAnimationFrame
- AnalyserNode 创建：`web/app.js:798-801` — fftSize=256, smoothing=0.75
- 降采样函数：`web/app.js:551-560` — `downsampleToPCM16()` Float32 → Int16

**怎么做的：**

> 通俗来说：浏览器自带一个"频率分析器"，能把声音拆成不同频率的分量（低音、中音、高音）。系统每秒 60 次读取这些频率数据，在 Canvas 画布上画成 64 根上下跳动的竖条——声音大的频率竖条就高，没声音就矮。效果就像 KTV 里的音乐频谱动画。这样用户一看就知道"麦克风在工作，系统在听"。

- `AudioContext.createAnalyser()` 设 `fftSize: 256`（128 个频率 bin），`smoothingTimeConstant: 0.75`
- `requestAnimationFrame` 循环：`analyser.getByteFrequencyData()` 取频率数据 → Canvas 绘制 64 根竖条
- 每根竖条高度 = `dataArr[i] / 255 * h * 0.9`，opacity = `0.3 + val * 0.7`（静音时半透明，语音时亮）
- DPI 适配：`canvas.width = clientWidth * devicePixelRatio`

**为什么这样做：**
- 给用户直观反馈"系统正在收听"，避免"是不是卡了"的困惑
- AnalyserNode 是 Web Audio API 原生节点，零额外依赖，CPU 开销极低
- Canvas 比 DOM 方案性能好（64 根竖条每帧更新，DOM 操作太重）

### 11. WebSocket 二进制协议

**代码位置：**
- 服务端消息分发：`server/server.js:191-371` — `ws.on('message')` isBinary + switch-case
- pendingVoiceSample 标志位：`server/server.js:150` — 定义；`server/server.js:194-198` — 同步清除
- 服务端 TTS 音频发送：`server/server.js:183-188` — JSON 头 + 二进制两帧
- 前端 WebSocket 连接：`web/app.js:86-129` — `connectWS()` 重连 + 二进制接收
- 前端消息处理：`web/app.js:131-197` — `handleMessage()` switch 分发
- 前端 TTS 二进制接收：`web/app.js:119-124` — pendingTTSAudio 匹配

**怎么做的：**

> 通俗来说：浏览器和服务器之间有一根"管子"（WebSocket），里面同时传两种东西——文字指令（JSON）和音频数据（二进制）。管子自动区分这两种，不会搞混。但有个特殊情况：声纹样本也是二进制音频，系统怎么区分它和普通录音呢？办法是先发一条文字消息说"注意！下一帧是声纹"，服务器记住这个"预告"，下一帧二进制来了就知道是声纹而不是普通录音。预告用完必须立刻清除，否则后面的普通录音也会被误当成声纹。

- 普通控制消息：`ws.send(JSON.stringify({type, ...}))` → text frame
- PCM 音频：`ws.send(pcm16.buffer)` → binary frame，服务端 `ws.on('message', (data, isBinary))` 的 `isBinary` 区分
- 声纹/TTS 音频：JSON 头 + Binary 两帧模式——先发 JSON `{type: 'voice_sample'/'tts_audio'}`，服务端设 `pendingVoiceSample` 标志位，下一帧二进制即为对应数据
- 标志位**必须同步清除**（在 async 操作之前）：`pendingVoiceSample = null; setVoiceReference(...)`

**为什么这样做：**
- PCM16 每秒 32KB，JSON + Base64 膨胀 33% + 每帧 JSON.parse 开销
- WebSocket 原生区分 text/binary frame，零额外编码
- 两帧模式比 Base64 塞 JSON 高效，且元信息（采样率、格式）可扩展
- 同步清除标志位：避免 ASR 转录期间后续音频帧被误判为声纹

### 12. 字幕渲染与交互

**代码位置：**
- 原文渲染：`web/app.js:207-238` — `renderSource()` committed/pending 双 span + 说话人标记
- 译文渲染：`web/app.js:295-347` — `renderTarget()` 修正闪烁 + partial 半透明
- 双击编辑：`web/app.js:240-285` — `startEditSource()` input → retranslate
- 翻译反馈按钮：`web/app.js:317-331` — 👎 按钮 → feedback 消息
- 服务端反馈处理：`server/server.js:287-292` — `addFeedback()` 保存最近 3 条
- 视频字幕同步：`web/app.js:936-974` — `syncSubtitlesWithVideo()` 时间戳匹配
- 轮播/滚动：`web/app.js:349-371` — `carouselShowAround()` + `carouselUpdate()`
- 会话持久化：`web/app.js:977-1027` — `saveSession()` / `restoreSession()` localStorage
- SRT 导出：`web/app.js:1089-1151` — `exportSRT()` 双语/原文/译文三种模式

**怎么做的：**

> 通俗来说：屏幕分左右两栏，左边显示原文，右边显示译文，一句对一句。每句字幕分两种颜色：白色是"确定了的"，灰色是"还在变的"。翻译正在生成时会半透明显示，生成完变成实色。如果 AI 回头修正了某句译文，那一行会闪一下黄色并标上"已修正"。
>
> 用户可以双击原文进行编辑（改错了的识别结果），改完自动重新翻译。每行译文旁边有个👎按钮，点了之后系统会记住这句翻得不好，后续翻类似的内容时 AI 会注意改进。字幕还能导出为 SRT 字幕文件，支持双语/纯原文/纯译文三种格式。

- `renderSource(id, committed, pending, isFinal)`: 每个 segment 创建一个 `.line` div，内含 `.committed` span（白色）+ `.pending` span（灰色），用 Map 管理
- `renderTarget(id, text, isCorrection, isPartial)`: 类似结构，isPartial 时添加半透明样式，isCorrection 时触发 `.flash-correct` 动画 + 插入「已修正」标签
- 双击编辑：`startEditSource()` 隐藏 span → 显示 input → blur/Enter 时发 `retranslate` 消息
- 翻译反馈：每行译文附带 👎 按钮，点击发 `{type: 'feedback', id}`，服务端 `addFeedback()` 保存最近 3 条注入后续 Prompt
- 视频模式字幕同步：`segTimestamps` Map 存每段的 start/end 时间，video 的 `timeupdate` 事件里隐藏已过字幕

**为什么这样做：**
- 直接 DOM 操作（不用 React）：字幕更新就是 `textContent` 赋值，Map 查找 O(1)，Virtual DOM diff 在这里完全没有价值
- committed + pending 双 span：视觉上区分"已确认"和"还在变"的文字，用户一眼能看出来
- 反馈机制形成闭环：用户标记 → 注入 Prompt → LLM 改进后续翻译

### 13. 语言检测与方向自动修正

**代码位置：**
- Unicode 语言检测：`server/providers.js:54-76` — `detectLang()` CJK/假名/韩文/Latin 码点统计
- 方向自动修正：`server/providers.js:84-93` — `autoCorrectDirection()` 源语言不符时切换
- 调用位置：`server/server.js:161-165` — `translateAndEmit()` 中检测并修正方向
- 前端语言配置：`web/app.js:40-53` — `LANG_CONFIG` 12 个方向的 ASR 语言 + 标签

**怎么做的：**

> 通俗来说：每种语言的文字在电脑里有不同的编码范围——中文汉字、日文假名、韩文音节、英文字母各有各的"门牌号"。系统数一数这句话里哪种文字最多，就知道是什么语言了。比如发现句子里有很多假名，就判定是日语。
>
> 有个特殊情况：日语也用汉字（比如"東京"），所以如果发现句子里同时有假名和汉字，就把汉字也算到日语头上。检测完之后，如果发现用户选的翻译方向不对（比如选了英译中但说的是日语），系统自动切换到日译中，不需要用户手动改。

- `detectLang(text)`: 遍历文本字符，统计 Unicode 码点落在哪个范围——CJK `0x4E00-0x9FFF`（中文）、平假名片假名 `0x3040-0x30FF`（日文）、韩文音节 `0xAC00-0xD7AF`（韩文）、Latin `0x41-0x7A`（英文）
- 特殊处理：日文混用汉字——如果检测到平假名/片假名，汉字也归为日文（`if (ja > 0) ja += zh, zh = 0`）
- `autoCorrectDirection(detected, currentDir)`: 检测语言与源语言不符时自动切换方向，如 en2zh 但说日语 → ja2zh

**为什么这样做：**
- 用户可能选错方向，或者多语言混说
- 纯统计方法零延迟零依赖，不需要额外的语言检测模型
- 日文特殊处理解决了 CJK 汉字在中/日文间的歧义

---

## 三、面试官可能问的问题 + 回答

### 1. 架构与设计

**Q: 为什么不用 React/Vue，用 Vanilla JS 不会很难维护吗？**

> 这个项目的前端交互模式很单一——WebSocket 收消息 → 更新 DOM，本质上就是一个事件驱动的渲染循环。引入 React 的话，WebSocket 消息要走 setState，触发 Virtual DOM diff，最后还是改 textContent——中间全是无用功。
>
> Vanilla JS 直接操作 DOM，代码路径最短。整个 app.js 大约 1200 行，逻辑按功能分块（音频采集、WebSocket、字幕渲染、文件上传等），用 Map 做数据管理，可读性没问题。
>
> 而且零构建意味着部署就是静态文件托管，npm start 起个 Node.js 服务就行，没有 Webpack/Vite 的构建步骤。

**Q: WebSocket 为什么不用 Socket.IO？**

> 两个原因。第一，我需要传二进制 PCM16 音频帧，原生 WebSocket 直接 `send(arrayBuffer)` 就行，Socket.IO 要做额外的编码。第二，Socket.IO 的 HTTP 长轮询降级、房间机制、自动重连对我没用——这是一个单客户端对单服务端的场景，连接断了就是用户停止了。Socket.IO 多一层抽象反而增加延迟。

**Q: 如果用户量大了怎么扩展？**

> 目前是单机架构，每个 WebSocket 连接对应一个 ASR 实例 + 一个翻译上下文。水平扩展的话：
> - 前端静态资源可以放 CDN
> - WebSocket 连接可以用 sticky session 的负载均衡（如 Nginx 的 ip_hash）
> - ASR 和翻译都是调外部 API（SiliconFlow、DeepSeek），服务端本身是无状态的（除了 session 内的上下文窗口），可以直接水平扩容
> - 如果要支持多人协作（比如同一个会议多个翻译方向），需要加一层消息广播，比如 Redis pub/sub

### 2. ASR 相关

**Q: 为什么用双路 ASR（浏览器 + 服务端）？**

> 两者互补。浏览器 Web Speech API 是本地识别，零网络延迟，逐词输出 interim results，用户体验好——说话的同时就能看到文字。但它有缺点：不支持标签页音频、不支持文件、且 final 结果有时不如 Whisper 准确。
>
> 服务端 ASR（SenseVoice/Whisper）更准确，支持自动语言检测，但有网络延迟和攒够音频才能识别的延迟。所以实时模式下两路并行，浏览器 ASR 负责字幕的实时显示，服务端 ASR 负责最终的准确结果和翻译触发。

**Q: VAD 为什么不用 Silero VAD 这种深度学习方案？**

> Silero VAD 确实更准确，能区分语音和背景噪音（比如键盘声）。但它需要加载 ONNX Runtime（约 2MB WASM），在 Node.js 还要装 onnxruntime-node。我的 RMS 能量检测只有 30 行代码，零依赖，在正常录音环境下足够可靠。
>
> 而且我的双阈值设计可以按场景调参——实时模式 0.6 秒端点更灵敏，文件模式 1.0 秒更宽松避免把一句话切断。如果以后要做噪声环境的适配，可以把 Silero 作为可选的升级方案接入。

**Q: LocalAgreement-2 算法的原理是什么？有什么局限？**

> 原理：维护上一次的 ASR 假设（prevHypothesis）和已确认的词（committed）。每次新假设来了，从 committed 末尾开始逐词比较新假设和上一次假设——如果 normalize 后相同就 commit，否则停止。这样只有两次连续假设都同意的前缀才会定稿。
>
> 局限：如果 ASR 引擎频繁修改已输出的前缀，LA-2 会导致 commit 很慢（因为前缀一直不一致）。极端情况下一个词要等多次确认才能显示。另外它假设前缀是稳定的——如果 ASR 把 "I think" 改成 "I thought"，前两个词就不一致了，之前 commit 的 "I think" 不会被撤回。这是一个只增不减的算法。

### 3. 翻译相关

**Q: 为什么翻译要用 LLM 而不是 Google Translate？**

> 三个核心能力 Google Translate 做不到：
> 1. **上下文感知**——我用 8 句滑动窗口注入 Prompt，LLM 能根据前文选择正确的翻译。比如 "bank" 在金融语境下译为"银行"，在地理语境下译为"河岸"。
> 2. **回溯纠正**——LLM 输出 corrections 数组，后文出现消歧信息后自动回改前句。Google Translate 是无状态的，翻译完就不管了。
> 3. **术语一致性**——LLM 每次翻译自动提取 terms，保留 30 条注入后续 Prompt，保证全文术语统一。
>
> 代价是 LLM 比 Google Translate 慢一些，但通过流式输出 + Regex 提取实现了边生成边显示，体感延迟很低。

**Q: 流式翻译时怎么从不完整的 JSON 中提取译文？**

> LLM 流式输出时，我在每个 chunk 拼接后用 Regex 匹配：`/"target"\s*:\s*"([^"]*)"/`。只要 target 字段的值开始出来（哪怕还没结束），就能提取到已生成的部分发给前端显示。
>
> 这样用户不用等整个 JSON 生成完，大约 10 个字符就能看到第一批译文。完整 JSON 解析出来后再用正式结果替换。
>
> 这个方案比让 LLM 输出纯文本再单独处理 corrections 要好——一次调用同时拿到译文、纠正和术语，prompt 效率最高。

**Q: corrections 机制具体怎么工作的？**

> Prompt 里要求 LLM 翻译当前句的同时，审视上下文窗口里的前几句译文，如果发现之前的翻译有误就输出 corrections 数组，每个元素是 `{id, target}`——id 是要修正的句子编号，target 是新的译文。
>
> 前端收到后遍历数组，找到对应 id 的字幕行，原地替换译文，触发黄色闪烁动画提示用户"这句被修正了"。修改后的译文也同步更新翻译上下文窗口，影响后续翻译。
>
> 典型场景：说话人先说了 "I went to the bank"，翻译成"我去了银行"；后面又说 "to fish"，LLM 就会发一个 correction 把"银行"改成"河岸"。

### 4. TTS / 声音克隆

**Q: 声音克隆的完整链路是什么？**

> 五步：
> 1. 浏览器前 5 秒音频（80000 samples @16kHz）自动采集到 ArrayBuffer，TTS 播放期间暂停防止回声
> 2. 通过 WebSocket 发送：先发 JSON 头（type: voice_sample），紧跟二进制 PCM16 数据
> 3. 服务端手动拼 44 字节 WAV 头 → Base64 data URI → 调 SenseVoice ASR 获取文本 transcript → 存入 sessionVoiceRefs Map
> 4. 翻译完成后合成：长文本按标点拆分（≤50 字符），只合成第一段降低延迟。用 references 数组（含 audio data URI + text transcript）调用 CosyVoice2
> 5. MP3 二进制返回浏览器 → Blob → new Audio() 播放，播放期间暂停 ASR + 静音麦克风防回声循环

**Q: 为什么只合成第一段而不是全文？**

> 延迟优化。同传场景下用户在持续说话，TTS 合成一段 50 字的文本大约 1-2 秒，如果等全文合成完（可能 200 字），延迟就到 5-6 秒了。只合成第一段能省 70% 的等待时间，而且第一段通常就是最关键的信息。

**Q: 如何防止 TTS 播放被麦克风录回去？**

> 三层防护：
> 1. getUserMedia 开启了 echoCancellation（浏览器硬件级回声消除）
> 2. TTS 播放期间暂停 Web Speech API 识别（pauseRecognitionDuring）
> 3. TTS 播放期间将麦克风 PCM 静音（不发送到服务端），播放结束后恢复
>
> 声音克隆采样阶段同理——如果正在播放 TTS，暂停采集，避免把 TTS 的声音当成说话人的声纹。

### 5. 性能与延迟

**Q: 端到端延迟是怎么做到 3 秒以内的？**

> 关键优化：
> 1. **VAD 端点检测 0.6s**——实时模式下静音 0.6 秒就切分，不等太久
> 2. **ASR 并行**——用 pendingASR 计数器，上一段还在识别就可以发下一段，管线不阻塞
> 3. **流式翻译首字**——LLM 流式输出，Regex 提取约 10 字符就开始显示
> 4. **TTS 拆段**——只合成第一段（≤50 字符），CosyVoice2 合成约 1s
> 5. **浏览器 ASR 零延迟**——Web Speech API 本地识别，配合 LA-2 边说边出字幕
>
> 所以用户体感是：说完一句话后 0.6s（端点检测）→ ASR ~0.5s → 翻译首字 ~0.3s → 译文开始滚动显示。字幕几乎是同步的（浏览器 ASR）。

**Q: 文件模式为什么要模拟实时流而不是一次性发完？**

> 如果一次性发完，服务端要缓存整个文件的 PCM 数据（可能几百 MB），然后一次性 ASR 识别——要么超时，要么内存爆。
>
> 模拟实时流（0.5s 块 @100ms 间隔）让服务端可以用和实时模式完全相同的 VAD + ASR 管线——代码复用、内存恒定、且可以在文件还没发完的时候就开始出字幕。进度条显示的是发送进度，用户不用干等。

### 6. 工程实践

**Q: 你觉得这个项目最难的部分是什么？**

> 最难的是**实时性和准确性的平衡**。
>
> ASR 层面：显示太快字幕跳动，显示太慢用户觉得卡。LocalAgreement-2 是一个折中，但参数调不好（比如 VAD 端点太短会把一句话切断，太长又增加延迟），需要反复测试。
>
> 翻译层面：LLM 需要足够的上下文才能翻译准确，但等太多上下文又增加延迟。8 句窗口是试出来的平衡点——再多 prompt 太长影响速度，再少上下文不够。
>
> 另一个难点是**二进制协议的设计**。WebSocket 同时传 JSON 和二进制，服务端收到二进制帧时怎么知道是音频还是声纹样本？我用了 pendingVoiceSample 标志位——收到 voice_sample JSON 后设标志，下一帧二进制就是声纹数据。这个标志必须同步清除，否则异步竞争会把普通音频误认为声纹。

**Q: 如果重新设计这个项目，你会改什么？**

> 几个方向：
> 1. **AudioWorklet 替代 ScriptProcessor**——ScriptProcessor 已经 deprecated，AudioWorklet 在独立线程运行，不会阻塞主线程。但 AudioWorklet 的兼容性和调试体验目前还不如 ScriptProcessor。
> 2. **TypeScript**——项目大了之后 Vanilla JS 缺少类型检查，重构时容易出错。但初期快速迭代时 JS 的灵活性是优势。
> 3. **WebTransport 替代 WebSocket**——WebTransport 基于 HTTP/3，支持多流、无队头阻塞，适合同时传音频和控制消息。但目前浏览器和 Node.js 支持还不够成熟。
> 4. **更细粒度的 ASR 调度**——目前双路 ASR 是独立运行的，可以做更智能的融合策略，比如浏览器 ASR 置信度低时优先采用服务端结果。

**Q: 这个项目有没有做测试？**

> 目前以手动集成测试为主——不同语言方向、不同输入模式、不同网络环境下的端到端测试。核心算法（LocalAgreement-2、VAD 状态机）可以单元测试，因为是纯函数。翻译质量的评估比较主观，主要靠人工比较。
>
> 如果要加自动化测试，我会：
> - 用录好的音频文件做回归测试（确保 VAD 切分和 ASR 结果一致）
> - Mock LLM 响应测试 corrections 机制的前端渲染
> - 用 Playwright 做 E2E 测试（模拟麦克风输入 → 验证字幕输出）

### 7. WebSocket 协议设计

**Q: 为什么协议要区分 partial 和 final 两种消息，不能只发最终结果吗？**

> 同传的核心体验就是"边说边出"。如果只发 final，用户要等一整句话说完、识别完、翻译完才能看到内容——可能 3-5 秒什么都没有，体验很差。
>
> 分 partial/final 后：`asr_partial` 每几百毫秒推送一次，用户能看到文字在实时跳动；`translation_partial` 在 LLM 流式输出时推送，约 10 个字符就能显示。前端用 committed（白色）和 pending（灰色）区分确认和未确认的文字，视觉上很清晰。
>
> 这种设计也让前端逻辑更清晰——partial 只更新显示，final 触发后续流程（翻译、TTS）。

**Q: pendingVoiceSample 标志位为什么必须同步清除？异步会出什么问题？**

> 场景：服务端收到 `{type: 'voice_sample'}` JSON 后设置 `pendingVoiceSample = true`。下一条 binary frame 来了，进入 `if (pendingVoiceSample)` 分支处理声纹。
>
> 如果标志清除是在 async 操作之后（比如 `await asrTranscribe()` 之后才 `pendingVoiceSample = false`），那在 ASR 转录的几百毫秒里，用户的麦克风音频帧持续到达——这些 binary frame 都会被误判为声纹数据，音频流就断了。
>
> 所以必须在进入 async 操作之前同步清除：`pendingVoiceSample = false; const result = await asrTranscribe(data);`。这是一个经典的异步竞争问题。

**Q: 16 种消息类型会不会太多了？能简化吗？**

> 16 种看起来多，但每种都有明确的职责，不存在冗余。如果合并（比如把 asr_partial 和 asr_final 合成一个 asr 消息用 `isFinal` 字段区分），前端每次都要 if-else 判断，代码反而不清晰。
>
> 而且消息类型本身就是零成本的——`type` 字段就是一个字符串，没有性能开销。分开之后，前端的消息分发逻辑是一个简单的 switch-case，每个 handler 只做一件事，可读性和可维护性最好。

### 8. 多 Provider 与工程化

**Q: 多 Provider 切换是怎么实现的？加一个新 Provider 需要改多少代码？**

> 每个模块（ASR、LLM、TTS）有一个统一的函数接口。以 LLM 为例，`providers.js` 里有一个 `PROVIDERS` 对象，key 是 provider 名（deepseek、qwen、kimi 等），value 是 `{baseURL, model, apiKey}` 配置。翻译函数根据 `MT_PROVIDER` 环境变量选择配置，调用统一的 OpenAI 兼容 API。
>
> 加一个新 Provider 只需要在 `PROVIDERS` 对象里加一条配置——3 行代码。因为所有 Provider 都遵循 OpenAI Chat API 格式（endpoint `/v1/chat/completions`，请求体 `{model, messages, stream}`），不需要写任何适配逻辑。

**Q: fallback 降级链是怎么实现的？自动的还是手动的？**

> 目前是启动时静态选择——服务端启动时检查 `ASR_API_KEY` 是否配置，有就用服务端 ASR，没有就告诉前端用浏览器 Web Speech API（通过 `ready` 消息的 `asrMode` 字段）。TTS 同理。
>
> 运行时的 API 调用失败目前不会自动切换 Provider，而是返回 error 消息。如果要做运行时自动降级，可以在 API 调用外面包一层 try-catch，失败后依次尝试备选 Provider——架构已经支持，因为所有 Provider 接口统一。
>
> 这是有意的取舍——启动时降级足够应对"没配 API Key"的场景，运行时自动切换可能引入意外行为（比如翻译质量突然变化），不如直接报错让用户知道。

**Q: 这个项目的代码量和复杂度怎么样？**

> 总共约 2500 行代码——服务端 ~1300 行（server.js 约 400 行、asr.js 约 300 行、providers.js 约 350 行、tts.js 约 200 行、commit.js 约 50 行），前端 app.js ~1200 行。
>
> 没有构建步骤、没有前端框架、没有 ORM，npm 依赖只有 ws、dotenv、openai 等几个。部署就是 `npm install && npm start`。
>
> 复杂度集中在两个地方：一是实时音频的异步流控制（VAD 分块、ASR 并行、pendingVoiceSample 同步），二是翻译的上下文管理（滑动窗口、corrections 回写、术语表维护）。其余都是比较直观的 CRUD 式逻辑。

### 9. 技术深度追问

**Q: WebSocket 二进制帧和 JSON 帧是怎么区分的？（如果前面没讲到）**

> WebSocket 协议本身就区分 text frame 和 binary frame——`ws.on('message', (data, isBinary))` 的第二个参数就是。JSON 消息用 `ws.send(JSON.stringify(...))` 发送（text frame），音频用 `ws.send(arrayBuffer)` 发送（binary frame）。
>
> 比较 tricky 的是声纹样本——它是 JSON 头 + 二进制数据两条消息。服务端收到 `{type: 'voice_sample'}` 后设置 `pendingVoiceSample` 标志，下一条 binary frame 来了就知道是声纹而不是普通音频。标志清除必须是同步的（在 async 操作之前），否则如果 ASR 转录很慢，后续的普通音频帧会被误判。

**Q: 为什么不直接用 Whisper 的流式 API，要自己做 VAD 分块？**

> Whisper 本身不是流式模型——它需要一段完整的音频才能识别。所谓的"流式 Whisper"都是分块策略：把音频流切成小段，每段独立识别。VAD 负责切在合适的地方（句子的自然停顿处），不然会把一句话从中间切断，识别质量大幅下降。
>
> 自己做 VAD 的好处是可以精确控制分块时机，比如检测到端点后不急着发，先看看后面会不会很快续上（双阈值的 speechOnset 就是做这个）。而且 VAD 的参数可以动态调整——实时模式快切，文件模式慢切。

**Q: 12 个翻译方向的 Prompt 有什么区别？**

> 每个方向有独立的 System Prompt，主要区别是：
> - 目标语言的表达习惯提示（比如 zh2ja 会提示用日语敬体）
> - 术语翻译偏好（比如 en2zh 的 IT 术语要用中文通用翻译）
> - corrections 的触发灵敏度（CJK 语言间的互译修正空间更大）
>
> 另外有个 `detectLang()` 函数通过 Unicode 码点统计（CJK 范围、假名范围、韩文范围、Latin 范围）自动检测输入语言，如果和用户选择的源语言不一致，会自动切换到正确的翻译方向。比如用户选了 en→zh 但说的是日语，系统会自动切到 ja→zh。

### 10. 项目中遇到的问题与解决

**Q: 开发过程中遇到过哪些棘手的 bug？**

> **1. TTS 回声循环。** 早期 TTS 播报的声音会被麦克风录回来，服务端再次识别、翻译、合成，形成无限循环。排查后发现单靠 `echoCancellation` 不够——浏览器的回声消除对合成语音效果差。最终用了三层防护：播放期间暂停 Web Speech API、静音 PCM 发送、声纹采集阶段也暂停。
>
> **2. pendingVoiceSample 异步竞争。** 声纹上传用 JSON 头 + Binary 两帧模式，服务端收到 JSON 后设标志位等下一帧二进制。但标志位清除放在了 `await asrTranscribe()` 之后——ASR 转录的几百毫秒里后续音频帧全被误判为声纹数据，导致音频流中断。修复方法：在 async 操作之前同步清除标志位。
>
> **3. SiliconFlow CosyVoice2 声音克隆接口。** 官方文档写的参数名是 `reference_audio`，但实际上要用 `references` 数组格式，而且每个元素必须同时包含 `audio`（data URI）和 `text`（转录文本），缺一个就静默失败不报错。反复抓包对比才发现。
>
> **4. Web Speech API 在标签页捕获模式下不工作。** `getDisplayMedia` 获取的是标签页音频流，但 Web Speech API 只能识别麦克风输入，无法指定音频源。所以标签页模式只能依赖服务端 ASR，浏览器 ASR 自动禁用。这也是为什么架构设计了双路 ASR 而不是只依赖一路。

**Q: 声音克隆的音质不好怎么办？**

> 遇到过两个问题：
> 1. **参考音频太短**——CosyVoice2 需要足够的声纹特征，1-2 秒的音频克隆效果很差。所以设定了 5 秒（80000 samples @16kHz）的采集时长，是多次实验后的平衡点——再长用户等太久，再短音质不够。
> 2. **参考音频包含背景噪声**——如果采集时环境嘈杂，克隆出的声音会带噪。目前的方案是依赖 `echoCancellation` 和 `noiseSuppression` 两个 getUserMedia 约束，在源头减噪。更好的方案是加一个前端 VAD 质量检测，如果能量太低或噪声占比太高就重新采集。

**Q: LLM 翻译有时候格式不对（JSON 解析失败）怎么处理？**

> 流式输出时 LLM 偶尔会输出不规范的 JSON——比如多余的逗号、未闭合的引号、或者在 JSON 外面加了 markdown 代码块标记。处理策略：
> 1. 流式阶段用 Regex 提取 `target` 字段，不做完整 JSON 解析，容错性天然就高
> 2. 完整输出后先 `JSON.parse`，失败则用 Regex 兜底提取各字段
> 3. 如果连 Regex 都提取不到，把整个输出当纯文本译文，至少保证用户能看到东西
>
> 另外 Prompt 里明确要求了"输出纯 JSON，不要代码块"，并在输入里预填了 `{` 引导 LLM 直接输出 JSON，减少格式错误的概率。

**Q: 文件上传模式遇到过什么问题？**

> **FFmpeg 转码兼容性。** 用户上传的格式五花八门——mkv、avi、webm、甚至带 DRM 的 m4a。FFmpeg 参数要覆盖所有情况：`-ac 1 -ar 16000 -f s16le -acodec pcm_s16le`，强制输出单声道 16kHz PCM16。遇到过视频文件没有音轨的情况，FFmpeg 会报错，需要 catch 住返回友好提示。
>
> **大文件内存问题。** 最初是把整个 PCM 数据存在内存里再分块发送，几百 MB 的视频直接 OOM。改成流式处理后——FFmpeg 边转码边输出，客户端收到 0.5 秒的块就立即通过 WebSocket 发送，内存占用恒定。

**Q: 不同浏览器的兼容性问题？**

> 主要问题集中在三个 API：
> 1. **Web Speech API**——Chrome/Edge 支持好，Firefox 部分支持（无 interim results），Safari 需要用户手动授权且 `continuous` 模式不稳定。所以服务端 ASR 是必须的兜底。
> 2. **Document PiP**——只有 Chrome 116+ 支持，Firefox 和 Safari 不支持。用 `'documentPictureInPicture' in window` 检测，不支持就降级 `window.open()`。
> 3. **getDisplayMedia 标签页音频**——Chrome 支持 `{audio: true}`，但 Firefox 的 `getDisplayMedia` 不支持音频捕获。所以标签页捕获模式标注了"仅 Chromium 浏览器"。
>
> 总体策略是：核心功能（麦克风 ASR + 翻译 + 字幕）全浏览器可用，高级功能（PiP、标签页捕获、声音克隆）渐进增强。

**Q: 项目开发过程中有什么设计上的返工？**

> 最大的一次返工是 **ASR 架构从单路改为双路**。最初只用服务端 Whisper ASR，体验上有明显的延迟感——用户说完一句话要等 1-2 秒才看到文字。后来加入浏览器 Web Speech API 做实时字幕显示，服务端 ASR 负责准确识别和翻译触发，两路并行互补。这次改动涉及前后端协议调整、字幕渲染逻辑重写（要合并两路结果）、以及 LocalAgreement-2 算法的引入。
>
> 另一次是 **TTS 从全文合成改为拆段合成**。早期等整句翻译完再合成，延迟 5-6 秒，同传体验很差。改成按标点拆分、只合成第一段（≤50 字符），延迟降到 2.5-3 秒。代价是后半段译文没有语音播报，但同传场景下用户持续在说话，TTS 本来就跟不上全文。

---

## 五、参考资料与工具链接

### 核心 API / 模型

| 工具 / API | 用途 | 链接 | 说明 |
|------------|------|------|------|
| Web Speech API | 浏览器端实时 ASR | https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition | Chrome/Edge 原生支持，`continuous` + `interimResults` 实现逐词输出 |
| SenseVoice (SiliconFlow) | 服务端 ASR | https://docs.siliconflow.cn/api-reference/audio/create-transcription | FunAudioLLM/SenseVoiceSmall，支持 50+ 语言自动检测，免费额度 |
| Whisper (Groq) | 服务端 ASR 备选 | https://console.groq.com/docs/speech-text | whisper-large-v3，免费快速 |
| DeepSeek Chat | LLM 翻译 | https://platform.deepseek.com/api-docs | deepseek-chat，¥1/百万 token，OpenAI 兼容格式 |
| CosyVoice2 (SiliconFlow) | TTS + 声音克隆 | https://docs.siliconflow.cn/api-reference/audio/create-speech | `references` 数组传参克隆，需同时提供 audio data URI + text transcript |
| Document PiP API | 画中画浮窗 | https://developer.chrome.com/docs/web-platform/document-picture-in-picture | Chrome 116+，`documentPictureInPicture.requestWindow()` |
| getDisplayMedia | 标签页音频捕获 | https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia | `{audio: true}` 捕获标签页音频，仅 Chromium |
| Web Audio API | 频谱 / 重采样 | https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API | AnalyserNode（FFT）、ScriptProcessorNode（PCM 采集）、AudioContext |

### 算法 / 论文

| 参考 | 说明 | 链接 |
|------|------|------|
| whisper_streaming | LocalAgreement-2 字幕稳定算法来源 | https://github.com/ufal/whisper_streaming |
| Whisper 论文 | OpenAI Whisper ASR 模型 | https://arxiv.org/abs/2212.04356 |
| CosyVoice 论文 | 声音克隆 TTS 模型 | https://arxiv.org/abs/2407.05407 |

### 开发工具

| 工具 | 用途 | 链接 |
|------|------|------|
| FFmpeg | 音视频转码（任意格式 → 16kHz PCM16 单声道） | https://ffmpeg.org/ |
| yt-dlp | 在线视频音频提取（支持 1000+ 网站） | https://github.com/yt-dlp/yt-dlp |
| ws (npm) | Node.js WebSocket 服务端 | https://github.com/websockets/ws |
| dotenv (npm) | 环境变量加载 | https://github.com/motdotla/dotenv |

### 备选 LLM Provider

| Provider | 链接 | 模型 | 特点 |
|----------|------|------|------|
| DeepSeek | https://platform.deepseek.com | deepseek-chat | 性价比最高，日韩翻译好 |
| 通义千问 | https://dashscope.console.aliyun.com | qwen-plus | 阿里云，中文理解强 |
| Kimi (Moonshot) | https://platform.moonshot.cn | moonshot-v1-8k | 长上下文 |
| OpenAI | https://platform.openai.com | gpt-4o-mini | 英文翻译质量最高，价格较贵 |
| 智谱 AI | https://open.bigmodel.cn | glm-4-flash | 免费额度大 |
| SiliconFlow | https://cloud.siliconflow.cn | 多种开源模型 | 统一 API 访问多个开源 LLM |

### 浏览器兼容性速查

| 功能 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| Web Speech API (interim) | ✅ | ⚠️ 无 interim | ⚠️ 不稳定 | ✅ |
| getUserMedia | ✅ | ✅ | ✅ | ✅ |
| getDisplayMedia (audio) | ✅ | ❌ 不支持音频 | ❌ | ✅ |
| Document PiP | ✅ 116+ | ❌ | ❌ | ✅ 116+ |
| AudioContext / AnalyserNode | ✅ | ✅ | ✅ | ✅ |
| WebSocket binary | ✅ | ✅ | ✅ | ✅ |
