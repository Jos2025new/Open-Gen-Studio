import { describe, expect, it } from 'vitest';
import { openPopoverAbove } from '../src/components/ui/Popover';

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
