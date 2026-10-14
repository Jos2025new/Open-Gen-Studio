import { describeMentions, mentionSubjects, refMentionStyle } from './params';
import type { GenSettings, ModelSchema, Subject } from './types';

/** Apply the runner's subject naming rules to copies of the prompt and structured shots. */
export function mapSubjectPrompts(prompt: string, shots: GenSettings['shots'], subjects: Subject[], schema: ModelSchema, modelId: string, refs: number) {
  const elements = schema.slots.elements;
  const subjectImages = !elements && !schema.slots.keyframes && Boolean(schema.slots.images || schema.slots.mixedRefs);
  const ids = mentionSubjects([prompt, ...(shots ?? []).map(shot => shot.prompt)].join('\n'), subjects).ids;
  const style = subjectImages ? refMentionStyle(modelId, schema.slots.promptRefs) : undefined;
  const offset = refs - (style?.zeroBased ? 1 : 0);
  const mapGlobal = (text: string, template: string, start = 0) => {
    const mark = '\u0000';
    const encoded = mentionSubjects(text, subjects, `${mark}{n}${mark}`);
    return encoded.prompt.replace(new RegExp(`${mark}(\\d+)${mark}`, 'g'), (_, number: string) => {
      const id = encoded.ids[Number(number) - 1];
      const index = ids.indexOf(id);
      const subject = subjects.find(s => s.id === id);
      return index < 0 || !subject ? subject?.name ?? '' : mentionSubjects(`@${subject.name}`, subjects, template, start + index).prompt;
    });
  };
  const mapShot = (text: string) => elements ? mapGlobal(text, elements.mention) : !subjectImages
    ? describeMentions(text, subjects) : style ? mapGlobal(text, style.template, offset) : mentionSubjects(text, subjects).prompt;
  const mappedPrompt = elements ? mapGlobal(prompt, elements.mention) : subjectImages
    ? style ? mapGlobal(prompt, style.template, offset) : mentionSubjects(prompt, subjects).prompt
    : describeMentions(prompt, subjects);
  return {
    prompt: mappedPrompt,
    ids,
    shots: shots?.map(shot => ({ ...shot, prompt: mapShot(shot.prompt) })),
    subjectImages,
  };
}
