import { AGENT_OP_IDS } from '../ops';

/*
 * Keyword triggers for the agent's operations, in Spanish and English. A match only names an operation and where it
 * appears in the request; whether it can run (its input, its cost, its approval) is decided after this. Text is
 * compared without accents and in lower case.
 */
export const OP_TRIGGERS: Record<string, RegExp[]> = {
  angle: [/\b(vistas? (frontal|lateral|trasera|trasero|superior|cenital)|(front|side|back|top|rear) view|camera angle|(otro|nuevo|diferente|distinto) angulo|angulo (diferente|distinto|nuevo|otro)|(multiples|varios|muchos) angulos|(multiple|several|many) angles|desde (otro|un|este|el) angulo|angulo (frontal|lateral|trasero|superior|picado|contrapicado))\b/],
  relight: [/\b(iluminacion|lighting|relight|cambia (la )?luz|change (the )?light|pon(le)? luz( (cenital|lateral|de estudio|suave|dura))?)\b/],
  upscale: [/\b(upscale|(sube|subir|aumenta|aumentar) (la )?resolucion|mas resolucion|(sube|subir|pasa|pasala|lleva|llevala|escala|escalar) (a |la |el |al )?(2|4|8)k|(2|4|8)k (upscale|resolution))\b/],
  reframe: [/\b(otro (aspecto|aspect|formato)|cambia(r)? (el |la )?(formato|aspecto|aspect)|(cambia|cambiar|adapta|adaptar|pasa|pasala|convierte|extiende)\w* (la |esta |el )?(imagen |foto )?(a |al |en )?(formato )?(para )?(instagram|tiktok|reels?|stories|shorts|youtube|vertical|horizontal|cuadrad\w*)|formato (para |de )?(instagram|tiktok|reels?|stories|shorts|historias?|vertical|cuadrad\w*)|(a|en|formato|aspect|aspecto|it|to) (9:16|4:5|1:1|16:9|3:4|2:3|3:2|21:9)|(9:16|4:5|1:1|16:9|3:4|2:3|3:2|21:9) (for|para) (instagram|tiktok|reels?|stories|shorts|youtube))\b/],
  remove_bg: [/\b(quit\w* (el )?fondo|sin (el )?fondo|fondo transparente|remove (the )?background|transparent background)\b/],
  reference_sheet: [/\b(hoja de (referencias?|personajes?)|character sheet|reference sheet|turnaround|(dos|tres|cuatro|2|3|4) (vistas|paneles)|(two|three|four|2|3|4) (views|panels))\b/],
  contact_sheet: [/\b(contact sheet|hoja de contacto|(seis|nueve) angulos|(six|nine) angles|3x3)\b/],
  grid_split: [/\b(cuadricula|grid split|split (the )?grid|grid image|grid)\b/],
  extract_frame: [/\b(fotograma|ultimo frame|(primer|first) frame|last frame|(get|grab|save|extract|capture) (a |the |an )?frame|(saca|extrae|captura|dame) (un |el |the )?frame|frame del (video|clip))\b/],
  join_clips: [/\b(une (los )?clips|junta (los )?clips|join (the )?clips|merge (the )?clips|concatenate)\b/],
  video_upscale: [/\b(mas resolucion del (video|clip)|upscale (the )?(video|clip)|video upscale)\b/],
  edit: [/\b(edita|editar|edit|cambia|cambiar|modifica|modificar|quita|quitar|agrega|agregar)\b/],
  variations: [/\b(variaciones|variations|variantes|variants|otras versiones|nuevas tomas|other takes)\b/],
  video_edit: [/\b((edita|cambia|modifica) el (video|clip)|(edit|change|modify) (the )?(video|clip))\b/],
  video_extend: [/\b((extiende|extender|extend) (el |the )?(video|clip))\b/],
  continue: [/\b((continua|continuar|continue) (el |the )?clip|(nuevo clip|new clip) (desde|from) (el )?(ultimo frame|last frame))\b/],
  animate: [/\b(anima|animar|animate|image to video|video (de|from) (esta|this) imagen|convierte (la|esta) imagen en (un )?video)\b/],
  transcribe: [/\b(transcribe|transcribir|transcripcion|speech to text|pasa a texto|texto del audio)\b/],
  create_voice: [/\b((muestr\w*|dame|hazme|quiero|necesito|crea|crear|haz|genera|generar) (me )?(una |su |mi )?voz|voz (para|que)|clona(r)? (mi|la|su) voz|clone (my|her|his|the) voice|(hable|suene|hablar) con (mi|su|la) voz|(make|create|need|show) (a |her |his |my )?voice|\ba voice (i|to|so|that)\b)\b/],
};

interface Hit { op: string; index: number; length: number }

/** Lower case, no accents: the form every pattern above is written in. */
export function normalizeRequest(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
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
