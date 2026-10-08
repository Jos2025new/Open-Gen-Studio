import { describe, expect, it } from 'vitest';
import { AGENT_OP_IDS } from '../src/engine/ops';
import { OP_TRIGGERS, detectOps, sequenceNames } from '../src/engine/agent/triggers';

describe('every agent operation has triggers', () => {
  it('no operation of the agent is left without a keyword', () => {
    for (const op of AGENT_OP_IDS) expect(OP_TRIGGERS[op]?.length ?? 0, op).toBeGreaterThan(0);
  });
});

describe('the request names the operations in the order it names them', () => {
  it('the example request: reference sheet first, then the voice', () => {
    const text = 'Quiero una hoja de referencias para este personaje y una voz para ver como se escucha, despues haremos unos videos con ella, pero primero quiero que me muestres como se veria';
    expect(detectOps(text)).toEqual(['reference_sheet', 'create_voice']);
    expect(sequenceNames(detectOps(text))).toEqual(['n1_reference-sheet', 'n2_create-voice']);
  });

  it('follows the request, not the order of the registry', () => {
    expect(detectOps('Muéstrame una voz y después una hoja de personaje')).toEqual(['create_voice', 'reference_sheet']);
  });

  it('reads English the same way', () => {
    expect(detectOps('A character sheet of her, and a voice I can hear')).toEqual(['reference_sheet', 'create_voice']);
  });

  it('ignores accents and case', () => {
    expect(detectOps('ILUMINACIÓN de la escena')).toEqual(['relight']);
  });

  it('counts an operation once, at its first mention', () => {
    expect(detectOps('quiero una voz, otra voz y una voz más')).toEqual(['create_voice']);
  });
});

describe('a longer trigger wins over a shorter one of another operation', () => {
  it('"quita el fondo" is remove_bg, not edit', () => {
    expect(detectOps('quita el fondo de esta imagen')).toEqual(['remove_bg']);
  });

  it('"nueve angulos" is contact_sheet, not angle', () => {
    expect(detectOps('hazme nueve ángulos de esta escena')).toEqual(['contact_sheet']);
  });

  it('"más resolución del video" is video_upscale, not upscale', () => {
    expect(detectOps('más resolución del video')).toEqual(['video_upscale']);
  });

  it('"continúa el clip" is continue, and "extiende el video" is video_extend', () => {
    expect(detectOps('continúa el clip desde el final')).toEqual(['continue']);
    expect(detectOps('extiende el video otros cinco segundos')).toEqual(['video_extend']);
  });
});

describe('requests that name no operation', () => {
  it('a scene that mentions light is not a relight request', () => {
    expect(detectOps('Haz un video de ella sentada en su cama con la luz de la tarde')).toEqual([]);
  });

  it('an explicit change of light is a relight request', () => {
    expect(detectOps('cambia la luz a una tarde cálida')).toEqual(['relight']);
  });

  it('a request with no trigger returns nothing', () => {
    expect(detectOps('Quiero que el cuento tenga un final feliz')).toEqual([]);
  });

  it('"tres vistas" names the angle operation', () => {
    expect(detectOps('Hazme una serie de tres vistas de este personaje')).toEqual(['angle']);
  });
});
