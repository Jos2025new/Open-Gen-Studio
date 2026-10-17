import { describe, expect, it } from 'vitest';
import { PEOPLE_RULE } from '../src/engine/procedure';
import { workflowById } from '../src/engine/skills/workflows';
import { readFileSync } from 'node:fs';

describe('people in prompts: age and body', () => {
  it('follows a stated age or range and keeps it in the prompt', () => {
    expect(PEOPLE_RULE).toMatch(/age or range the user gives is followed exactly and kept in the prompt/);
  });
  it('picks by target with ranges and varies, never a fixed number', () => {
    expect(PEOPLE_RULE).toMatch(/social media[\s\S]*18-22 \(24 at most\)/);
    expect(PEOPLE_RULE).toMatch(/business[\s\S]*24-28/);
    expect(PEOPLE_RULE).toMatch(/parents, family 22-32/);
    expect(PEOPLE_RULE).toMatch(/above 28 only/);
    expect(PEOPLE_RULE).toMatch(/vary inside the range, never a fixed number/);
  });
  it('has no lone "early twenties" example, only varied numeric ones', () => {
    expect(PEOPLE_RULE).toMatch(/19-year-old woman/);
    expect(PEOPLE_RULE).toMatch(/18-year-old guy/);
    expect(PEOPLE_RULE).toMatch(/26-year-old businesswoman/);
    expect(PEOPLE_RULE).not.toMatch(/a woman in her early twenties/);
    expect(PEOPLE_RULE).toMatch(/never "early twenties" by habit/);
  });
  it('never softens the requested body and matches it to the age', () => {
    expect(PEOPLE_RULE).toMatch(/never soften, average or normalize it/);
    expect(PEOPLE_RULE).toMatch(/young-adult build at 18-22/);
    expect(PEOPLE_RULE).toMatch(/curvy, athletic, muscular, slim, plus-size/);
    expect(PEOPLE_RULE).toMatch(/No sexualization beyond what the user asks/);
  });
  it('keeps the adult-only and minor-protection lines', () => {
    expect(PEOPLE_RULE).toMatch(/adult \(18\+\)/);
    expect(PEOPLE_RULE).toMatch(/adults only/);
    expect(PEOPLE_RULE).toMatch(/never sexualize anything that reads as a minor/);
    expect(PEOPLE_RULE).toMatch(/explicit age of 18 or more/);
    expect(PEOPLE_RULE).toMatch(/school uniforms, teen or childlike wording out of sensual scenes/);
    expect(PEOPLE_RULE).toMatch(/Students of 18-19/);
  });
  it('is wired into the agent context', () => {
    expect(readFileSync('src/engine/agent/context.ts', 'utf8')).toContain('${PEOPLE_RULE}');
  });
  it('the UGC brief uses target ranges', () => {
    const w = workflowById('ugc');
    const text = JSON.stringify(w);
    expect(text).toMatch(/18–22/);
    expect(text).toMatch(/22–32/);
    expect(text).toMatch(/never a fixed number/);
  });
});
