import { AGENT_OP_IDS } from '../ops';

/*
 * Keyword triggers for the agent's operations, in Spanish and English. A match only names an operation and where it
 * appears in the request; whether it can run (its input, its cost, its approval) is decided after this. Text is
 * compared without accents and in lower case.
 */
export const OP_TRIGGERS: Record<string, RegExp[]> = {
  angle: [/\b(angulos?|vista desde|camera angle|angles?)\b/],
  relight: [/\b(iluminacion|lighting|relight|cambia (la )?luz|change (the )?light|pon(le)? luz|luz (cenital|lateral|de estudio|suave|dura))\b/],
  upscale: [/\b(upscale|mas resolucion|4k)\b/],
  remove_bg: [/\b(quita(r)? el fondo|quitar fondo|fondo transparente|remove (the )?background|transparent background)\b/],
  reframe: [/\b(otro aspect|nuevo aspect|new aspect|extiende (la imagen )?a|extend (the )?(scene|image) to|reframe)\b/],
  reference_sheet: [/\b(hoja de (referencias?|personajes?)|character sheet|reference sheet|turnaround)\b/],
  contact_sheet: [/\b(contact sheet|hoja de contacto|nueve angulos|nine angles|3x3)\b/],
  grid_split: [/\b(cuadricula|grid split|split (the )?grid|grid image|grid)\b/],
  extract_frame: [/\b(fotograma|ultimo frame|first frame|last frame|frame)\b/],
  join_clips: [/\b(une (los )?clips|junta (los )?clips|join (the )?clips|merge (the )?clips|concatenate)\b/],
  video_upscale: [/\b(mas resolucion del (video|clip)|upscale (the )?(video|clip)|video upscale)\b/],
  edit: [/\b(edita|editar|edit|cambia|cambiar|modifica|modificar|quita|quitar|agrega|agregar)\b/],
  variations: [/\b(variaciones|variations|variantes|variants|otras versiones|nuevas tomas|other takes)\b/],
  video_edit: [/\b((edita|cambia|modifica) el (video|clip)|(edit|change|modify) (the )?(video|clip))\b/],
  video_extend: [/\b((extiende|extender|extend) (el |the )?(video|clip))\b/],
  continue: [/\b((continua|continuar|continue) (el |the )?clip|(nuevo clip|new clip) (desde|from) (el )?(ultimo frame|last frame))\b/],
  animate: [/\b(anima|animar|animate|image to video|video (de|from) (esta|this) imagen|convierte (la|esta) imagen en (un )?video)\b/],
  transcribe: [/\b(transcribe|transcribir|transcripcion|speech to text|pasa a texto|texto del audio)\b/],
  create_voice: [/\b(voz|voces|voice|voices|clona (la )?voz|clone (the )?voice|crea una voz|make a voice|create (a )?voice)\b/],
};

interface Hit { op: string; index: number; length: number }

/** Lower case, no accents: the form every pattern above is written in. */
export function normalizeRequest(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The operations a request names, in the order it names them (first appearance), each once. A longer match that covers
 * a shorter one of another operation wins: "quita el fondo" is remove_bg, not edit; "nueve angulos" is contact_sheet.
 */
export function detectOps(text: string): string[] {
  const s = normalizeRequest(text);
  const hits: Hit[] = [];
  for (const op of AGENT_OP_IDS) {
    for (const re of OP_TRIGGERS[op] ?? []) {
      const global = new RegExp(re.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = global.exec(s)) !== null) hits.push({ op, index: m.index, length: m[0].length });
    }
  }
  const kept = hits.filter((h) => !hits.some((o) => o.op !== h.op && o.index <= h.index && o.index + o.length >= h.index + h.length && o.length > h.length));
  kept.sort((a, b) => a.index - b.index);
  const ops: string[] = [];
  for (const h of kept) if (!ops.includes(h.op)) ops.push(h.op);
  return ops;
}

/** Names for the sequence, in the order the request names them: n1_reference-sheet, n2_create-voice. */
export function sequenceNames(ops: string[]): string[] {
  return ops.map((op, i) => `n${i + 1}_${op.replace(/_/g, '-')}`);
}
