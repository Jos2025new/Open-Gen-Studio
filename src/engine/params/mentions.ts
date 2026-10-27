export function mentionSubjects(prompt: string, subjects: Array<{ id: string; name: string }>, template?: string, offset = 0): { prompt: string; ids: string[] } {
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Longest names claim their text first, so "@Ana Maria" is never also read as "@Ana".
  const hits: Array<{ start: number; end: number; id: string; name: string }> = [];
  for (const s of subjects.filter((x) => x.name.trim()).sort((a, b) => b.name.length - a.name.length)) {
    for (const m of prompt.matchAll(new RegExp(`@${esc(s.name)}(?![\\p{L}\\p{N}_-])`, 'giu'))) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!hits.some((h) => start < h.end && end > h.start)) hits.push({ start, end, id: s.id, name: s.name });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const ids = [...new Set(hits.map((h) => h.id))];
  let out = '';
  let at = 0;
  for (const h of hits) {
    out += prompt.slice(at, h.start) + (template ? template.replace('{n}', String(ids.indexOf(h.id) + 1 + offset)) : h.name);
    at = h.end;
  }
  return { prompt: out + prompt.slice(at), ids };
}

/** Expand @Name from its saved description when a model receives no subject image. */
export function describeMentions(prompt: string, subjects: Array<{ id: string; name: string; description?: string }>): string {
  const mark = '\u0000';
  const { prompt: marked, ids } = mentionSubjects(prompt, subjects, `${mark}{n}${mark}`);
  const seen = new Set<number>();
  return marked.replace(new RegExp(`${mark}(\\d+)${mark}`, 'g'), (_, n: string) => {
    const s = subjects.find((x) => x.id === ids[Number(n) - 1])!;
    const desc = s.description?.trim();
    if (!desc) return s.name;
    if (!seen.has(Number(n))) {
      seen.add(Number(n));
      return desc;
    }
    return `the ${desc.split(/[,;(]/)[0].trim().replace(/^(a|an|the)\s+/i, '')}`;
  });
}

/** Reference mention syntax: schema first, then model family. `zeroBased` marks zero-indexed forms. */
export function refMentionStyle(modelId: string, promptRefs?: string): { template: string; zeroBased: boolean } | undefined {
  const said = promptRefs ?? '';
  if (/@image\s?\d/i.test(said)) return { template: '@Image{n}', zeroBased: false };
  if (/<\s*image_ref_/i.test(said)) return { template: '<IMAGE_REF_{n}>', zeroBased: true };
  if (/<\s*image_?0/i.test(said)) return { template: '<IMAGE_{n}>', zeroBased: true };
  if (/character\s?1/i.test(said)) return { template: 'character{n}', zeroBased: false };
  if (/\bimage\s?1\b/i.test(said)) return { template: 'Image {n}', zeroBased: false };
  if (/seedance/i.test(modelId)) return { template: '@Image{n}', zeroBased: false };
  // Wan 3: positional words without "@" (fal schema: "the subject in Image 1 walks past Video 1").
  if (/wan-3/i.test(modelId)) return { template: 'Image {n}', zeroBased: false };
  if (/minimax[-/]h3/i.test(modelId)) return { template: '<Picture {n}>', zeroBased: false };
  // Grok Imagine Video: <IMAGE_0>, <IMAGE_1>… from zero (Atlas v1.5 and fal v1.5 schemas); fal v1 says @Image1 and wins above.
  // Gemini Omni Flash: <IMAGE_REF_0>… from zero (Atlas video-edit schema: "the first reference image is <IMAGE_REF_0>").
  if (/gemini-omni/i.test(modelId)) return { template: '<IMAGE_REF_{n}>', zeroBased: true };
  if (/grok-imagine-video/i.test(modelId)) return { template: '<IMAGE_{n}>', zeroBased: true };
  return undefined;
}

/** Why a storyboard does not fit the clip, or null: shots must add up to the duration. */
