// OpenAI judge client for interview evaluation. OpenAI-compatible chat-completions
// (Bearer + response_format json_object), so it mirrors deepseek.service. Used by
// the aviral evaluator when OPENAI_API_KEY is set; otherwise the evaluator falls
// back to the existing DeepSeek/OpenRouter client. Model defaults to gpt-4o.

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string };

type OpenAIJsonParams = {
  prompt: string;
  systemInstruction: string;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
};

export function isOpenAIConfigured(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key.trim() && key !== 'replace-me');
}

function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('OpenAI is not configured. Set OPENAI_API_KEY to enable OpenAI evaluation.');
  }
  return {
    apiKey: apiKey.trim(),
    model: process.env.OPENAI_EVAL_MODEL || 'gpt-4o',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
  };
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const objectMatch = text.match(/\{[\s\S]*\}/);
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    const jsonText = objectMatch?.[0] ?? arrayMatch?.[0];
    if (!jsonText) {
      throw new Error(`OpenAI returned non-JSON output: ${text.slice(0, 300)}`);
    }
    return JSON.parse(jsonText);
  }
}

export async function callOpenAI(messages: OpenAIMessage[], options?: {
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  json?: boolean;
}): Promise<string> {
  const config = getOpenAIConfig();
  const res = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options?.model || config.model,
      messages,
      temperature: options?.temperature ?? 0,
      max_tokens: options?.maxOutputTokens ?? 4096,
      response_format: options?.json ? { type: 'json_object' } : undefined,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function callOpenAIJson<T>(params: OpenAIJsonParams): Promise<T> {
  const text = await callOpenAI(
    [
      { role: 'system', content: params.systemInstruction },
      { role: 'user', content: params.prompt },
    ],
    {
      model: params.model,
      maxOutputTokens: params.maxOutputTokens,
      temperature: params.temperature,
      json: true,
    },
  );

  if (!text) {
    throw new Error('OpenAI returned an empty response.');
  }

  return extractJson(text) as T;
}
