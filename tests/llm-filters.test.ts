import { describe, expect, it } from 'vitest';
import { contextLabel, filterLlm, llmMaker, llmMakers, type LlmModel } from '../src/engine/providers/llm';

const m = (id: string, x: Partial<LlmModel>): LlmModel => ({ id, name: id, tools: true, ...x });
const models = [
  m('z-ai/glm-5.3-uncensored', { vision: false, reasoning: true, contextLength: 200_000, inputPrice: 0.4, outputPrice: 1.6, description: 'Uncensored fine-tune' }),
  m('z-ai/glm-5.3-flash-uncensored', { vision: true, reasoning: true, contextLength: 128_000, inputPrice: 0.1, outputPrice: 0.4 }),
  m('xiaomi/mimo-v2.6-flash', { vision: true, videoInput: true, contextLength: 1_000_000 }),
  m('no-tools', { tools: false, vision: true }),
];

describe('agent model filters', () => {
  it('keeps tool-less models (listed last); checked capabilities must be confirmed; words search the description too', () => {
    expect(filterLlm(models).map((x) => x.id)).toEqual(['z-ai/glm-5.3-uncensored', 'z-ai/glm-5.3-flash-uncensored', 'xiaomi/mimo-v2.6-flash', 'no-tools']);
    expect(filterLlm(models, { sort: 'name' }).at(-1)?.id).toBe('no-tools');
    expect(filterLlm(models, { caps: ['vision', 'reasoning'] }).map((x) => x.id)).toEqual(['z-ai/glm-5.3-flash-uncensored']);
    expect(filterLlm(models, { caps: ['videoInput'] }).map((x) => x.id)).toEqual(['xiaomi/mimo-v2.6-flash']);
    expect(filterLlm(models, { q: 'uncensored fine-tune' }).map((x) => x.id)).toEqual(['z-ai/glm-5.3-uncensored']);
  });
  it('orders by price (unpriced last), context (largest first) or name', () => {
    expect(filterLlm(models, { sort: 'price' }).map((x) => x.id)).toEqual(['z-ai/glm-5.3-flash-uncensored', 'z-ai/glm-5.3-uncensored', 'xiaomi/mimo-v2.6-flash', 'no-tools']);
    expect(filterLlm(models, { sort: 'context' })[0].id).toBe('xiaomi/mimo-v2.6-flash');
    expect(filterLlm(models, { sort: 'name' })[0].id).toBe('xiaomi/mimo-v2.6-flash');
    expect([contextLabel(1_000_000), contextLabel(128_000), contextLabel(1_048_576)]).toEqual(['1M', '128K', '1M']);
  });
});

describe('agent model makers', () => {
  it('recognises makers from the id prefix and the name; routers and unknowns are Other', () => {
    const cases: Array<[string, string, string]> = [
      ['anthropic/claude-opus', 'Claude Opus', 'Anthropic'], ['openai/gpt-5', 'GPT-5', 'OpenAI'], ['openai/o3-mini', 'o3 mini', 'OpenAI'],
      ['google/gemma-3', 'Gemma 3', 'Google'], ['meta-llama/llama-4', 'Llama 4', 'Meta'], ['mistralai/mixtral', 'Mixtral', 'Mistral'],
      ['deepseek/deepseek-v3', 'DeepSeek V3', 'DeepSeek'], ['qwen/qwen3', 'Qwen3', 'Qwen'], ['z-ai/glm-5.3', 'GLM 5.3', 'Z.ai (GLM)'],
      ['moonshotai/kimi-k2', 'Kimi K2', 'Moonshot (Kimi)'], ['minimax/minimax-m2', 'MiniMax M2', 'MiniMax'], ['x-ai/grok-4', 'Grok 4', 'xAI'],
      ['cohere/command-r', 'Command R', 'Cohere'], ['glm-5.3-uncensored', 'GLM 5.3', 'Z.ai (GLM)'], ['openrouter/auto', 'Auto Router', 'Other'],
      ['nanogpt/auto', 'Auto', 'Other'], ['acme-labs/zeta-1', 'Zeta', 'Acme-labs'], ['mystery', 'Mystery', 'Other'],
    ];
    for (const [id, name, maker] of cases) expect(llmMaker(id, name), id).toBe(maker);
  });
  it('filters by maker before grouping and counts makers', () => {
    const list = [m('anthropic/claude-a', {}), m('anthropic/claude-b', {}), m('openai/gpt-5', {}), m('openrouter/auto', { name: 'Auto' })];
    expect(llmMakers(list)).toEqual([['Anthropic', 2], ['OpenAI', 1], ['Other', 1]]);
    expect(filterLlm(list, { maker: 'Anthropic' }).map((x) => x.id)).toEqual(['anthropic/claude-a', 'anthropic/claude-b']);
    expect(filterLlm(list, { maker: 'OpenAI', q: 'claude' })).toEqual([]);
  });
});
