import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/components/chat/StudioGeneration', () => ({ StudioGeneration: () => null }));
import { studioRuns } from '../src/components/chat/FeedList';
import type { FeedItem } from '../src/engine/types';

const item = (id: string, type: string) => ({ id, type }) as FeedItem;

describe('Studio chat lays consecutive results side by side', () => {
  it('groups runs of two or more generations and leaves single ones and other rows alone', () => {
    const feed = [item('u', 'user'), item('g1', 'generation'), item('g2', 'generation'), item('g3', 'generation'), item('a', 'assistant'), item('g4', 'generation')];
    const rows = studioRuns(feed);
    expect(rows.map((r) => (Array.isArray(r) ? r.map((x) => x.id) : r.id))).toEqual(['u', ['g1', 'g2', 'g3'], 'a', 'g4']);
  });
});
