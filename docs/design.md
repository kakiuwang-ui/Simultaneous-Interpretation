# AI 同声传译助手 - 设计方案

## 1. 项目概述

### 1.1 题目要求

用户经常需要观看英语（或其他外语）演讲、技术分享、国际会议或网课。本项目开发一款 AI 同声传译助手，帮助用户降低语言门槛，提升信息获取效率。

### 1.2 核心需求

| 维度 | 要求 |
|------|------|
| 翻译方向 | **单向**：外语（英语/日语/韩语等）→ 中文 |
| 输入源 | 单向音频流（麦克风捕获系统音频、音频文件等） |
| 输出形式 | **字幕**（实时文本显示）和/或 **语音**（TTS 朗读） |
| 实时性 | 实时、流畅，帮助用户跟上内容节奏 |
| 纠错能力 | 系统能自动修正之前识别或翻译的错误 |

### 1.3 典型使用场景

- 观看英语技术演讲（YouTube/Bilibili 直播）
- 参加国际会议的线上直播
- 收听外语播客或网课
- 翻译已有的外语音视频文件

---

## 2. 技术架构

### 2.1 整体管线

```
音频输入 → ASR (语音识别) → 纠错引擎 → 智能分句 → MT (翻译) → 纠错引擎 → 字幕输出
     │                                                              └──→ TTS → 语音输出
     │
     └── 系统音频捕获 / 麦克风 / 音频文件
```

### 2.2 纠错机制（核心特性）

纠错是本系统的关键差异化能力，分为两个层面：

#### A. ASR 识别纠错

```
ASR 返回中间结果 (interim) 和最终结果 (final):

  interim: "I think the algor..."       → 字幕显示（灰色，标记为暂定）
  interim: "I think the algorithm..."   → 字幕原地更新
  final:   "I think the algorithm is..."→ 字幕变为确定状态（白色）

当 final 结果与之前的 interim 不同时 → 自动覆盖更新字幕
```

**实现方式**：
- ASR 引擎（Deepgram/Whisper）返回 `is_final` 标志
- 维护一个 `current_segment` 缓冲区，interim 结果持续覆盖
- final 结果到达时锁定该段，推入翻译队列

#### B. 翻译纠错（上下文回溯修正）

```
段 1 翻译: "I will present the model" → "我将介绍这个模型"
段 2 翻译: "...training results"      → "...训练结果"

此时系统回溯发现：结合上下文，段 1 的 "model" 更应翻译为 "模型的训练结果"
→ 自动修正段 1 的字幕，合并为更流畅的翻译
```

**实现方式**：
- 维护最近 N 段（默认 5 段）的翻译历史滑动窗口
- 每翻译新段时，将新段 + 历史窗口一起送入 LLM（Claude）
- LLM 判断是否需要修正之前的翻译，返回修正结果
- 字幕 UI 支持原地更新已显示的文本（带"已修正"标记）
- 为控制延迟，纠错为异步后台任务，不阻塞当前段的即时翻译

#### 纠错流程图

```
                    ┌─────────────┐
   ASR interim ───▶│ 字幕缓冲区   │──▶ 显示暂定字幕（灰色）
   ASR final   ───▶│ (覆盖更新)   │──▶ 显示确定字幕（白色）
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐     ┌──────────────────┐
                    │  即时翻译    │────▶│ 显示即时中文翻译   │
                    │  (DeepL)    │     └──────────────────┘
                    └──────┬──────┘
                           │ 异步
                           ▼
                    ┌─────────────────┐  ┌──────────────────┐
                    │ 上下文纠错      │─▶│ 回溯修正已有翻译   │
                    │ (Claude LLM)   │  │ (带修正标记)       │
                    └─────────────────┘  └──────────────────┘
```

### 2.3 系统架构图

```
┌────────────────────────────────────────────────────────────────────┐
│                         AI 同声传译助手                             │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │                    Audio Input Layer                        │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │   │
│  │  │ System Audio  │  │  Microphone  │  │  Audio File     │  │   │
│  │  │ (BlackHole等) │  │  (直接录入)   │  │  (.mp3/.wav等)  │  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘  │   │
│  │         └─────────────────┼───────────────────┘            │   │
│  └───────────────────────────┼────────────────────────────────┘   │
│                              ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              Pipeline Orchestrator (asyncio)                │   │
│  │                                                            │   │
│  │  audio_q → [ASR] → text_q → [Chunking] → [MT] → output_q │   │
│  │                                    ↕                       │   │
│  │                          [Correction Engine]               │   │
│  │                        (异步回溯纠错 LLM)                    │   │
│  └────────────────────────────────────────────────────────────┘   │
│                              │                                     │
│                    ┌─────────┴─────────┐                          │
│                    ▼                   ▼                           │
│  ┌──────────────────────┐  ┌──────────────────────┐              │
│  │   Subtitle Output    │  │    Voice Output      │              │
│  │  (终端/Web 实时字幕)   │  │   (TTS 语音播放)     │              │
│  │  - 原文 + 中文翻译    │  │   - OpenAI TTS 流式  │              │
│  │  - 暂定/确定状态标记   │  │   - 可选开关          │              │
│  │  - 纠错高亮显示       │  │                      │              │
│  └──────────────────────┘  └──────────────────────┘              │
└────────────────────────────────────────────────────────────────────┘
```

### 2.4 设计原则

- **Provider 可插拔**：ASR / MT / TTS 每层定义抽象接口，具体实现通过配置切换
- **流式优先**：各阶段通过 `AsyncIterator` + `asyncio.Queue` 连接，数据到达即传递
- **双层纠错**：ASR 层的 interim→final 纠错 + 翻译层的上下文回溯纠错
- **字幕优先，语音可选**：字幕始终显示，TTS 语音为可选输出

---

## 3. 技术选型

### 3.1 ASR（语音识别）

| 方案 | 角色 | 延迟 | 英语效果 | 成本 |
|------|------|------|---------|------|
| **Deepgram Nova-3** | 主选（实时流式） | ~200ms | WER 6.84%，极佳 | $0.0043/min，首 $200 免费 |
| **faster-whisper** | 备选（离线/文件） | 离线处理 | Whisper large-v3 级别 | 免费（本地运行） |

**选择理由**：Deepgram 原生 WebSocket 流式，支持 interim_results（中间结果）用于实时字幕更新和 ASR 级纠错。文件模式用本地 Whisper 省 API 费用。

### 3.2 机器翻译

| 方案 | 角色 | 延迟 | 质量 | 成本 |
|------|------|------|------|------|
| **DeepL API** | 即时翻译（实时路径） | ~50ms | 高 | 50 万字符/月免费 |
| **Claude Sonnet** | 上下文纠错 + 高质量翻译 | ~1-2s | 最高 | $3/M input tokens |

**双引擎策略**：
- **DeepL**：每段文本到达后立即翻译，保证低延迟字幕显示
- **Claude**：异步后台运行，带上下文窗口审查最近翻译，发现错误则回溯修正

### 3.3 TTS（语音合成）

| 方案 | 延迟 | 中文效果 | 成本 |
|------|------|---------|------|
| **OpenAI TTS** | ~300ms | 自然流畅 | $15/M 字符 |
| **Edge TTS** | ~200ms | 微软语音 | 免费 |

TTS 为可选功能，用户可选择仅看字幕。

### 3.4 音频捕获方案

| 场景 | 方案 | 说明 |
|------|------|------|
| 系统音频（看视频/直播） | **BlackHole** (macOS) / **VB-Cable** (Windows) | 虚拟音频设备捕获系统输出 |
| 麦克风直录 | **sounddevice** | 直接采集麦克风输入 |
| 音频文件 | **pydub** + **ffmpeg** | 读取各种格式音视频 |

### 3.5 前端展示

| 阶段 | 方案 | 说明 |
|------|------|------|
| MVP | **rich** 终端 UI | 实时字幕 + 颜色标记（暂定灰色/确定白色/修正黄色） |
| 正式版 | **Gradio** Web UI | 浏览器中显示字幕、控制按钮、设置面板 |

### 3.6 延迟预算

```
目标：字幕首次显示延迟 < 1s

ASR (Deepgram interim)  : ~200ms   ← 中间结果即可显示暂定字幕
智能分句 (本地)           :  ~10ms
即时翻译 (DeepL)         :  ~50ms
─────────────────────────────────
字幕显示延迟              : ~260ms

上下文纠错 (Claude)      : ~1-2s   ← 异步后台，不阻塞即时显示
TTS 语音 (OpenAI)        : ~300ms  ← 仅在 final 结果确定后触发
```

---

## 4. 项目文件结构

```
simultaneous-interpretation/
├── pyproject.toml                  # 项目元数据 & 依赖
├── .env.example                    # API Key 模板
├── config/
│   └── default.yaml                # 默认配置
│
├── src/interp/
│   ├── __init__.py
│   ├── main.py                     # CLI 入口 (typer)
│   ├── config.py                   # pydantic-settings 配置
│   ├── pipeline.py                 # 核心管线编排器
│   │
│   ├── asr/                        # 语音识别
│   │   ├── base.py                 # ASRProvider 抽象基类
│   │   ├── deepgram.py             # Deepgram Nova-3 流式
│   │   └── whisper_local.py        # faster-whisper 本地
│   │
│   ├── translation/                # 机器翻译
│   │   ├── base.py                 # TranslationProvider 接口
│   │   ├── deepl.py                # DeepL (即时翻译)
│   │   └── claude.py               # Claude (上下文纠错)
│   │
│   ├── tts/                        # 语音合成
│   │   ├── base.py                 # TTSProvider 接口
│   │   └── openai_tts.py           # OpenAI TTS 流式
│   │
│   ├── correction/                 # 纠错引擎
│   │   ├── __init__.py
│   │   ├── asr_correction.py       # ASR interim→final 纠错逻辑
│   │   └── translation_correction.py  # LLM 上下文回溯纠错
│   │
│   ├── audio/                      # 音频 I/O
│   │   ├── capture.py              # 音频采集 (sounddevice)
│   │   ├── playback.py             # 音频播放
│   │   └── file_io.py              # 文件读写 (pydub/ffmpeg)
│   │
│   ├── chunking/                   # 智能分句
│   │   └── segmenter.py            # 语法感知分句
│   │
│   └── ui/                         # 用户界面
│       ├── terminal.py             # Rich 终端字幕显示
│       └── web.py                  # Gradio Web UI (Phase 3)
│
├── tests/
│   ├── test_pipeline.py
│   ├── test_correction.py
│   ├── test_chunking.py
│   └── ...
│
└── scripts/
    └── benchmark_latency.py
```

---

## 5. 核心数据结构

```python
from dataclasses import dataclass, field
from enum import Enum

class SegmentStatus(Enum):
    INTERIM = "interim"       # ASR 中间结果（暂定）
    FINAL = "final"           # ASR 最终结果（确定）
    CORRECTED = "corrected"   # 经纠错引擎修正

@dataclass
class TranscriptSegment:
    id: str                   # 唯一标识，用于纠错时定位
    text: str                 # 识别文本
    language: str             # ISO 639-1 (en, ja, ko, ...)
    start_time: float         # 开始时间（秒）
    end_time: float           # 结束时间（秒）
    status: SegmentStatus     # 当前状态
    confidence: float         # 置信度

@dataclass
class TranslatedSegment:
    id: str                   # 与 TranscriptSegment.id 对应
    source_text: str          # 原文
    translated_text: str      # 中文翻译
    status: SegmentStatus     # 翻译状态
    previous_text: str = ""   # 修正前的文本（如有修正）
    correction_reason: str = ""  # 修正原因

@dataclass
class SubtitleLine:
    segment_id: str
    source_text: str          # 原文
    translated_text: str      # 中文翻译
    status: SegmentStatus
    timestamp: float
```

---

## 6. 核心接口定义

```python
# asr/base.py
class ASRProvider(ABC):
    @abstractmethod
    async def transcribe_stream(
        self, audio_chunks: AsyncIterator[bytes]
    ) -> AsyncIterator[TranscriptSegment]:
        """流式识别，返回 interim + final 结果"""

    @abstractmethod
    async def transcribe_file(
        self, file_path: Path
    ) -> list[TranscriptSegment]:
        """文件识别"""

# translation/base.py
class TranslationProvider(ABC):
    @abstractmethod
    async def translate(
        self, text: str, source_lang: str, target_lang: str
    ) -> str:
        """单句翻译"""

# correction/translation_correction.py
class TranslationCorrector:
    async def check_and_correct(
        self,
        new_segment: TranslatedSegment,
        history: list[TranslatedSegment],
    ) -> list[TranslatedSegment]:
        """
        检查新翻译是否导致历史翻译需要修正。
        返回需要更新的 segment 列表（可能为空）。
        """

# tts/base.py
class TTSProvider(ABC):
    @abstractmethod
    async def synthesize_stream(
        self, text: str, lang: str
    ) -> AsyncIterator[bytes]:
        """流式合成"""
```

---

## 7. 智能分句策略

分句质量直接影响翻译效果——碎片化输入会导致翻译质量骤降。

```
英语规则:
  - 遇到句号(.)、问号(?)、感叹号(!) → 立即切分
  - 遇到逗号(,) 且当前段 > 30 字符 → 切分
  - 段长超过 100 字符 → 强制切分

日语规则:
  - 遇到 。！？ → 立即切分
  - 遇到 、 且当前段 > 20 字符 → 切分

韩语规则:
  - 遇到 . ! ? → 立即切分
  - 遇到 , 且当前段 > 20 字符 → 切分

通用:
  - ASR 返回 is_final=true 且静音 > 500ms → 刷新缓冲区
  - 始终保留上一段最后 10 个字符作为上下文重叠
```

---

## 8. 纠错引擎详细设计

### 8.1 ASR 级纠错

```python
class ASRCorrectionBuffer:
    """管理 ASR interim/final 结果的缓冲区"""

    def __init__(self):
        self.current_segment: Optional[TranscriptSegment] = None

    def update(self, segment: TranscriptSegment) -> tuple[str, SegmentStatus]:
        """
        接收 ASR 结果，返回当前应显示的文本和状态。
        - interim 结果：覆盖当前缓冲，返回暂定文本
        - final 结果：锁定当前段，返回确定文本
        """
        if segment.status == SegmentStatus.INTERIM:
            self.current_segment = segment
            return segment.text, SegmentStatus.INTERIM
        else:  # FINAL
            finalized = segment
            self.current_segment = None
            return finalized.text, SegmentStatus.FINAL
```

### 8.2 翻译级纠错（LLM 上下文回溯）

```python
CORRECTION_PROMPT = """你是同声传译质量审查员。

以下是最近的翻译记录：
{history}

最新一段原文：{new_source}
最新一段翻译：{new_translation}

请检查：
1. 结合最新上下文，之前的翻译是否有术语不一致、误译、或断句不当？
2. 如有需要修正的，返回修正内容。

如无需修正，返回空列表。
返回 JSON 格式：
[{{"segment_id": "...", "corrected_text": "...", "reason": "..."}}]
"""

class TranslationCorrector:
    def __init__(self, llm_client, window_size=5):
        self.history: deque[TranslatedSegment] = deque(maxlen=window_size)

    async def check_and_correct(self, new_segment):
        self.history.append(new_segment)
        if len(self.history) < 2:
            return []

        # 异步调用 Claude 审查
        response = await self.llm_client.messages.create(
            model="claude-sonnet-4-20250514",
            messages=[{"role": "user", "content": prompt}],
        )
        corrections = parse_corrections(response)
        return corrections
```

### 8.3 纠错在 UI 中的呈现

```
终端字幕显示示例：

[00:05] EN: I think the algorithm is very efficient
[00:05] CN: 我认为这个算法非常高效

[00:08] EN: especially for large scale data processing
[00:08] CN: 特别是对于大规模数据处理    ← 即时翻译(DeepL)

[00:10] ※ 修正 [00:05]: "算法" → "这种算法"，原因：结合后文，指代更明确
[00:05] CN: 我认为这种算法非常高效     ← 修正后（黄色高亮）
```

---

## 9. 实施计划

### Phase 1: 基础管线 + 文件翻译（第 1 周）

- [ ] 项目脚手架：pyproject.toml、目录结构、.env.example
- [ ] pydantic-settings 配置系统 + default.yaml
- [ ] 定义 ASR / MT / TTS 抽象接口
- [ ] 实现 faster-whisper 本地 ASR（文件转录，带时间戳）
- [ ] 实现 DeepL 翻译 Provider
- [ ] 实现 OpenAI TTS Provider
- [ ] Pipeline 编排器（文件模式）：串联各阶段
- [ ] CLI 入口：`interp file input.mp3 --source en`
- [ ] **验收**：英语演讲录音 → 中文音频 + SRT 双语字幕

### Phase 2: 实时流式 + ASR 纠错（第 2 周）

- [ ] 实现 Deepgram 流式 ASR（WebSocket，interim + final）
- [ ] sounddevice 音频采集（支持麦克风和系统音频设备）
- [ ] ASR 纠错缓冲区（interim 覆盖更新，final 锁定）
- [ ] 智能分句模块
- [ ] 流式 Pipeline 编排器（asyncio.Queue 并发）
- [ ] Rich 终端字幕 UI（暂定灰色/确定白色）
- [ ] TTS 可选语音输出
- [ ] CLI 入口：`interp live --source en`
- [ ] **验收**：播放英语视频 → 终端实时显示中文字幕，interim 结果自动更新

### Phase 3: 翻译纠错 + 质量优化（第 3 周）

- [ ] Claude 翻译纠错引擎（滑动窗口上下文审查）
- [ ] 异步后台纠错任务（不阻塞即时翻译）
- [ ] 字幕修正显示（黄色高亮 + 修正原因）
- [ ] 术语一致性优化
- [ ] 延迟基准测试脚本
- [ ] 错误处理：断线重连、API 降级
- [ ] **验收**：长段落演讲中，系统自动修正之前的术语不一致

### Phase 4: Web UI + 完善（第 4 周）

- [ ] Gradio Web UI：实时字幕面板、语言选择、开始/停止按钮
- [ ] 字幕纠错可视化（划线旧翻译 + 显示新翻译）
- [ ] 音频文件上传翻译
- [ ] TTS 开关和音量控制
- [ ] 字幕导出功能（SRT/TXT）
- [ ] Docker 打包
- [ ] **验收**：浏览器中完整体验实时同传 + 自动纠错

---

## 10. 依赖清单

```toml
[project]
name = "ai-interpreter"
version = "0.1.0"
requires-python = ">=3.11"

dependencies = [
    # 核心框架
    "pydantic>=2.0",
    "pydantic-settings>=2.0",
    "pyyaml>=6.0",
    "typer>=0.9",
    "rich>=13.0",

    # 音频处理
    "sounddevice>=0.4",
    "numpy>=1.24",
    "pydub>=0.25",

    # ASR
    "deepgram-sdk>=3.0",
    "faster-whisper>=0.10",

    # 翻译
    "deepl>=1.16",
    "anthropic>=0.25",

    # TTS
    "openai>=1.12",

    # 工具
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "pytest-asyncio>=0.23",
]
web = [
    "gradio>=4.0",
]
```

---

## 11. 配置示例

```yaml
# config/default.yaml

asr:
  provider: deepgram          # deepgram | whisper_local
  deepgram:
    model: nova-3
    language: en              # 源语言
    interim_results: true     # 开启中间结果（用于纠错）
    endpointing: 800          # 静音判定阈值 (ms)
  whisper:
    model_size: large-v3
    device: auto

translation:
  provider: deepl             # 即时翻译引擎
  target_language: zh         # 目标语言：中文
  deepl:
    formality: default
  correction:
    enabled: true             # 是否启用 LLM 纠错
    provider: claude
    model: claude-sonnet-4-20250514
    window_size: 5            # 上下文窗口大小
    system_prompt: |
      你是专业同声传译质量审查员。
      检查翻译的准确性、术语一致性和流畅度。
      仅在确实有误时才建议修正。

tts:
  enabled: false              # 默认仅字幕，可开启语音
  provider: openai
  openai:
    model: tts-1
    voice: alloy
    speed: 1.0

pipeline:
  chunk_min_chars: 10
  chunk_max_chars: 100
  silence_threshold_ms: 800
  context_window: 5

audio:
  input_device: default       # 音频输入设备（default/系统音频设备名）
  sample_rate: 16000
  channels: 1
  chunk_duration_ms: 100
```

---

## 12. CLI 使用方式

```bash
# 实时同传：捕获系统音频，翻译英语演讲为中文字幕
interp live --source en

# 实时同传：指定音频设备（如 BlackHole 捕获系统音频）
interp live --source en --device "BlackHole 2ch"

# 实时同传：同时输出字幕和语音
interp live --source en --tts

# 翻译音频文件
interp file lecture.mp3 --source en --output lecture_zh.mp3

# 翻译并生成字幕文件
interp file lecture.mp3 --source en --subtitle lecture.srt

# 启动 Web UI
interp web --port 7860
```

---

## 13. 风险与应对

| 风险 | 应对策略 |
|------|---------|
| 系统音频捕获需要虚拟音频设备 | 提供 BlackHole/VB-Cable 安装指南；或支持麦克风外放录入 |
| Deepgram 英语 ASR 很强但其他语言较弱 | 英语场景用 Deepgram；日韩可切换 Whisper large-v3 |
| LLM 纠错增加成本 | 纠错默认开启但可关闭；仅在 final 段累积后才触发，控制调用频率 |
| DeepL 免费额度有限 | 监控用量；超额时降级为 Claude 直接翻译 |
| 字幕频繁修正影响阅读体验 | 设置修正阈值，仅在改动幅度较大时才触发修正显示 |

---

## 14. API Key 需求

| 服务 | 用途 | 获取地址 | 免费额度 |
|------|------|---------|---------|
| Deepgram | 实时语音识别 | https://console.deepgram.com | $200 免费额度 |
| DeepL | 即时翻译 | https://www.deepl.com/pro-api | 50万字符/月免费 |
| OpenAI | TTS 语音合成 | https://platform.openai.com | 按量计费 |
| Anthropic | 翻译纠错 | https://console.anthropic.com | 按量计费 |
