# Línea base del agente — paso 1

Fecha: 2026-10-04. Lectura local, sin llamadas de proveedor ni gasto.

Ejecutar desde el worktree: `node scripts/agent-baseline.mjs`.
El [script](../scripts/agent-baseline.mjs) lee exclusivamente `.sandbox/data/state.json`,
rechaza otras rutas y enlaces simbólicos, no escribe estado y devuelve JSON con
métricas numéricas y etiquetas fijas. No exporta conversaciones, identificadores,
errores ni credenciales. Los [tests](../tests/agent-baseline.test.ts) cubren
estadísticas, campos ausentes, salida sin texto privado y rechazo de rutas.
Los backups no se combinan con el estado actual para evitar duplicar muestras.
Para analizar una copia autorizada, colocarla previamente en el sandbox; el script
no copia ni lee el almacén real.

## Resultado observado

1 sesión; **0 peticiones con métricas** en el sandbox. No hay línea base suficiente.
Cada celda de duración indica mediana / p90 / porcentaje >30 s. Todos los campos
ausentes y todas las estadísticas sin muestras son `desconocido`, nunca cero.

| Modelo | Tipo de sesión | n | Primera salida (ms) | Primer texto visible (ms) | Respuesta terminada (ms) |
| --- | --- | ---: | --- | --- | --- |
| DeepSeek | nueva | 0 | desconocido | desconocido | desconocido |
| DeepSeek | continuación | 0 | desconocido | desconocido | desconocido |
| DeepSeek | desconocido | 0 | desconocido | desconocido | desconocido |
| GPT Luna | nueva | 0 | desconocido | desconocido | desconocido |
| GPT Luna | continuación | 0 | desconocido | desconocido | desconocido |
| GPT Luna | desconocido | 0 | desconocido | desconocido | desconocido |

Para ambos modelos y cada tipo: llamadas, inputTokens, outputTokens, cachedTokens,
coste LLM y trabajo del agente tienen **0 muestras**; mediana y p90 desconocidos.
El grupo de modelo desconocido también tiene 0 muestras.

## Límites del formato existente

- [AgentRequestMetrics](../src/engine/types.ts) no persiste nueva/continuación.
  No se infiere del orden: se conservan como máximo 50 peticiones por sesión.
- [metrics.ts](../src/engine/agent/metrics.ts) acumula trabajo activo en `agentMs`;
  no mide el momento de finalización de una respuesta ni las esperas del usuario.
- [runtime.ts](../src/engine/agent/runtime.ts) marca `msToFirstOutput` al llegar
  texto o una llamada de herramienta. No garantiza texto visible.
- [llm.ts](../src/engine/providers/llm.ts) también asigna `outputMs` a fragmentos
  de herramientas. No se usa como sustituto del primer texto visible.
- `callTimings` conserva 12 llamadas. cachedTokens solo se suma cuando están
  todas las llamadas y cada una tiene ese campo; de otro modo es desconocido.
- Tokens y llmUsd son los acumuladores existentes. El runtime usa cero cuando
  falta usage: los datos históricos no distinguen ese caso de un cero real.
  llmUsd puede proceder de precio de catálogo: no demuestra coste cobrado.
- Las etiquetas agrupan familias DeepSeek y GPT Luna, no variantes exactas.
  No permiten aceptar una comparación causal control/aviso ni por configuración.

No se verificaron latencias reales, caché del proveedor ni el intervalo 12–30 s.
Este paso no genera muestras nuevas ni modifica la instrumentación del runtime.
