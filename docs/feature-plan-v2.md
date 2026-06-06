# V2 功能规划

## 1. 翻译上下文记忆

**现状**: `RollingTranslator` 使用 4 句滑动窗口，每句独立翻译，无术语一致性保证。

**改进**:
- 上下文窗口扩大到 8 句
- 新增术语追踪：LLM 翻译时额外输出 `terms` 字段（术语对照），累积为全局术语表
- 后续翻译 prompt 注入术语表，确保同一术语始终统一翻译
- 术语表上限 30 条，FIFO 淘汰

**涉及文件**: `server/providers.js`

---

## 3. 说话人分离

**方案**: 基于静音间隔的简单说话人切换检测（非 ML 方案）。

**实现**:
- ASR 层检测静音间隔 > 2 秒时标记说话人切换
- 前端为不同说话人分配不同颜色标签（Speaker A / Speaker B 交替）
- 浏览器 ASR 模式：利用 `recognition.onend` + 重启间隔判断说话人切换
- 最多支持 2 位说话人（交替模式）

**涉及文件**: `server/asr.js`, `server/server.js`, `web/app.js`, `web/style.css`

---

## 4. 流式 TTS

**现状**: 整句翻译完成后才调用 TTS API，延迟 = 翻译耗时 + TTS 合成耗时。

**改进**:
- 翻译完成后立即开始 TTS 合成（已是这样）
- 新增: TTS 队列管理 — 如果新的 TTS 请求到达而上一个还在合成，跳过旧的直接合成新的
- 新增: 长句拆分 — 超过 50 字符的译文按标点拆分为多段，第一段立即合成发送
- 浏览器 TTS 也做相同的分段处理

**涉及文件**: `server/tts.js`, `server/server.js`, `web/app.js`

---

## 6. 会话持久化

**方案**: 使用 localStorage 自动保存字幕数据，刷新页面后可恢复。

**实现**:
- 每次收到 `asr_final` 或 `translation` 时自动保存到 localStorage
- 保存内容: sourceLines、targetLines、segTimestamps、direction
- 页面加载时检测并提示恢复（顶部 toast 提示 "发现上次的字幕记录，是否恢复？"）
- 点击「开始」或「上传」时自动清除旧记录
- localStorage key: `si_session`

**涉及文件**: `web/app.js`, `web/style.css`

---

## 7. 翻译质量反馈

**方案**: 用户单击译文行可标记"不准确"，反馈注入后续翻译 prompt。

**实现**:
- 译文行右侧显示 👎 按钮（hover 时可见）
- 点击后该行标记为"有问题"，发送 `feedback` 消息到服务端
- 服务端在 RollingTranslator 中记录被标记的译文
- 后续翻译 prompt 追加: "注意: 用户标记了句X的翻译不准确，请参考改进"
- 最多保留最近 3 条反馈

**涉及文件**: `web/app.js`, `web/style.css`, `server/server.js`, `server/providers.js`

---

## 8. 双语 SRT 导出

**现状**: 导出的 SRT 将原文和译文放在同一条字幕中。

**改进**:
- 导出按钮改为下拉菜单，提供 3 种导出选项:
  - 双语 SRT（原文 + 译文，当前行为）
  - 仅原文 SRT
  - 仅译文 SRT
- 文件名标注类型: `subtitles_bilingual_xxx.srt`

**涉及文件**: `web/app.js`, `web/index.html`, `web/style.css`

---

## 10. OBS 实时字幕叠加

**方案**: 提供独立的 `/overlay.html` 页面，OBS 作为浏览器源捕获。

**实现**:
- 新页面 `web/overlay.html`：透明背景，只显示最新一条译文
- 通过 WebSocket 接收与主页面相同的翻译消息
- 样式: 大字号、文字描边、底部居中、透明背景
- URL 参数控制: `?mode=source|target|both`（显示原文/译文/双语）
- 服务器无需改动，overlay 页面复用现有 WebSocket 协议
- 主页面控制条增加「复制 OBS 链接」按钮

**涉及文件**: `web/overlay.html`, `web/overlay.js`, `web/overlay.css`, `web/index.html`
