import { afterEach, expect, it, vi } from 'vitest';
import { LOCAL_WRITE } from '../src/lib/disk';

afterEach(() => vi.unstubAllGlobals());
it('marks writes whenever navigator.webdriver is true', () => {
  vi.stubGlobal('navigator', { webdriver: false });
  expect({ ...LOCAL_WRITE }['X-OGS-Automated']).toBe('0');
  vi.stubGlobal('navigator', { webdriver: true });
  expect({ ...LOCAL_WRITE }).toEqual({ 'X-OGS': '1', 'X-OGS-Automated': '1' });
  vi.stubGlobal('navigator', undefined);
  expect({ ...LOCAL_WRITE }['X-OGS-Automated']).toBe('0');
});
