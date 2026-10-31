import { describe, expect, it } from 'vitest';
import { boundPopoverLeft, boundPopoverWidth, openPopoverAbove, startAlignedBound } from '../src/components/ui/Popover';

it('keeps popovers within a narrow panel without enlarging smaller menus', () => {
  expect(boundPopoverWidth(300, 80, 300)).toBe(220);
  expect(boundPopoverWidth(180, 80, 380)).toBe(180);
  expect(boundPopoverWidth(300, 80, 80)).toBe(0);
  expect(boundPopoverLeft(20, 220, 80, 300)).toBe(80);
  expect(boundPopoverLeft(250, 180, 80, 380)).toBe(200);
  expect(boundPopoverLeft(100, 180, 80, 380)).toBe(100);
});

describe('popover vertical placement', () => {
  it('opens below when an anchor near the top has no room above', () => {
    expect(openPopoverAbove('top-start', 0, 500, 400)).toBe(false);
  });

  it('opens above near the bottom when the panel fits there', () => {
    expect(openPopoverAbove('top-start', 500, 0, 400)).toBe(true);
  });

  it('opens below when only the lower side fits the full panel', () => {
    expect(openPopoverAbove('top-start', 240, 400, 400)).toBe(false);
  });

  it('uses the larger side when neither side fits, leaving the rest scrollable', () => {
    expect(openPopoverAbove('top-start', 300, 260, 400)).toBe(true);
    expect(openPopoverAbove('top-start', 260, 300, 400)).toBe(false);
  });

  it('keeps explicit bottom placement preference and flips only when needed', () => {
    expect(openPopoverAbove('bottom-start', 500, 400, 400)).toBe(false);
    expect(openPopoverAbove('bottom-start', 500, 100, 400)).toBe(true);
    expect(openPopoverAbove('bottom-start', 200, 100, 400)).toBe(true);
  });
});

it('a start-aligned popover slides left instead of shrinking near the edge', () => {
  expect(startAlignedBound(100, 236, 0, 600)).toBe(100); // fits: starts at the anchor
  expect(startAlignedBound(340, 236, 0, 380)).toBe(144); // narrow panel: slides left to keep its width
  expect(startAlignedBound(40, 500, 20, 380)).toBe(20); // wider than the panel: the boundary wins
  expect(boundPopoverWidth(236, startAlignedBound(340, 236, 0, 380), 380)).toBe(236);
});
