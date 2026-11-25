import { describe, expect, it } from 'vitest';
import { tokensIn, validateTokens } from '../src/engine/libraryTokens';
import { colorHex, colorObject, colorText } from '../src/engine/libraryTokensColor';
import { tokensFromFile, tokensToFile, withMode } from '../src/engine/libraryTokensFile';
import type { KitTokens } from '../src/engine/libraryTypes';

const file = (v: unknown) => tokensFromFile(JSON.stringify(v));
const out = (t: KitTokens, f: 'w3c' | 'penpot' = 'w3c', name?: string) => { const { text, left } = tokensToFile(t, f, name); return { json: JSON.parse(text) as Record<string, any>, left }; };
const TOKENS: KitTokens = {
  'color.sea': { type: 'color', value: '#0a4d68', description: 'Deep' }, 'color.veil': { type: 'color', value: '#0a4d6880' }, 'color.main': { type: 'color', value: '{color.sea}' },
  'space.m': { type: 'dimension', value: '16px' }, 'space.l': { type: 'dimension', value: '1.5rem' }, 'font.title': { type: 'fontFamily', value: 'Inter' }, 'font.body': { type: 'fontFamily', value: 'Inter, Arial' }, weight: { type: 'number', value: 700 }, note: { type: 'string', value: 'Hi' },
};

describe('W3C token files', () => {
  it('are written as the 2025.10 format says', () => {
    const { json, left } = out(TOKENS);
    expect(left).toEqual([]);
    expect(json.color.sea).toEqual({ $type: 'color', $value: { colorSpace: 'srgb', components: [0.0392, 0.302, 0.4078], alpha: 1, hex: '#0a4d68' }, $description: 'Deep' });
    expect(json.color.main).toEqual({ $type: 'color', $value: '{color.sea}' });
    expect(json.space).toEqual({ m: { $type: 'dimension', $value: { value: 16, unit: 'px' } }, l: { $type: 'dimension', $value: { value: 1.5, unit: 'rem' } } });
    expect(json.font).toEqual({ title: { $type: 'fontFamily', $value: 'Inter' }, body: { $type: 'fontFamily', $value: ['Inter', 'Arial'] } });
    expect(json.weight).toEqual({ $type: 'number', $value: 700 });
  });

  it('come back the same, from both formats', () => {
    expect(tokensFromFile(tokensToFile(TOKENS).text)).toEqual({ tokens: TOKENS, skipped: [], off: [] });
    const { note: _n, ...rest } = TOKENS;
    const penpot = tokensToFile(TOKENS, 'penpot', 'Marea');
    expect(penpot.left).toEqual(['note']);
    expect(tokensFromFile(penpot.text)).toEqual({ tokens: rest, skipped: [], off: [] });
  });

  it('a token that is also a group is $root, and its alias says so', () => {
    const t: KitTokens = { accent: { type: 'color', value: '#dd0000' }, 'accent.dark': { type: 'color', value: '#aa0000' }, link: { type: 'color', value: '{accent}' } };
    const { json } = out(t);
    expect(json.accent.$root.$value.hex).toBe('#dd0000');
    expect(json.link.$value).toBe('{accent.$root}');
    expect(tokensFromFile(tokensToFile(t).text).tokens).toEqual(t);
    const pen = out(t, 'penpot', 'K').json.K;
    expect(pen.accent).toEqual({ root: { $type: 'color', $value: '#dd0000' }, dark: { $type: 'color', $value: '#aa0000' } });
    expect(pen.link.$value).toBe('{accent.root}');
  });

  it('says what the format cannot hold, with what points to it', () => {
    const t: KitTokens = { w: { type: 'dimension', value: '50%' }, w2: { type: 'dimension', value: '{w}' }, red: { type: 'color', value: 'tomato' }, lab: { type: 'color', value: 'oklch(0.7 0.1 200 / 0.5)' } };
    expect(out(t).left).toEqual(['w', 'w2', 'red']);
    expect(out(t).json).toEqual({ lab: { $type: 'color', $value: { colorSpace: 'oklch', components: [0.7, 0.1, 200], alpha: 0.5 } } });
    expect(out(t, 'penpot').left).toEqual(['w', 'w2', 'red', 'lab']);
  });

  it('names cannot reach outside the file', () => {
    out({ '__proto__.polluted': { type: 'number', value: 1 } });
    tokensFromFile('{"__proto__":{"a":{"$type":"number","$value":1}},"b":{"$type":"number","$value":1}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('reads what the standard allows', () => {
    const { tokens, skipped } = file({
      color: { $type: 'color', accent: { $root: { $value: { colorSpace: 'srgb', components: [0.867, 0, 0] } }, soft: { $value: { colorSpace: 'hsl', components: [0, 100, 50], alpha: 0.5 } }, lch: { $value: { colorSpace: 'oklch', components: [0.7, 0.1, 'none'] } } } },
      link: { $value: '{color.accent.$root}' }, jump: { $value: { $ref: '#/space/m/$value' } },
      space: { m: { $type: 'dimension', $value: { value: 0.5, unit: 'rem' } } },
      bold: { $type: 'fontWeight', $value: 'extra-bold' }, font: { $type: 'fontFamily', $value: ['Inter', 'sans-serif'] },
      base: { pad: { $type: 'dimension', $value: { value: 4, unit: 'px' } }, gap: { $type: 'dimension', $value: { value: 2, unit: 'px' } } }, card: { $extends: '{base}', gap: { $type: 'dimension', $value: { value: 8, unit: 'px' } } },
      title: { $type: 'typography', $value: { fontFamily: '{font}', fontSize: { value: 32, unit: 'px' }, fontWeight: 700, letterSpacing: { value: 0, unit: 'px' }, lineHeight: 1.2 } },
      ring: { $type: 'border', $value: { color: '{link}', width: { value: 1, unit: 'px' }, style: 'solid' } }, time: { $type: 'duration', $value: { value: 200, unit: 'ms' } },
    });
    validateTokens(tokens);
    expect(Object.fromEntries(Object.entries(tokens).map(([k, t]) => [k, t.value]))).toEqual({
      'color.accent': '#dd0000', 'color.accent.soft': '#ff000080', 'color.accent.lch': 'oklch(0.7 0.1 0)', link: '{color.accent}', jump: '{space.m}', 'space.m': '0.5rem', bold: 800, font: 'Inter, sans-serif',
      'base.pad': '4px', 'base.gap': '2px', 'card.pad': '4px', 'card.gap': '8px', 'title.fontFamily': '{font}', 'title.fontSize': '32px', 'title.fontWeight': 700, 'title.letterSpacing': '0px', 'title.lineHeight': 1.2, 'ring.color': '{link}', 'ring.width': '1px',
    });
    expect([tokens.link.type, tokens.jump.type]).toEqual(['color', 'dimension']);
    expect(skipped).toEqual(['ring.style', 'time']);
  });

  it('a group that extends itself or its parent ends', () => {
    expect(file({ a: { $extends: '{a}', x: { $type: 'number', $value: 1 }, b: { $extends: '{a}' }, c: { $extends: '{a}' } } }).tokens.a).toBeUndefined();
  });
});

describe('other tools', () => {
  it('reads the example of Figma', () => {
    const { tokens, skipped } = file({
      red: { $type: 'color', $value: { colorSpace: 'srgb', components: [0.8886906504631042, 0.15790081024169922, 0.15790081024169922], alpha: 1, hex: '#E32828' } }, danger: { $type: 'color', $value: '{red}' },
      'border-radius-default': { $type: 'number', $value: 5 }, 'button-text': { $type: 'string', $value: 'Click here' }, visibility: { $type: 'number', $value: 0, $extensions: { 'com.figma.type': 'boolean' } },
      'padding-default': { $type: 'dimension', $value: { value: 16, unit: 'px' } }, 'heading-font': { $type: 'fontFamily', $value: 'Inter' }, 'transition-duration': { $type: 'duration', $value: { value: 0.3, unit: 's' } },
    });
    expect(tokens).toEqual({ red: { type: 'color', value: '#e32828' }, danger: { type: 'color', value: '{red}' }, 'border-radius-default': { type: 'number', value: 5 }, 'button-text': { type: 'string', value: 'Click here' }, visibility: { type: 'number', value: 0 }, 'padding-default': { type: 'dimension', value: '16px' }, 'heading-font': { type: 'fontFamily', value: 'Inter' } });
    expect(skipped).toEqual(['transition-duration']);
  });

  const sets = { Global: { brand: { $type: 'color', 'deep sea': { $value: '#0A4D68' } }, radius: { $type: 'borderRadius', $value: '8' }, body: { $type: 'fontFamilies', $value: ['Inter', 'Arial'] }, weight: { $type: 'fontWeights', $value: 'Semi Bold' }, pad: { $type: 'spacing', $value: '{radius}*2' }, title: { $type: 'typography', $value: { fontSize: '12', textCase: 'uppercase' } } },
    Light: { accent: { $type: 'color', $value: '{brand.deep sea}' } }, Dark: { accent: { $type: 'color', $value: '#000000' } } };
  it('reads the sets in use of Penpot and Tokens Studio, and names the others', () => {
    const { tokens, skipped, off } = file({ ...sets, $themes: [], $metadata: { tokenSetOrder: ['Global', 'Light', 'Dark'], activeThemes: [], activeSets: ['Global', 'Light'] } });
    expect(tokens).toEqual({ 'brand.deep-sea': { type: 'color', value: '#0A4D68' }, radius: { type: 'dimension', value: '8' }, body: { type: 'fontFamily', value: 'Inter, Arial' }, weight: { type: 'number', value: 600 }, 'title.fontSize': { type: 'dimension', value: '12' }, accent: { type: 'color', value: '{brand.deep-sea}' } });
    expect(skipped.sort()).toEqual(['pad', 'title.textCase']);
    expect(off).toEqual(['Dark']);
  });

  it('follows the active theme, or the first one of each group', () => {
    const theme = (name: string, set: string) => ({ id: name, name, group: 'Mode', selectedTokenSets: { Global: 'source', [set]: 'enabled' } });
    const $themes = [theme('Light', 'Light'), theme('Dark', 'Dark')], $metadata = { tokenSetOrder: ['Global', 'Light', 'Dark'] };
    expect(file({ ...sets, $themes, $metadata }).tokens.accent).toEqual({ type: 'color', value: '{brand.deep-sea}', modes: { Dark: '#000000' } });
    expect(file({ ...sets, $themes, $metadata }).off).toEqual([]);
    expect(file({ ...sets, $themes, $metadata: { ...$metadata, activeThemes: ['Mode/Dark'] } }).tokens.accent).toEqual({ type: 'color', value: '#000000', modes: { Light: '{brand.deep-sea}' } });
  });

  it('writes one Penpot set with its name, in use', () => {
    const { json } = out(TOKENS, 'penpot', 'Marea / 2.0');
    expect(json.$metadata).toEqual({ tokenSetOrder: ['Marea - 2-0'], activeThemes: [], activeSets: ['Marea - 2-0'] });
    const set = json['Marea - 2-0'];
    expect([set.color.veil, set.space.m, set.font.body, set.weight]).toEqual([{ $type: 'color', $value: '#0a4d6880' }, { $type: 'dimension', $value: '16px' }, { $type: 'fontFamilies', $value: 'Inter, Arial' }, { $type: 'number', $value: '700' }]);
  });

  it('modes go out to Penpot as themes and come back', () => {
    const t: KitTokens = { bg: { type: 'color', value: '#ffffff', modes: { Dark: '#101010' } }, ink: { type: 'color', value: '#101010', modes: { Dark: '#ffffff' } }, pad: { type: 'dimension', value: '8px' }, main: { type: 'color', value: '{ink}', modes: { Dark: '{bg}' } } };
    validateTokens(t);
    const { json } = out(t, 'penpot', 'Marea');
    expect(json.$metadata).toEqual({ tokenSetOrder: ['Marea/Default', 'Marea/Dark'], activeThemes: ['Marea/Default'], activeSets: ['Marea/Default'] });
    expect(Object.keys(json['Marea/Dark'])).toEqual(['bg', 'ink', 'main']);
    expect(tokensFromFile(tokensToFile(t, 'penpot', 'Marea').text)).toEqual({ tokens: t, skipped: [], off: [] });
    expect(() => validateTokens({ a: { type: 'color', value: '#ffffff', modes: { Dark: '{none}' } } })).toThrow('missing alias');
    expect(withMode(tokensFromFile(tokensToFile(tokensIn(t)).text).tokens, 'Dark', tokensFromFile(tokensToFile(tokensIn(t, 'Dark')).text).tokens)).toEqual(t);
  });

  it('says when it is not a token file', () => {
    expect(() => tokensFromFile('nope')).toThrow('not valid JSON');
    expect(() => tokensFromFile('{"a":1}')).toThrow('no design tokens');
  });
});

describe('colors', () => {
  it('keep their value through the object', () => {
    for (const c of ['#0a4d68', '#0a4d6880', 'oklch(0.7 0.1 200)', 'color(display-p3 1 0.2 0 / 0.5)', 'lab(50 10 -20)']) expect(colorText(colorObject(c)! as never)).toBe(c);
    expect([colorHex('#abc'), colorHex('rgba(255, 0, 0, .5)'), colorHex('hsl(120deg 100% 50%)'), colorHex('color(srgb 1 0 0)'), colorHex('transparent'), colorHex('oklch(0.7 0.1 200)')]).toEqual(['#aabbcc', '#ff000080', '#00ff00', '#ff0000', '#00000000', undefined]);
    expect(colorObject('tomato')).toBeUndefined();
    expect(colorObject('oklch(70% 0.1 200)')!.components[0]).toBeCloseTo(0.7);
  });

  it('Penpot: a value only one mode has and the format cannot write is named', () => {
    const r = tokensToFile({ ok: { type: 'color', value: '#112233' }, pad: { type: 'dimension', value: '4px', modes: { Dark: 'calc(1px + 2px)' } } } as never, 'penpot', 'S');
    expect(r.left).toEqual(['pad (Dark)']);
  });
});
