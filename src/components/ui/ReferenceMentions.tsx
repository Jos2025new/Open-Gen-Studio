import { useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { refMentionStyle } from '../../engine/params';
import type { Asset, Generation, PlanStep, PlanSubject, Subject } from '../../engine/types';
import { AssetMedia } from './AssetMedia';
import { Popover } from './Popover';

/** `attach`: an image of the space not attached yet; picking it attaches it, and `mention` is the number it gets. */
export interface ReferenceChoice { id: string; label: string; mention: string; assetId?: string; attach?: boolean }
export function referenceChoices(images: Array<{ id: string; label: string; assetId?: string }>, subjects: Subject[], modelId = '', promptRefs?: string): ReferenceChoice[] {
  const style = refMentionStyle(modelId, promptRefs);
  return [
    ...images.map((image, i) => ({ ...image, mention: style ? style.template.replace('{n}', String(i + (style.zeroBased ? 0 : 1))) : `@Image${i + 1}` })),
    ...subjects.map(s => ({ id: `subject:${s.id}`, label: s.name, mention: `@${s.name}`, assetId: s.frontalAssetId })),
  ];
}

/** Images made in this session, newest first, that are not attached yet (at most `limit`). */
export function spaceImages(generations: Record<string, Generation>, assets: Record<string, Asset>, sessionIds: string[], attached: string[], limit = 24): string[] {
  return Object.values(generations)
    .filter(g => !g.discard && g.kind === 'image' && sessionIds.includes(g.sessionId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap(g => g.assetIds.filter(id => assets[id]?.kind === 'image' && !attached.includes(id)))
    .slice(0, limit);
}

export function stepReferenceChoices(step: PlanStep, steps: PlanStep[], assets: Record<string, Asset>, library: Subject[], local: PlanSubject[] = [], promptRefs?: string) {
  const images = ('refs' in step ? step.refs ?? [] : []).flatMap((raw, i) => {
    const ref = typeof raw === 'string' ? raw : raw.ref;
    const assetId = ref.startsWith('asset:') ? ref.slice(6) : undefined;
    const source = steps.find(s => s.id === ref.split('#')[0]);
    if (assetId ? assets[assetId]?.kind !== 'image' : source?.kind !== 'image') return [];
    return [{ id: `${i}:${ref}`, assetId, label: (assetId ? assets[assetId]?.name : source?.title) || `Image ${i + 1}` }];
  });
  const stepSubjects = step.nodeSubjects ?? [];
  const subjects: Subject[] = [...stepSubjects, ...local.filter(s => !stepSubjects.some(n => n.name.toLowerCase() === s.name.toLowerCase()))].map((s, i) => ({ id: `plan-${i}`, name: s.name, frontalAssetId: s.from.startsWith('asset:') ? s.from.slice(6) : undefined, refAssetIds: [] }));
  subjects.push(...library.filter(s => !subjects.some(local => local.name.toLowerCase() === s.name.toLowerCase())));
  return referenceChoices(images, subjects, 'modelRef' in step ? step.modelRef : '', promptRefs);
}

/** Existing field and Popover, with the WAI autocomplete keyboard model.
 * https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ */
export function useReferenceMentions(
  ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>, value: string,
  onChange: (value: string) => void, choices: ReferenceChoice[], onAttach?: (assetId: string) => void,
) {
  const id = useId();
  const [query, setQuery] = useState<{ start: number; end: number; text: string; value: string } | null>(null);
  const [active, setActive] = useState(0);
  const dismissed = useRef<{ value: string; end: number } | null>(null);
  const matches = query?.value === value ? choices.filter(c => `${c.label} ${c.mention}`.toLowerCase().includes(query.text.toLowerCase())) : [];
  const open = Boolean(query && query.value === value && matches.length);
  const index = Math.min(active, Math.max(0, matches.length - 1));
  const close = () => { dismissed.current = ref.current ? { value: ref.current.value, end: ref.current.selectionStart ?? 0 } : null; setQuery(null); };
  const sync = (field: HTMLInputElement | HTMLTextAreaElement) => {
    const end = field.selectionStart ?? field.value.length;
    if (dismissed.current?.value === field.value && dismissed.current.end === end) return;
    dismissed.current = null;
    const match = field.value.slice(0, end).match(/(?:^|[\s([{,:;.!?])@([^\s@]*)$/u);
    if (!match || field.selectionEnd !== end) { close(); return; }
    const next = { start: end - match[1].length - 1, end, text: match[1], value: field.value };
    if (query?.start === next.start && query.end === next.end && query.value === next.value) return;
    setQuery(next); setActive(0);
  };
  const insert = (choice: ReferenceChoice) => {
    if (!query || query.value !== value) return;
    const suffix = value.slice(query.end);
    if (choice.attach && choice.assetId) onAttach?.(choice.assetId);
    const token = choice.mention + (/^\s/.test(suffix) ? '' : ' ');
    onChange(value.slice(0, query.start) + token + suffix);
    close();
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(query.start + token.length, query.start + token.length); });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!open || e.nativeEvent.isComposing) return false;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key) || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter') insert(matches[index]);
    else setActive((index + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
    return true;
  };
  return {
    sync, onKeyDown, onBlur: close,
    aria: { 'aria-autocomplete': 'list' as const, 'aria-haspopup': 'listbox' as const, 'aria-expanded': open, 'aria-controls': open ? id : undefined, 'aria-activedescendant': open ? `${id}-${index}` : undefined },
    menu: <Popover open={open} anchor={ref} onClose={close} width={300} label="Reference suggestions">
      <div role="listbox" id={id} aria-label="References">
        {matches.map((choice, i) => <button key={choice.id} id={`${id}-${i}`} type="button" role="option" aria-selected={i === index}
          className={`menu-item${i === index ? ' is-active' : ''}`} onPointerDown={e => e.preventDefault()} onClick={() => insert(choice)}>
          {choice.assetId ? <span className="subject-thumb"><AssetMedia assetId={choice.assetId} /></span> : null}
          <span className="subject-main"><span>{choice.label}</span><span className="faint">{choice.attach ? `Attach as ${choice.mention}` : choice.mention}</span></span>
        </button>)}
      </div>
    </Popover>,
  };
}
