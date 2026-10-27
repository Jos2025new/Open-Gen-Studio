import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-10-27: the plan card's chip popovers (Resolution, Aspect, Images, Duration) sized to a fixed 320-480 px with empty space;
// they now take the width of their options, with a moderate padding and the popover radius.
const cards = readFileSync('src/styles/chat-cards.css', 'utf8');
const chip = readFileSync('src/components/chat/ChipPop.tsx', 'utf8');

describe('the plan card chip popovers', () => {
  it('size to their content with moderate padding and the popover radius', () => {
    expect(cards).toMatch(/\.cc-pop-plan \{ width: max-content !important; max-width: calc\(100vw - 16px\); padding: 10px; border-radius: var\(--pop-radius\); \}/);
  });
  it('keep the shared .cc-pop look for every other popover', () => {
    expect(cards).toMatch(/\.cc-pop \{ background: var\(--surface-3\); border-radius: 16px; padding: 14px;/);
  });
  it('are marked only when the chip sits inside the plan card', () => {
    expect(chip).toMatch(/closest\('\.plan-card'\)/);
    expect(chip).toMatch(/cc-pop\$\{onPlan \? ' cc-pop-plan' : ''\}/);
  });
});
