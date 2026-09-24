export type Lang = 'es' | 'en';

const ES_HINTS = [
  ' el ', ' la ', ' los ', ' las ', ' una ', ' un ', ' de ', ' del ', ' con ', ' para ', ' que ', ' por ',
  ' imagen', ' imágenes', ' video', ' crea', ' haz', ' quiero', ' genera', ' foto', ' fondo', ' estilo',
  ' cartel', ' póster', ' también', ' y ', ' en ', ' sobre ', ' más ', ' muy ',
];

/** Cheap language guess used by the offline planner (Spanish vs English). */
export function detectLang(text: string): Lang {
  const t = ` ${text.toLowerCase()} `;
  if (/[ñáéíóúü¿¡]/.test(t)) return 'es';
  let score = 0;
  for (const h of ES_HINTS) if (t.includes(h)) score++;
  return score >= 2 ? 'es' : 'en';
}
