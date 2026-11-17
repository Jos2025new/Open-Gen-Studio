import { describe, expect, it } from 'vitest';
import { connectedState } from '../src/components/shell/connectedState';

describe('top bar Connected dot', () => {
  it('is not green while the disk server is down, even with providers connected', () => {
    expect(connectedState(2, 'disk')).toMatchObject({ on: false });
    expect(connectedState(2, 'disk').title).toMatch(/not being saved/);
  });
  it('is green with providers and a healthy disk', () => {
    expect(connectedState(1, null).on).toBe(true);
    expect(connectedState(0, null).on).toBe(false);
  });
});
