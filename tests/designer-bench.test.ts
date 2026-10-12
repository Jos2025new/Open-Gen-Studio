import { expect, it } from 'vitest';
import { appendBenchSessions, intervalWork, longBenchStrokes, sandboxBenchAllowed } from '../src/lib/designerBenchFixtures';
import { createSession } from '../src/store/store';

it('makes exactly 300 long strokes with deterministic geometry and ids', () => {
  const strokes = longBenchStrokes();
  expect(strokes).toHaveLength(300);
  expect(strokes.every((s) => s.segments.length === 120 && s.segments.every((seg) => seg.length === 5))).toBe(true);
  expect(new Set(strokes.map((s) => s.id)).size).toBe(300);
  expect(strokes).toEqual(longBenchStrokes());
});
it('adds 1000 synthetic sessions once, preserving every existing session by reference', () => {
  const old = createSession('Existing');
  const first = appendBenchSessions({ [old.id]: old }, createSession);
  expect(Object.keys(first)).toHaveLength(1001);
  expect(first[old.id]).toBe(old);
  const second = appendBenchSessions(first, createSession);
  expect(Object.keys(second)).toHaveLength(1001);
  expect(second['bench-fluidity-session-0']).toBe(first['bench-fluidity-session-0']);
  expect(second['bench-fluidity-session-0'].agent.busy).toBe(false);
});
it('counts nested work only once and clips work at frame boundaries', () => {
  expect(intervalWork([[0, 10], [2, 4], [9, 15], [30, 40]], 5, 35)).toBe(15);
  expect(intervalWork([], 0, 16.7)).toBe(0);
});

it('exposes the bank only on a loopback sandbox origin', () => {
  expect(sandboxBenchAllowed({ hostname: 'localhost', port: '5183' })).toBe(true);
  expect(sandboxBenchAllowed({ hostname: '127.0.0.1', port: '5173' })).toBe(false);
  expect(sandboxBenchAllowed({ hostname: 'example.com', port: '5183' })).toBe(false);
});
