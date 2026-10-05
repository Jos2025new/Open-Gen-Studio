import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNKNOWN = 'desconocido';
const number = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const families = ['DeepSeek', 'GPT Luna', UNKNOWN];
const kinds = ['sesión nueva', 'continuación', UNKNOWN];

export function statistics(values, duration = false) {
  const known = values.map(number).filter((v) => v !== null).sort((a, b) => a - b);
  const n = known.length;
  return {
    conocidas: n, desconocidas: values.length - n,
    mediana: n ? (known[Math.floor((n - 1) / 2)] + known[Math.floor(n / 2)]) / 2 : UNKNOWN,
    p90: n ? known[Math.ceil(n * 0.9) - 1] : UNKNOWN,
    ...(duration ? { porcentajeMayor30s: n ? 100 * known.filter((v) => v > 30_000).length / n : UNKNOWN } : {}),
  };
}

// Whitelist numeric telemetry only. Never return request text, IDs, errors, feed or settings.
export function extractBaseline(saved) {
  const state = saved?.state ?? saved;
  const sessions = Object.values(state?.sessions ?? {});
  const requests = sessions.flatMap((s) => (Array.isArray(s.agentMetrics) ? s.agentMetrics : []).map((m) => {
    const engine = typeof m.engine === 'string' ? m.engine.split(' · ')[0] : '';
    const model = /deepseek/i.test(engine) ? 'DeepSeek' : /gpt.*luna/i.test(engine) ? 'GPT Luna' : UNKNOWN;
    const timings = Array.isArray(m.callTimings) ? m.callTimings : [];
    const calls = number(m.llmCalls);
    const cached = calls !== null && calls > 0 && timings.length === calls && timings.every((t) => number(t.cachedTokens) !== null)
      ? timings.reduce((sum, t) => sum + t.cachedTokens, 0) : null;
    return {
      modelo: model,
      tipo: UNKNOWN, // Not persisted; order is unreliable because only the last 50 requests are retained.
      primeraSalidaMs: number(m.msToFirstOutput) ?? UNKNOWN,
      primerTextoVisibleMs: UNKNOWN, // outputMs also includes tool fragments.
      respuestaTerminadaMs: UNKNOWN, // No request completion timestamp is persisted.
      trabajoAgenteMs: number(m.agentMs) ?? UNKNOWN,
      llamadas: calls ?? UNKNOWN,
      inputTokens: number(m.inputTokens) ?? UNKNOWN,
      outputTokens: number(m.outputTokens) ?? UNKNOWN,
      cachedTokens: cached ?? UNKNOWN,
      costeLlmUsd: number(m.llmUsd) ?? UNKNOWN, // Recorded cost may be estimated, not billed.
    };
  }));
  const fields = ['primeraSalidaMs', 'primerTextoVisibleMs', 'respuestaTerminadaMs', 'trabajoAgenteMs', 'llamadas', 'inputTokens', 'outputTokens', 'cachedTokens', 'costeLlmUsd'];
  return {
    sesiones: sessions.length, muestras: requests.length,
    suficiente: false,
    limites: [
      'Sin clasificación persistida de sesión nueva/continuación; no se deduce del orden.',
      'Primera salida incluye texto o herramienta; primer texto visible y respuesta terminada son desconocidos.',
      'agentMs es trabajo acumulado, excluye espera del usuario; llmUsd puede ser estimado.',
      'callTimings conserva hasta 12 llamadas; agentMetrics hasta 50 peticiones por sesión.',
      'Los acumuladores de tokens/coste usan cero cuando falta usage; no permiten distinguir ausencia de un cero real.',
      'No demuestra comparación control/aviso, ni distribución por tipo o por variante exacta de modelo.',
    ],
    peticiones: requests,
    grupos: families.flatMap((modelo) => kinds.map((tipo) => {
      const samples = requests.filter((r) => r.modelo === modelo && r.tipo === tipo);
      return { modelo, tipo, muestras: samples.length,
        metricas: Object.fromEntries(fields.map((field) => [field, statistics(samples.map((r) => r[field]), field.endsWith('Ms'))])) };
    })),
  };
}

export async function readSandboxBaseline(root, input = '.sandbox/data/state.json') {
  const expected = resolve(root, '.sandbox/data/state.json');
  if (resolve(root, input) !== expected) throw new Error('Solo se permite .sandbox/data/state.json; no se lee data/ ni backups.');
  // Reject symlinks at every sandbox boundary before opening the file.
  for (const part of ['.sandbox', '.sandbox/data', '.sandbox/data/state.json']) {
    if ((await lstat(resolve(root, part))).isSymbolicLink()) throw new Error('Sandbox con enlace simbólico: lectura rechazada.');
  }
  if (await realpath(expected) !== resolve(await realpath(root), '.sandbox/data/state.json')) throw new Error('Sandbox fuera del worktree.');
  return extractBaseline(JSON.parse(await readFile(expected, 'utf8')));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  readSandboxBaseline(process.cwd(), process.argv[2]).then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch(() => { console.error('Línea base no disponible: ruta insegura, estado ausente o formato inválido. No se imprimen datos de entrada.'); process.exitCode = 1; });
}
