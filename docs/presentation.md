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
> 标签页模式的画中画窗口用 Document PiP API 实现，500×180 悬浮窗，注入自定义 CSS + DOM，所有 WebSocket 消息都会同步更新悬浮窗的字幕。不支持 PiP 的浏览器降级为普通弹窗。

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

## 二、面试官可能问的问题 + 回答

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
