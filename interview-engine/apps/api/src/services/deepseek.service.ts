type DeepSeekMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type DeepSeekJsonParams = {
  prompt: string;
  systemInstruction: string;
  model?: string;
  task?: string;
  maxOutputTokens?: number;
  temperature?: number;
};

// Mixture-of-experts routing: a task can run on its own model via env
// (DEEPSEEK_MODEL_<TASK>), falling back to the default. Assign a stronger/cheaper
// expert per task in render.yaml with zero code change. ponytail: a model that
// lacks JSON mode (most reasoning models) breaks json:true calls — only point a
// JSON task at a JSON-capable model.
function modelForTask(task?: string): string | undefined {
  if (!task) return undefined;
  return process.env[`DEEPSEEK_MODEL_${task.toUpperCase()}`] || undefined;
}

function getDeepSeekConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey || apiKey === 'replace-me') {
    throw new Error('DeepSeek is not configured. Set DEEPSEEK_API_KEY to enable LLM calls.');
  }

  return {
    apiKey,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions',
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
      throw new Error(`DeepSeek returned non-JSON output: ${text.slice(0, 300)}`);
    }

    return JSON.parse(jsonText);
  }
}

export async function callDeepSeek(messages: DeepSeekMessage[], options?: {
  model?: string;
  task?: string;
  maxOutputTokens?: number;
  temperature?: number;
  json?: boolean;
}): Promise<string> {
  const config = getDeepSeekConfig();
  const res = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options?.model || modelForTask(options?.task) || config.model,
      messages,
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxOutputTokens ?? 4096,
      response_format: options?.json ? { type: 'json_object' } : undefined,
    }),
  });

  if (!res.ok) {
    throw new Error(`DeepSeek failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function callDeepSeekJson<T>(params: DeepSeekJsonParams): Promise<T> {
  const text = await callDeepSeek(
    [
      { role: 'system', content: params.systemInstruction },
      { role: 'user', content: params.prompt },
    ],
    {
      model: params.model,
      task: params.task,
      maxOutputTokens: params.maxOutputTokens,
      temperature: params.temperature,
      json: true,
    },
  );

  if (!text) {
    throw new Error('DeepSeek returned an empty response.');
  }

  return extractJson(text) as T;
}
