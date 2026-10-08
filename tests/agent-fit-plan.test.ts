import { describe, expect, it } from 'vitest';
import { normalizePlan, type PlanContext } from '../src/engine/plan';

/*
 * The fit wired into the plan normalizer. A missing or invalid operation parameter takes the value the request names or
 * the source image implies; a valid value the agent gave is kept; a request that cannot fit is refused with its reason.
 * Stubbed context: no provider, no canvas.
 */
const assets: Record<string, { kind: 'image'; width: number; height: number }> = {
  img1: { kind: 'image', width: 1024, height: 1024 },
  img2: { kind: 'image', width: 1080, height: 1920 },
};

function ctxWith(requestText: string, usedAngles: string[] = []): PlanContext {
  return {
    workspace: 'chat',
    getModel: async () => null,
    defaultModel: () => null,
    defaultSettings: () => ({}),
    asset: (id: string) => assets[id],
    layer: () => undefined,
    requestText: () => requestText,
    usedAngles: () => usedAngles,
  } as unknown as PlanContext;
}

async function oneOp(op: string, input: string, params: Record<string, unknown> | undefined, requestText: string, usedAngles: string[] = []) {
  const raw = { title: 'Test', steps: [{ id: 's1', kind: 'op', op, input, ...(params ? { params } : {}) }] } as unknown as Parameters<typeof normalizePlan>[0];
  return normalizePlan(raw, ctxWith(requestText, usedAngles), 'pln_test');
}

describe('angle: the request names the value, or a new angle is taken', () => {
  it('"un ángulo diferente" with no value takes an angle not made yet', async () => {
    const { plan, errors } = await oneOp('angle', 'asset:img1', undefined, 'quiero un ángulo diferente', ['three-quarter-left']);
    expect(errors).toEqual([]);
    expect((plan!.steps[0] as unknown as { params: Record<string, string> }).params.angle).toBe('profile-left');
  });

  it('a valid angle the agent gave is kept, whatever the request says', async () => {
    const { plan } = await oneOp('angle', 'asset:img1', { angle: 'back' }, 'quiero un ángulo diferente', ['three-quarter-left']);
    expect((plan!.steps[0] as unknown as { params: Record<string, string> }).params.angle).toBe('back');
  });

  it('the fill is shown as an adjustment, so it is traceable', async () => {
    const { plan } = await oneOp('angle', 'asset:img1', undefined, 'desde arriba', []);
    expect(plan!.adjustments.join(' ')).toContain('angle "high" from the request');
  });
});

describe('upscale: 4K from the source size', () => {
  it('a 4K request on a 1024 px image is ×4', async () => {
    const { plan, errors } = await oneOp('upscale', 'asset:img1', undefined, 'pásala a 4K');
    expect(errors).toEqual([]);
    expect((plan!.steps[0] as unknown as { params: Record<string, string> }).params.factor).toBe('4');
  });
});

describe('reframe: a format is required, and Instagram alone asks', () => {
  it('Instagram without feed or stories is refused with a question', async () => {
    const { errors } = await oneOp('reframe', 'asset:img2', undefined, 'cambia la imagen en formato para instagram');
    expect(errors.join(' ')).toContain('Ask the user');
  });

  it('a format the agent gave is kept, even when the request is ambiguous', async () => {
    const { plan, errors } = await oneOp('reframe', 'asset:img2', { aspect: '9:16' }, 'cambia la imagen en formato para instagram');
    expect(errors).toEqual([]);
    expect((plan!.steps[0] as unknown as { params: Record<string, string> }).params.aspect).toBe('9:16');
  });

  it('"otro aspecto" takes a format other than the source\'s', async () => {
    const { plan } = await oneOp('reframe', 'asset:img2', undefined, 'quiero otro aspecto');
    expect((plan!.steps[0] as unknown as { params: Record<string, string> }).params.aspect).toBe('4:5');
  });
});

describe('reference sheet: a character, a person or an object, never a place', () => {
  it('a place is refused, even when the agent names a subject that is not offered', async () => {
    const { errors } = await oneOp('reference_sheet', 'asset:img1', { subject: 'location' }, 'tres vistas de la ciudad');
    expect(errors.join(' ')).toContain('a place is not a reference sheet subject');
  });

  it('a character fills the subject and the view count when the agent gave none', async () => {
    const { plan, errors } = await oneOp('reference_sheet', 'asset:img1', undefined, 'hazme cuatro vistas de este personaje');
    expect(errors).toEqual([]);
    expect((plan!.steps[0] as unknown as { params: Record<string, string> }).params).toMatchObject({ subject: 'character', panels: '4' });
  });
});

describe('contact sheet: unnamed keeps its default, nothing is reported', () => {
  it('a contact sheet with no number of angles is 9, with no adjustment', async () => {
    const { plan, errors } = await oneOp('contact_sheet', 'asset:img1', undefined, 'hazme una hoja de contacto');
    expect(errors).toEqual([]);
    expect((plan!.steps[0] as unknown as { params: Record<string, string> }).params.angles).toBe('9');
    expect(plan!.adjustments.join(' ')).not.toContain('angles');
  });
});
