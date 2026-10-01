import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS server module without types
import { joinArgs } from '../server/local-store.js';
import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { normalizePlan, pruneJoins, stepDeps, toggleStep, type PlanContext } from '../src/engine/plan';
import { opsFor } from '../src/engine/ops';
import type { MediaKind } from '../src/engine/types';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('join_clips on the local server (F4)', () => {
  it.skipIf(!hasFfmpeg)('joins clips of different sizes, one without sound, into one MP4 at the first size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-join-'));
    try {
      const a = join(dir, 'a.mp4');
      const b = join(dir, 'b.mp4');
      const out = join(dir, 'out.mp4');
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=480x854:rate=24:duration=1', a]);
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-shortest', b]);
      execFileSync('ffmpeg', joinArgs([{ path: a, audio: false, duration: 1 }, { path: b, audio: true, duration: 1 }], { width: 480, height: 854 }, out));
      const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', out]).toString());
      expect(info.streams.map((s: { codec_type: string }) => s.codec_type).sort()).toEqual(['audio', 'video']);
      expect(info.streams.find((s: { codec_type: string }) => s.codec_type === 'video')).toMatchObject({ width: 480, height: 854 });
      expect(Number(info.format.duration)).toBeGreaterThan(1.9);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(!hasFfmpeg)('lays music under the joined video, looped and cut to its length', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-join-'));
    try {
      const a = join(dir, 'a.mp4');
      const b = join(dir, 'b.mp4');
      const m = join(dir, 'm.wav');
      const out = join(dir, 'out.mp4');
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=1.5', a]);
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=1.5', b]);
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', m]);
      execFileSync('ffmpeg', joinArgs([{ path: a, audio: false, duration: 1.5 }, { path: b, audio: false, duration: 1.5 }], { width: 320, height: 240 }, out, m));
      const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', out]).toString());
      expect(info.streams.map((s: { codec_type: string }) => s.codec_type).sort()).toEqual(['audio', 'video']);
      const d = Number(info.format.duration);
      expect(d).toBeGreaterThan(2.8);
      expect(d).toBeLessThan(3.3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('odd sizes are rounded up to even (H.264 needs it)', () => {
    const args: string[] = joinArgs([{ path: 'a', audio: true, duration: 1 }, { path: 'b', audio: true, duration: 1 }], { width: 481, height: 853 }, 'o');
    expect(args.join(' ')).toContain('scale=482:854');
  });
});

describe('join_clips in plans (F4)', () => {
  const models = local.listModels(undefined);
  const ctx = (workspace: 'chat' | 'node' = 'chat'): PlanContext => ({
    workspace,
    getModel: async (ref) => {
      const model = (await models).find((m) => m.ref === ref);
      return model ? { model, schema: await local.loadSchema(model, undefined) } : null;
    },
    defaultModel: (kind: MediaKind) => (kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF),
    defaultSettings: () => ({}),
    asset: () => undefined,
    layer: () => undefined,
  });
  const clips = [
    { id: 's1', kind: 'video', prompt: 'a' },
    { id: 's2', kind: 'video', prompt: 'b' },
    { id: 's3', kind: 'video', prompt: 'c' },
  ];

  it('waits for every clip, in order', async () => {
    const { plan, errors } = await normalizePlan({ title: 't', steps: [...clips, { id: 's4', kind: 'op', op: 'join_clips', input: 's1', more: ['s2', 's3'] }] }, ctx(), 'p');
    expect(errors).toEqual([]);
    const join = plan!.steps.find((s) => s.id === 's4')!;
    expect(stepDeps(join)).toEqual(['s1', 's2', 's3']);
  });

  it('needs the other clips, only videos, and not in Node yet', async () => {
    const none = await normalizePlan({ title: 't', steps: [...clips, { id: 's4', kind: 'op', op: 'join_clips', input: 's1' }] }, ctx(), 'p');
    expect(none.errors.join(' ')).toMatch(/needs "more"/);
    const image = await normalizePlan({ title: 't', steps: [...clips, { id: 'i', kind: 'image', prompt: 'x' }, { id: 's4', kind: 'op', op: 'join_clips', input: 's1', more: ['i'] }] }, ctx(), 'p');
    expect(image.errors.join(' ')).toMatch(/joins videos; "i" is image/);
    const node = await normalizePlan({ title: 't', steps: [...clips, { id: 's4', kind: 'op', op: 'join_clips', input: 's1', more: ['s2'] }] }, ctx('node'), 'p');
    expect(node.errors.join(' ')).toMatch(/not available in the Node workspace/);
  });

  it('unchecking a clip keeps the join, which joins the clips that run; under two clips it is dropped', async () => {
    const { plan } = await normalizePlan({ title: 't', steps: [...clips, { id: 's4', kind: 'op', op: 'join_clips', input: 's1', more: ['s2', 's3'] }] }, ctx(), 'p');
    const off = toggleStep(plan!.steps, [], 's1');
    expect(off).toEqual(['s1']);
    const two = pruneJoins(plan!.steps.filter((s) => !off.includes(s.id)), new Set(off));
    expect(two.steps.find((s) => s.id === 's4')).toMatchObject({ input: 's2', more: ['s3'] });
    const one = pruneJoins(plan!.steps.filter((s) => s.id === 's3' || s.id === 's4'), new Set(['s1', 's2']));
    expect(one.dropped).toEqual(['s4']);
  });

  it('is not offered on a single video in menus', () => {
    expect(opsFor('video').map((o) => o.id)).not.toContain('join_clips');
  });
});
