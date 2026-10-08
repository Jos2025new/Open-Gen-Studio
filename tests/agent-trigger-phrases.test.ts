import { describe, expect, it } from 'vitest';
import { detectOps } from '../src/engine/agent/triggers';

/*
 * Phrases a user would type, and phrases where the word appears but nothing is requested. Written by hand; a
 * positive must name its operation, a negative must name no operation at all.
 */
const POSITIVES: Array<[string, string]> = [
  ['quítale el fondo a esta imagen', 'remove_bg'],
  ['quita el fondo', 'remove_bg'],
  ['pon la imagen sin fondo', 'remove_bg'],
  ['recórtala sin fondo', 'remove_bg'],
  ['remove the background please', 'remove_bg'],
  ['hazla con fondo transparente', 'remove_bg'],
  ['saca un fotograma del último segundo', 'extract_frame'],
  ['dame el último frame del clip', 'extract_frame'],
  ['extrae el primer frame del video', 'extract_frame'],
  ['captura el fotograma de los 4 segundos', 'extract_frame'],
  ['save the last frame as an image', 'extract_frame'],
  ['get a frame at second 3', 'extract_frame'],
  ['necesito una voz para ver cómo suena', 'create_voice'],
  ['clona mi voz', 'create_voice'],
  ['quiero que el personaje hable con mi voz', 'create_voice'],
  ['crea una voz para la narradora', 'create_voice'],
  ['make a voice for her so I can hear it', 'create_voice'],
  ['clone my voice', 'create_voice'],
  ['hazme tres vistas de este personaje: frontal, lateral y trasera', 'reference_sheet'],
  ['una vista lateral de la casa', 'angle'],
  ['vista frontal del producto', 'angle'],
  ['three views of her: front, side and back', 'reference_sheet'],
  ['dame un ángulo diferente de esta escena', 'angle'],
  ['hazme tres vistas de este personaje, una imagen por vista', 'angle'],
  ['dame múltiples ángulos de esta escena', 'angle'],
  ['hazme una hoja de contacto de esta escena', 'contact_sheet'],
  ['seis ángulos de la misma escena', 'contact_sheet'],
  ['pásala a 4K', 'upscale'],
  ['sube la resolución a 4K', 'upscale'],
  ['upscale this image to 8k', 'upscale'],
  ['adapta esta imagen a 9:16', 'reframe'],
  ['quiero otro aspecto para esta imagen', 'reframe'],
  ['cambia la imagen en formato para instagram', 'reframe'],
  ['pásala a formato de historia de instagram', 'reframe'],
  ['make it 9:16 for tiktok', 'reframe'],
  ['dame un ángulo de vista diferente', 'angle'],
  ['give me a different angle', 'angle'],
  ['show me this from another angle', 'angle'],
  ['súbela a 4K', 'upscale'],
  ['make it 4k', 'upscale'],
  ['sube la resolución del video', 'video_upscale'],
  ['join these clips', 'join_clips'],
  ['junta estos videos', 'join_clips'],
  ['cambia la luz a atardecer', 'relight'],
  ['hazle una character sheet', 'reference_sheet'],
];

// Each operation gets its own hard negatives: the word or a close one appears, nothing is requested.
const NEGATIVES: string[] = [
  // remove_bg
  'el fondo de la playa es precioso',
  'una historia sobre un perro que quiere quitarse el miedo',
  'pon un fondo de bosque detrás de ella',
  'el fondo es oscuro y triste en la historia',
  'la foto del fondo de pantalla es bonita',
  // extract_frame
  'in this frame of mind she feels calm',
  'un frame de madera para el cuadro',
  'el marco de la foto es dorado',
  'the picture frame is gold',
  'un fotógrafo toma una foto del mar al amanecer',
  // create_voice
  'tiene una voz muy dulce y tranquila',
  'la voz del narrador es importante en el cuento',
  'the narrator\'s voice is calm in the story',
  'su voz temblaba al final del discurso',
  'crea un personaje que tenga voz de niña',
  // angle
  'me gusta la vista desde mi ventana',
  'la vista al mar desde la terraza',
  'the angle of the sun on the water is beautiful',
  'el ángulo de la mesa es perfecto',
  'una vista de pájaro sobre el pueblo',
  // relight
  'con un fondo azul pastel y luz suave',
  // upscale: 4K as a subject of a new image is not a request to upscale
  'genera un paisaje en 4K de montañas al amanecer',
  // reframe: a post for Instagram is a new image, not a change of format
  'haz un post para instagram de mi cafetería',
  'genera una imagen 16:9 de un castillo',
  // a new image that uses a photo as reference is not an edit or a relight of it
  'Usa esta foto como referencia: una chica en un café con iluminación cálida',
  'genera una imagen nueva de una chica con luz suave',
  // unrelated
  'una historia de un fotógrafo que viaja al sur',
];

describe('phrases a user would type name their operation', () => {
  for (const [text, op] of POSITIVES) {
    it(`"${text}" → ${op}`, () => {
      expect(detectOps(text)).toContain(op);
    });
  }
});

describe('phrases where the word appears but nothing is requested name no operation', () => {
  for (const text of NEGATIVES) {
    it(`"${text}"`, () => {
      expect(detectOps(text)).toEqual([]);
    });
  }
});
