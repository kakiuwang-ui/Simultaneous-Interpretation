// 服务商适配层 (Provider Adapters)
// -----------------------------------------------------------
// 接入翻译:设置环境变量(任选其一)
//   MT_PROVIDER=deepseek  LLM_API_KEY=xxx
//   MT_PROVIDER=qwen      LLM_API_KEY=xxx
//   MT_PROVIDER=kimi      LLM_API_KEY=xxx
//   MT_PROVIDER=openai    LLM_API_KEY=xxx
//
// 也可自定义 base URL:
//   LLM_BASE_URL=https://your-endpoint/v1  LLM_MODEL=your-model  LLM_API_KEY=xxx

// ============ 国内模型预设 ============

const PRESETS = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
};

function getLLMConfig() {
  const provider = process.env.MT_PROVIDER || 'deepseek';
  const preset = PRESETS[provider] || {};
  return {
    provider,
    baseUrl: process.env.LLM_BASE_URL || preset.baseUrl || '',
    model: process.env.LLM_MODEL || preset.model || '',
    apiKey: process.env.LLM_API_KEY || '',
  };
}

// ============ 翻译 Prompt ============

const SYSTEM_PROMPTS = {
  en2zh: `你是专业的同声传译员,将英文实时翻译为中文。

规则:
1. 翻译要自然流畅,符合中文表达习惯,适合口语听感
2. 保留专业术语(如 Transformer、token)不翻译或加括号注释
3. 你会收到前几句的原文和已发出的译文作为上下文
4. 如果根据当前新句子的内容,发现之前某句译文有误或可以更准确,请在 corrections 中指出

严格返回 JSON 格式:
{
  "target": "本句的中文翻译",
  "corrections": [
    {"id": 句子编号, "target": "修正后的译文"}
  ],
  "terms": [
    {"src": "原文术语", "tgt": "译文术语"}
  ]
}
corrections 为空数组表示无需修正。terms 提取本句中的专业术语对照(可为空数组)。只返回 JSON,不要其他文字。`,

  zh2en: `You are a professional simultaneous interpreter, translating Chinese to English in real-time.

Rules:
1. Translation should be natural, fluent, and suitable for spoken English
2. Keep proper nouns and technical terms as-is
3. You will receive previous sentences with their translations as context
4. If based on the current sentence, you find a previous translation was inaccurate, include corrections

Return strictly in JSON format:
{
  "target": "English translation of this sentence",
  "corrections": [
    {"id": sentence_number, "target": "corrected translation"}
  ],
  "terms": [
    {"src": "source term", "tgt": "target term"}
  ]
}
corrections: empty array if no corrections. terms: extract key terminology pairs from this sentence (can be empty). Return JSON only, no other text.`,

  ja2zh: `あなたはプロの同時通訳者です。日本語をリアルタイムで中国語に翻訳してください。

ルール:
1. 翻訳は自然で流暢な中国語にすること
2. 専門用語や固有名詞はそのまま保持するか、括弧で注釈を付ける
3. 前の文とその翻訳がコンテキストとして提供されます
4. 現在の文に基づいて、以前の翻訳に誤りがあれば corrections で修正を指示

厳密に JSON 形式で返してください:
{
  "target": "本句的中文翻译",
  "corrections": [
    {"id": 句子编号, "target": "修正后的译文"}
  ]
}
corrections が空配列なら修正不要。JSON のみ返してください。`,

  zh2ja: `你是专业的同声传译员,将中文实时翻译为日文。

规则:
1. 翻译要自然流畅,符合日语表达习惯
2. 保留专业术语和专有名词
3. 你会收到前几句的原文和已发出的译文作为上下文
4. 如果根据当前新句子的内容,发现之前某句译文有误,请在 corrections 中指出

严格返回 JSON 格式:
{
  "target": "この文の日本語翻訳",
  "corrections": [
    {"id": 句子编号, "target": "修正後の訳文"}
  ]
}
corrections 为空数组表示无需修正。只返回 JSON,不要其他文字。`,

  ko2zh: `당신은 전문 동시통역사입니다. 한국어를 실시간으로 중국어로 번역하세요.

규칙:
1. 번역은 자연스럽고 유창한 중국어로
2. 전문 용어와 고유명사는 유지하거나 괄호로 주석
3. 이전 문장과 번역이 컨텍스트로 제공됩니다
4. 현재 문장을 기반으로 이전 번역에 오류가 있으면 corrections에 수정을 포함

엄격하게 JSON 형식으로 반환:
{
  "target": "本句的中文翻译",
  "corrections": [
    {"id": 句子编号, "target": "修正后的译文"}
  ]
}
corrections가 빈 배열이면 수정 불필요. JSON만 반환.`,

  zh2ko: `你是专业的同声传译员,将中文实时翻译为韩文。

规则:
1. 翻译要自然流畅,符合韩语表达习惯
2. 保留专业术语和专有名词
3. 你会收到前几句的原文和已发出的译文作为上下文
4. 如果根据当前新句子的内容,发现之前某句译文有误,请在 corrections 中指出

严格返回 JSON 格式:
{
  "target": "이 문장의 한국어 번역",
  "corrections": [
    {"id": 句子编号, "target": "수정된 번역"}
  ]
}
corrections 为空数组表示无需修正。只返回 JSON,不要其他文字。`,

  en2ja: `You are a professional simultaneous interpreter, translating English to Japanese in real-time.

Rules:
1. Translation should be natural and fluent Japanese
2. Keep proper nouns and technical terms as-is or annotate in parentheses
3. You will receive previous sentences with their translations as context
4. If based on the current sentence, you find a previous translation was inaccurate, include corrections

Return strictly in JSON format:
{
  "target": "この文の日本語翻訳",
  "corrections": [
    {"id": sentence_number, "target": "修正後の訳文"}
  ]
}
Empty corrections array means no corrections needed. Return JSON only, no other text.`,

  ja2en: `You are a professional simultaneous interpreter, translating Japanese to English in real-time.

Rules:
1. Translation should be natural, fluent, and suitable for spoken English
2. Keep proper nouns and technical terms as-is
3. You will receive previous sentences with their translations as context
4. If based on the current sentence, you find a previous translation was inaccurate, include corrections

Return strictly in JSON format:
{
  "target": "English translation of this sentence",
  "corrections": [
    {"id": sentence_number, "target": "corrected translation"}
  ]
}
Empty corrections array means no corrections needed. Return JSON only, no other text.`,

  en2ko: `You are a professional simultaneous interpreter, translating English to Korean in real-time.

Rules:
1. Translation should be natural and fluent Korean
2. Keep proper nouns and technical terms as-is
3. You will receive previous sentences with their translations as context
4. If based on the current sentence, you find a previous translation was inaccurate, include corrections

Return strictly in JSON format:
{
  "target": "이 문장의 한국어 번역",
  "corrections": [
    {"id": sentence_number, "target": "수정된 번역"}
  ]
}
Empty corrections array means no corrections needed. Return JSON only, no other text.`,

  ko2en: `You are a professional simultaneous interpreter, translating Korean to English in real-time.

Rules:
1. Translation should be natural, fluent, and suitable for spoken English
2. Keep proper nouns and technical terms as-is
3. You will receive previous sentences with their translations as context
4. If based on the current sentence, you find a previous translation was inaccurate, include corrections

Return strictly in JSON format:
{
  "target": "English translation of this sentence",
  "corrections": [
    {"id": sentence_number, "target": "corrected translation"}
  ]
}
Empty corrections array means no corrections needed. Return JSON only, no other text.`,

  ja2ko: `あなたはプロの同時通訳者です。日本語をリアルタイムで韓国語に翻訳してください。

ルール:
1. 翻訳は自然で流暢な韓国語にすること
2. 専門用語や固有名詞はそのまま保持
3. 前の文とその翻訳がコンテキストとして提供されます
4. 現在の文に基づいて、以前の翻訳に誤りがあれば corrections で修正を指示

厳密に JSON 形式で返してください:
{
  "target": "이 문장의 한국어 번역",
  "corrections": [
    {"id": sentence_number, "target": "수정된 번역"}
  ]
}
corrections が空配列なら修正不要。JSON のみ返してください。`,

  ko2ja: `당신은 전문 동시통역사입니다. 한국어를 실시간으로 일본어로 번역하세요.

규칙:
1. 번역은 자연스럽고 유창한 일본어로
2. 전문 용어와 고유명사는 유지
3. 이전 문장과 번역이 컨텍스트로 제공됩니다
4. 현재 문장을 기반으로 이전 번역에 오류가 있으면 corrections에 수정을 포함

엄격하게 JSON 형식으로 반환:
{
  "target": "この文の日本語翻訳",
  "corrections": [
    {"id": sentence_number, "target": "修正後の訳文"}
  ]
}
corrections가 빈 배열이면 수정 불필요. JSON만 반환.`,
};

// 目标语言提示（确保 LLM 输出正确语言）
const TARGET_LANG_HINT = {
  en2zh: '请翻译为中文',
  zh2en: 'Translate to English',
  ja2zh: '中国語に翻訳してください',
  zh2ja: '日本語に翻訳してください',
  ko2zh: '중국어로 번역하세요',
  zh2ko: '한국어로 번역하세요',
  en2ja: '日本語に翻訳してください',
  ja2en: 'Translate to English',
  en2ko: '한국어로 번역하세요',
  ko2en: 'Translate to English',
  ja2ko: '한국어로 번역하세요',
  ko2ja: '日本語に翻訳してください',
};

function buildUserPrompt(sourceText, context, direction, glossary, feedbacks) {
  let prompt = '';

  // 术语表
  if (glossary && glossary.size > 0) {
    prompt += '术语表(请保持一致):\n';
    for (const [src, tgt] of glossary) {
      prompt += `  ${src} → ${tgt}\n`;
    }
    prompt += '\n';
  }

  // 用户反馈
  if (feedbacks && feedbacks.length > 0) {
    prompt += '注意: 用户标记了以下译文不准确,请改进类似翻译:\n';
    for (const fb of feedbacks) {
      prompt += `  [句${fb.id}] "${fb.source}" → "${fb.target}" (不准确)\n`;
    }
    prompt += '\n';
  }

  if (context.length > 0) {
    prompt += '前文:\n';
    for (const c of context) {
      prompt += `  [句${c.id}] 原文: ${c.source}\n`;
      prompt += `  [句${c.id}] 译文: ${c.target}\n`;
    }
    prompt += '\n';
  }
  const hint = TARGET_LANG_HINT[direction] || '';
  prompt += `${hint}\n原文: ${sourceText}`;
  return prompt;
}

// ============ 翻译 / 修正 ============

export class RollingTranslator {
  constructor({ contextSize = 8, direction = 'en2zh' } = {}) {
    this.contextSize = contextSize;
    this.direction = direction;
    this.history = []; // [{ id, source, target }]
    this.glossary = new Map(); // 术语表: source term -> target term
    this.feedbacks = []; // 用户反馈: [{ id, source, target }]
  }

  async translate(id, sourceText, onPartial) {
    const context = this.history.slice(-this.contextSize);
    const result = await translateLLM(sourceText, context, this.direction, this.glossary, this.feedbacks, onPartial);
    this.history.push({ id, source: sourceText, target: result.target });

    // 提取术语对照并更新术语表
    if (Array.isArray(result.terms)) {
      for (const t of result.terms) {
        if (t.src && t.tgt) {
          this.glossary.set(t.src, t.tgt);
        }
      }
      // 术语表上限 30 条，FIFO 淘汰
      while (this.glossary.size > 30) {
        const firstKey = this.glossary.keys().next().value;
        this.glossary.delete(firstKey);
      }
    }

    return result;
  }

  addFeedback(id) {
    const hist = this.history.find(h => h.id === id);
    if (hist) {
      this.feedbacks.push({ id: hist.id, source: hist.source, target: hist.target });
      // 最多保留最近 3 条反馈
      if (this.feedbacks.length > 3) this.feedbacks.shift();
    }
  }
}

async function translateLLM(sourceText, context, direction = 'en2zh', glossary = null, feedbacks = null, onPartial = null) {
  console.log(`[MT] 翻译方向: ${direction}, 原文: "${sourceText.slice(0, 50)}"`);
  const cfg = getLLMConfig();
  if (!cfg.apiKey) {
    console.error('[MT] LLM_API_KEY 未设置');
    return { target: `「${sourceText}」`, corrections: [], terms: [] };
  }

  const url = `${cfg.baseUrl}/chat/completions`;
  const body = {
    model: cfg.model,
    stream: !!onPartial,
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS[direction] || SYSTEM_PROMPTS.en2zh },
      { role: 'user', content: buildUserPrompt(sourceText, context, direction, glossary, feedbacks) },
    ],
    temperature: 0.3,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[MT] API 错误 ${res.status}: ${errText}`);
      return { target: `「${sourceText}」`, corrections: [], terms: [] };
    }

    let content = '';

    if (onPartial && body.stream) {
      // 流式读取 SSE，逐步提取 target 字段
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastPartial = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 行
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留不完整行

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta?.content || '';
            content += delta;
          } catch { continue; }

          // 实时提取 target 值: 匹配 "target": "..." 中已出现的内容
          const targetMatch = content.match(/"target"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/);
          if (targetMatch) {
            // 反转义 JSON 字符串
            let partial;
            try { partial = JSON.parse('"' + targetMatch[1] + '"'); } catch { partial = targetMatch[1]; }
            if (partial && partial !== lastPartial) {
              lastPartial = partial;
              onPartial(partial);
            }
          }
        }
      }
    } else {
      // 非流式
      const data = await res.json();
      content = data.choices?.[0]?.message?.content || '';
    }

    console.log(`[MT] LLM 返回 (${direction}): ${content.slice(0, 200)}`);

    // 提取 JSON(兼容模型返回 ```json ... ``` 包裹的情况)
    const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    console.log(`[MT] 译文: "${parsed.target}"`);
    return {
      target: parsed.target || `「${sourceText}」`,
      corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
      terms: Array.isArray(parsed.terms) ? parsed.terms : [],
    };
  } catch (err) {
    console.error('[MT] 翻译失败:', err.message);
    return { target: `[翻译失败] ${sourceText}`, corrections: [], terms: [] };
  }
}
