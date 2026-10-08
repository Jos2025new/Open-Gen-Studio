import { describe, expect, it } from 'vitest';
import { normalizePlan, type PlanContext } from '../src/engine/plan';

/*
 * The fit wired into the plan normalizer. A missing or invalid operation parameter takes the value the request names or
 * the source image implies; a valid value the agent gave is kept. A failure is either an impossibility (refused in every
 * mode) or an ambiguity (Auto and Guided ask; Direct takes the operation's visible fallback). Stubbed context.
 */
const assets: Record<string, { kind: 'image'; width?: number; height?: number }> = {
  img1: { kind: 'image', width: 1024, height: 1024 },
  img2: { kind: 'image', width: 1080, height: 1920 },
  img3: { kind: 'image' },
};

function ctxWith(requestText: string, usedAngles: string[] = [], direct = false, ask: { canAsk?: boolean; answered?: boolean } = {}): PlanContext {
  return {
    workspace: 'chat',
    getModel: async () => null,
    defaultModel: () => null,
    defaultSettings: () => ({}),
    asset: (id: string) => assets[id],
    layer: () => undefined,
    requestText: () => requestText,
    usedAngles: () => usedAngles,
    direct: () => direct,
    canAsk: () => ask.canAsk ?? true,
    answered: () => ask.answered ?? false,
  } as unknown as PlanContext;
}

async function oneOp(op: string, input: string, params: Record<string, unknown> | undefined, requestText: string, opts: { usedAngles?: string[]; direct?: boolean; canAsk?: boolean; answered?: boolean } = {}) {
  const raw = { title: 'Test', steps: [{ id: 's1', kind: 'op', op, input, ...(params ? { params } : {}) }] } as unknown as Parameters<typeof normalizePlan>[0];
  return normalizePlan(raw, ctxWith(requestText, opts.usedAngles ?? [], opts.direct ?? false, opts), 'pln_test');
}

const paramsOf = (plan: { steps: unknown[] } | null) => (plan!.steps[0] as { params: Record<string, string> }).params;

describe('angle: the request names the value, or a new angle is taken', () => {
  it('"un ángulo diferente" with no value takes an angle not made yet', async () => {
    const { plan, errors } = await oneOp('angle', 'asset:img1', undefined, 'quiero un ángulo diferente', { usedAngles: ['three-quarter-left'] });
    expect(errors).toEqual([]);
    expect(paramsOf(plan).angle).toBe('profile-left');
  });

  it('a valid angle the agent gave is kept, whatever the request says', async () => {
    const { plan } = await oneOp('angle', 'asset:img1', { angle: 'back' }, 'quiero un ángulo diferente', { usedAngles: ['three-quarter-left'] });
    expect(paramsOf(plan).angle).toBe('back');
  });

  it('the fill is shown as an adjustment, so it is traceable', async () => {
    const { plan } = await oneOp('angle', 'asset:img1', undefined, 'desde arriba');
    expect(plan!.adjustments.join(' ')).toContain('angle "high" from the request');
  });
});

describe('upscale: 4K from the source size', () => {
  it('a 4K request on a 1024 px image is ×4', async () => {
    const { plan, errors } = await oneOp('upscale', 'asset:img1', undefined, 'pásala a 4K');
    expect(errors).toEqual([]);
    expect(paramsOf(plan).factor).toBe('4');
  });

  it('with the source size unknown, Auto asks and Direct uses the default ×2, shown on the plan', async () => {
    const auto = await oneOp('upscale', 'asset:img3', undefined, 'pásala a 4K');
    expect(auto.errors.join(' ')).toContain('Ask the user');
    const direct = await oneOp('upscale', 'asset:img3', undefined, 'pásala a 4K', { direct: true });
    expect(direct.errors).toEqual([]);
    expect(paramsOf(direct.plan).factor).toBe('2');
    expect(direct.plan!.adjustments.join(' ')).toContain('Direct does not ask');
  });
});

describe('reframe: a format is named, Instagram asks in Auto and uses the social default in Direct', () => {
  it('Instagram without feed or stories: Auto asks', async () => {
    const { errors } = await oneOp('reframe', 'asset:img2', undefined, 'cambia la imagen en formato para instagram');
    expect(errors.join(' ')).toContain('Ask the user');
  });

  it('Instagram without feed or stories: Direct uses the social default 9:16, shown on the plan', async () => {
    const { plan, errors } = await oneOp('reframe', 'asset:img2', undefined, 'cambia la imagen en formato para instagram', { direct: true });
    expect(errors).toEqual([]);
    expect(paramsOf(plan).aspect).toBe('9:16');
    expect(plan!.adjustments.join(' ')).toContain('Direct does not ask');
  });

  it('an ambiguous request is asked in Auto even when the agent filled a format: the agent guessed for the user', async () => {
    const { errors } = await oneOp('reframe', 'asset:img2', { aspect: '4:5' }, 'cambia la imagen en formato para instagram');
    expect(errors.join(' ')).toContain('Ask the user');
  });

  it('asked once: after an answer, or with no question left, the agent\'s format stands and is shown on the plan', async () => {
    for (const opts of [{ answered: true }, { canAsk: false }]) {
      const { plan, errors } = await oneOp('reframe', 'asset:img2', { aspect: '4:5' }, 'cambia la imagen en formato para instagram', opts);
      expect(errors).toEqual([]);
      expect(paramsOf(plan).aspect).toBe('4:5');
      expect(plan!.adjustments.join(' ')).toContain('aspect "4:5"');
    }
  });

  it('Direct keeps the agent\'s format for an ambiguous request and says so on the plan', async () => {
    const { plan, errors } = await oneOp('reframe', 'asset:img2', { aspect: '4:5' }, 'cambia la imagen en formato para instagram', { direct: true });
    expect(errors).toEqual([]);
    expect(plan!.adjustments.join(' ')).toContain('Direct does not ask');
  });

  it('"otro aspecto" takes a format other than the source\'s', async () => {
    const { plan } = await oneOp('reframe', 'asset:img2', undefined, 'quiero otro aspecto');
    expect(paramsOf(plan).aspect).toBe('4:5');
  });
});

describe('reference sheet: a sheet of a character, a person or an object; never a place; one image per view is not a sheet', () => {
  it('a place is refused in every mode', async () => {
    expect((await oneOp('reference_sheet', 'asset:img1', { subject: 'location' }, 'hoja de la ciudad')).errors.join(' ')).toContain('a place is not a reference sheet subject');
    expect((await oneOp('reference_sheet', 'asset:img1', undefined, 'hoja de la ciudad', { direct: true })).errors.join(' ')).toContain('does not fit');
  });

  it('a named sheet of a character fills the subject and the view count, with no question', async () => {
    const { plan, errors } = await oneOp('reference_sheet', 'asset:img1', undefined, 'hoja de este personaje con cuatro vistas');
    expect(errors).toEqual([]);
    expect(paramsOf(plan)).toMatchObject({ subject: 'character', panels: '4' });
  });

  it('"tres vistas" alone: Auto asks sheet or one image per view; Direct makes the sheet', async () => {
    const auto = await oneOp('reference_sheet', 'asset:img1', undefined, 'tres vistas de este personaje');
    expect(auto.errors.join(' ')).toContain('Ask the user');
    const direct = await oneOp('reference_sheet', 'asset:img1', undefined, 'tres vistas de este personaje', { direct: true });
    expect(direct.errors).toEqual([]);
    expect(paramsOf(direct.plan)).toMatchObject({ subject: 'character', panels: '3' });
  });

  it('"una imagen por vista" is refused in every mode: it takes angle steps', async () => {
    const text = 'tres vistas de este personaje, una imagen por vista';
    expect((await oneOp('reference_sheet', 'asset:img1', undefined, text)).errors.join(' ')).toContain('one image per view');
    expect((await oneOp('reference_sheet', 'asset:img1', undefined, text, { direct: true })).errors.join(' ')).toContain('one image per view');
  });
});

describe('several angles: one angle step per angle; Auto asks how many, Direct uses 3', () => {
  const angleStep = (id: string, angle?: string) => ({ id, kind: 'op', op: 'angle', input: 'asset:img1', ...(angle ? { params: { angle } } : {}) });
  const plural = 'dame múltiples ángulos de esta escena';

  it('a single angle step for "múltiples ángulos" asks how many in Auto', async () => {
    const raw = { title: 'Ángulos', steps: [angleStep('s1')] } as unknown as Parameters<typeof normalizePlan>[0];
    const { errors } = await normalizePlan(raw, ctxWith(plural), 'pln_test');
    expect(errors.join(' ')).toContain('needs a number');
  });

  it('Direct makes the 3 angle steps itself, each with its own angle: no plan sent back, no extra call', async () => {
    const raw = { title: 'Ángulos', steps: [angleStep('s1')] } as unknown as Parameters<typeof normalizePlan>[0];
    const { plan, errors } = await normalizePlan(raw, ctxWith(plural, [], true), 'pln_test');
    expect(errors).toEqual([]);
    const angles = plan!.steps.map((x) => (x as { params: Record<string, string> }).params.angle);
    expect(angles).toHaveLength(3);
    expect(new Set(angles).size).toBe(3);
    expect(plan!.adjustments.join(' ')).toContain('3 angle steps');
  });

  it('two angle steps on one image never get the same angle from the fill', async () => {
    const raw = { title: 'Ángulos', steps: [angleStep('s1'), angleStep('s2')] } as unknown as Parameters<typeof normalizePlan>[0];
    const { plan } = await normalizePlan(raw, ctxWith('ponla de perfil'), 'pln_test');
    const angles = plan!.steps.map((x) => (x as { params: Record<string, string> }).params.angle);
    expect(angles[0]).toBe('profile-left');
    expect(angles[1]).not.toBe('profile-left');
  });

  it('"tres vistas" made as angle steps, with no sheet and no "por vista": Auto asks, Direct and "por vista" do not', async () => {
    const raw = () => ({ title: 'Vistas', steps: [angleStep('s1', 'front'), angleStep('s2', 'profile-left'), angleStep('s3', 'back')] }) as unknown as Parameters<typeof normalizePlan>[0];
    expect((await normalizePlan(raw(), ctxWith('tres vistas de este personaje'), 'pln_test')).errors.join(' ')).toContain('reference sheet (one image) or one image per view');
    expect((await normalizePlan(raw(), ctxWith('tres vistas de este personaje', [], true), 'pln_test')).errors).toEqual([]);
    expect((await normalizePlan(raw(), ctxWith('tres vistas de este personaje, una imagen por vista'), 'pln_test')).errors).toEqual([]);
  });

  it('three angle steps, each with its own angle, fit "múltiples ángulos"', async () => {
    const raw = { title: 'Ángulos', steps: [angleStep('s1', 'profile-left'), angleStep('s2', 'back'), angleStep('s3', 'high')] } as unknown as Parameters<typeof normalizePlan>[0];
    const { errors } = await normalizePlan(raw, ctxWith(plural), 'pln_test');
    expect(errors).toEqual([]);
  });
});

describe('contact sheet: unnamed keeps its default, nothing is reported', () => {
  it('a contact sheet with no number of angles is 9, with no adjustment', async () => {
    const { plan, errors } = await oneOp('contact_sheet', 'asset:img1', undefined, 'hazme una hoja de contacto');
    expect(errors).toEqual([]);
    expect(paramsOf(plan).angles).toBe('9');
    expect(plan!.adjustments.join(' ')).not.toContain('angles');
  });
});

describe('upscale says what it does', () => {
  it('8K from a 1024 px image is ×4 and the plan says it falls short', async () => {
    const { plan, errors } = await oneOp('upscale', 'asset:img1', undefined, 'súbela a 8K');
    expect(errors).toEqual([]);
    expect(paramsOf(plan).factor).toBe('4');
    expect(plan!.adjustments.join(' ')).toContain('short of 8K');
  });

  it('an unknown source size is missing data: a factor the agent gave settles it without a question', async () => {
    const { plan, errors } = await oneOp('upscale', 'asset:img3', { factor: '4' }, 'pásala a 4K');
    expect(errors).toEqual([]);
    expect(paramsOf(plan).factor).toBe('4');
  });
});

describe('a contact sheet cut by grid_split takes its own grid', () => {
  it('six angles are cut 2×3, nine 3×3', async () => {
    for (const [angles, grid] of [['6', '2x3'], ['9', '3']]) {
      const raw = { title: 'Hoja', steps: [{ id: 's1', kind: 'op', op: 'contact_sheet', input: 'asset:img1', params: { angles } }, { id: 's2', kind: 'op', op: 'grid_split', input: 's1' }] } as unknown as Parameters<typeof normalizePlan>[0];
      const { plan, errors } = await normalizePlan(raw, ctxWith('hazme una hoja de contacto'), 'pln_test');
      expect(errors).toEqual([]);
      expect((plan!.steps[1] as { params: Record<string, string> }).params.grid).toBe(grid);
    }
  });
});

