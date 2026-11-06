// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { createDoc, NEW_DOC_BACKGROUND_PREF, newDocBackground } from '../src/engine/design/doc';

beforeEach(() => localStorage.clear());

it('a new document is transparent unless a background was chosen', () => {
  expect(createDoc('d', 10, 10).background).toBeNull();
  expect(newDocBackground()).toBeNull();
  localStorage.setItem(NEW_DOC_BACKGROUND_PREF, JSON.stringify('#ffffff'));
  expect(newDocBackground()).toBe('#ffffff');
});
