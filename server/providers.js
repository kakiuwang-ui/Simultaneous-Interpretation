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
  ]
}
corrections 为空数组表示无需修正。只返回 JSON,不要其他文字。`,

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
  ]
}
Empty corrections array means no corrections needed. Return JSON only, no other text.`,
};

function buildUserPrompt(sourceText, context) {
  let prompt = '';
  if (context.length > 0) {
    prompt += '前文:\n';
    for (const c of context) {
      prompt += `  [句${c.id}] 原文: ${c.source}\n`;
      prompt += `  [句${c.id}] 译文: ${c.target}\n`;
    }
    prompt += '\n';
  }
  prompt += `请翻译这句新的原文:\n${sourceText}`;
  return prompt;
}

// ============ 翻译 / 修正 ============

export class RollingTranslator {
  constructor({ contextSize = 4, direction = 'en2zh' } = {}) {
    this.contextSize = contextSize;
    this.direction = direction;
    this.history = []; // [{ id, source, target }]
  }

  async translate(id, sourceText) {
    const context = this.history.slice(-this.contextSize);
    const result = await translateLLM(sourceText, context, this.direction);
    this.history.push({ id, source: sourceText, target: result.target });
    return result;
  }
}

async function translateLLM(sourceText, context, direction = 'en2zh') {
  const cfg = getLLMConfig();
  if (!cfg.apiKey) {
    console.error('[MT] LLM_API_KEY 未设置');
    return { target: `「${sourceText}」`, corrections: [] };
  }

  const url = `${cfg.baseUrl}/chat/completions`;
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS[direction] || SYSTEM_PROMPTS.en2zh },
      { role: 'user', content: buildUserPrompt(sourceText, context) },
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
      return { target: `「${sourceText}」`, corrections: [] };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';

    // 提取 JSON(兼容模型返回 ```json ... ``` 包裹的情况)
    const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      target: parsed.target || `「${sourceText}」`,
      corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
    };
  } catch (err) {
    console.error('[MT] 翻译失败:', err.message);
    return { target: `「${sourceText}」`, corrections: [] };
  }
}
