/*
 * When a turn really fails (five rounds without a plan or an answer) the notice says what blocked it, why and how to
 * go on, in the user's words, with a short code. It reads the last rejection the app returned to the agent in this turn
 * (a local variable of the loop, nothing is stored); a normal flow step (Auto confirming settings itself) is no rejection.
 */

/** The texts the app sends back to the agent when it refuses a call. */
const REJECTION = /^(Not (shown|confirmed|loaded)|Invalid |Plan rejected|Unknown (model|tool)|Question rounds|Guided mode:|The node canvas has)|works only|work only|No (video|image) model is available/;

/** The rejection text, or undefined when this result is no refusal. */
export const rejectionOf = (content: string): string | undefined => (REJECTION.test(content) ? content : undefined);

const GENERAL = 'El agente no pudo terminar esta petición tras varios intentos. Vuelve a pedirla con otras palabras o elige otro modelo.';

/** The notice for a turn that ended without a result; `last` is the last rejection of the turn, if any. */
export function stoppedText(last: string | undefined): string {
  const t = last ?? '';
  const length = /(?:were asked, but |^Not confirmed: (?!\d+ s were asked))(.+?) (?:makes clips of|takes) at most (\d+) s/.exec(t);
  if (length) return `No pude preparar el plan: ${length[1]} admite hasta ${length[2]} s por clip. Elige varios clips u otro modelo y vuelve a pedirlo. Código: DURACION`;
  if (/Unknown model|No (video|image) model is available/.test(t)) return 'No pude preparar el plan: el modelo o proveedor indicado no existe o no está conectado. Nómbralo de otra forma o elige otro modelo y vuelve a pedirlo. Código: MODELO';
  if (/^Not shown: .*(settings|confirm_settings)|^Guided mode:/.test(t)) return 'No pude preparar el plan: faltan los ajustes del modelo. Confírmalos o elige el modelo en el compositor y vuelve a pedirlo. Código: AJUSTES';
  if (/Plan rejected|Invalid propose_plan/.test(t)) return 'No pude preparar el plan: no pasó la validación. Pídelo con menos pasos o con otras palabras. Código: PLAN';
  if (/works only|work only|The node canvas has/.test(t)) return 'No pude hacer eso aquí: es una acción de otro lienzo (nodos o Diseñador). Cambia de lienzo o pídelo en el chat. Código: CANVAS';
  return `${GENERAL} Código: GENERAL`;
}
