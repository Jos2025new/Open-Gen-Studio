import { describe, expect, it } from 'vitest';
import { DEFAULT_PEOPLE_LOOK, LOOK_RULE, peopleLook, peopleLookLine } from '../src/engine/peopleLook';
import { SYSTEM_PROMPT } from '../src/engine/agent/context';
import { readGuide } from '../src/engine/skills/guides';

describe('aspecto de las personas no descritas', () => {
  it('por defecto occidental; asiático solo si el usuario lo pide', () => {
    expect(DEFAULT_PEOPLE_LOOK).toMatch(/Western/);
    expect(DEFAULT_PEOPLE_LOOK).toMatch(/East Asian only when the user asks/);
    expect(peopleLook({})).toBe(DEFAULT_PEOPLE_LOOK);
    expect(peopleLook({ peopleLook: '   ' })).toBe(DEFAULT_PEOPLE_LOOK);
  });
  it('el ajuste del usuario sustituye al defecto en la línea de contexto', () => {
    expect(peopleLookLine({ peopleLook: 'Mediterranean' })).toBe('default look for people the user does not describe: Mediterranean');
  });
  it('la regla obliga a fijar el aspecto y deja mandar a la referencia', () => {
    expect(LOOK_RULE).toMatch(/never leave it unstated/);
    expect(LOOK_RULE).toContain('"default look for people"');
    expect(LOOK_RULE).toMatch(/reference or start image .* sets their look/);
  });
  it('la regla está en el prompt del sistema', () => {
    expect(SYSTEM_PROMPT).toContain(LOOK_RULE);
  });
  it('las guías de modelos chinos avisan del sesgo', () => {
    for (const id of ['seedream', 'z-image', 'wan', 'seedance', 'kling', 'minimax', 'qwen-image', 'happyhorse']) {
      expect(readGuide(`model:${id}`), id).toMatch(/comes out East Asian[^\n]*default look for people/);
    }
  });
});
