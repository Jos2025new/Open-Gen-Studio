import { describe, expect, it } from 'vitest';
import { contextLabel, filterLlm, type LlmModel } from '../src/engine/providers/llm';

const m = (id: string, x: Partial<LlmModel>): LlmModel => ({ id, name: id, tools: true, ...x });
const models = [
  m('z-ai/glm-5.3-uncensored', { vision: false, reasoning: true, contextLength: 200_000, inputPrice: 0.4, outputPrice: 1.6, description: 'Uncensored fine-tune' }),
  m('z-ai/glm-5.3-flash-uncensored', { vision: true, reasoning: true, contextLength: 128_000, inputPrice: 0.1, outputPrice: 0.4 }),
  m('xiaomi/mimo-v2.6-flash', { vision: true, videoInput: true, contextLength: 1_000_000 }),
  m('no-tools', { tools: false, vision: true }),
];

describe('agent model filters', () => {
  it('tool calling always; checked capabilities must be confirmed; words search the description too', () => {
    expect(filterLlm(models).map((x) => x.id)).toEqual(['z-ai/glm-5.3-uncensored', 'z-ai/glm-5.3-flash-uncensored', 'xiaomi/mimo-v2.6-flash']);
    expect(filterLlm(models, { caps: ['vision', 'reasoning'] }).map((x) => x.id)).toEqual(['z-ai/glm-5.3-flash-uncensored']);
    expect(filterLlm(models, { caps: ['videoInput'] }).map((x) => x.id)).toEqual(['xiaomi/mimo-v2.6-flash']);
    expect(filterLlm(models, { q: 'uncensored fine-tune' }).map((x) => x.id)).toEqual(['z-ai/glm-5.3-uncensored']);
  });
  it('orders by price (unpriced last), context (largest first) or name', () => {
    expect(filterLlm(models, { sort: 'price' }).map((x) => x.id)).toEqual(['z-ai/glm-5.3-flash-uncensored', 'z-ai/glm-5.3-uncensored', 'xiaomi/mimo-v2.6-flash']);
    expect(filterLlm(models, { sort: 'context' })[0].id).toBe('xiaomi/mimo-v2.6-flash');
    expect(filterLlm(models, { sort: 'name' })[0].id).toBe('xiaomi/mimo-v2.6-flash');
    expect([contextLabel(1_000_000), contextLabel(128_000), contextLabel(1_048_576)]).toEqual(['1M', '128K', '1M']);
  });
});
