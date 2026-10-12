# Plan: Designer fluido (2026-10-12)

Plan único acordado por el usuario con revisiones de Claude y GPT. **Las revisiones futuras lo enmiendan en la sección «Enmiendas»; no se reabre desde cero.** Contexto y medidas: [historial 025](history/025-2026-10-W42.md), entradas 1 y 2.

## Objetivo y aceptación

Dibujar, seleccionar y mover se sienten inmediatos. Tests verdes o un guardado más rápido no bastan: el plan se cierra con pruebas de interacción y con la prueba del usuario. Si no se alcanza, sigue abierto; un cambio de arquitectura o lenguaje solo se propone si la medida muestra cálculo pesado (no arregla copias, lecturas de GPU ni renders de más).

| Medida (build de producción, sandbox) | Umbral al cierre del plan |
|---|---|
| Trabajo del hilo principal por fotograma al pintar o mover, p95 | ≤ 8 ms |
| Puntero → píxel visible, p95 | ≤ 1 fotograma (16,7 ms) |
| Tareas > 50 ms durante el gesto y en el segundo tras pulsar o soltar | 0 |
| Casos | habitual (sandbox: 12,6 MB, 555 sesiones) y exigente (capa de 300 trazos largos, 1 000 sesiones sintéticas) |

- El banco sintético mide trabajo interno y regresiones. Que un evento se procese o que corra `requestAnimationFrame` no prueba que el píxel ya se vea: la latencia visible se valida con arrastres reales.
- Cada etapa demuestra su mejora y que no hay regresiones; el umbral completo se exige al cerrar el plan.

## Diagnóstico

| Candidato | Estado |
|---|---|
| Guardado: `fetch` con texto de 12 MB | Corregido (928 → ~1 ms, commit `ba7d214`) |
| Guardado: texto para IndexedDB (41 ms) + `put` (64 ms) | Medido en el sandbox (dev) → etapa 1 |
| Recuadro raster al pulsar o arrastrar | Corregido según las pruebas anteriores (61,6 → ~3 ms, `26a97f0`); pendiente de validar en el banco final |
| Bloqueo de 40–56 ms tras cada pulsación en Edit | Medido en desarrollo; atribución a React pendiente → etapa 2 |
| PNG de la capa 700 ms tras cada trazo (`canvasToBlob`, `raster.ts` `writeLayer`) | Sin medir; sospechoso de leer la GPU en el hilo principal → etapa 2 |
| 12 MB por guardado: todas las sesiones en un documento | Estructural → etapa 3 (ADR 0014) |
| `paintStrokes` sin límite (1,2 MB en una capa) | Estructural → etapa 3 (límite raster) |

## Etapas

### 0. Banco reproducible — aprobada (2026-10-12)
- **Modo producción del sandbox:** el sandbox sirve la build de producción en el **mismo puerto 5183 y con `.sandbox/data`** ([dev-sandbox.mjs](../scripts/dev-sandbox.mjs), contrato `sandbox`; salvaguardas intactas). Otro puerto con los mismos datos está prohibido.
- **Sonda en la página:** envía gestos a 60 Hz y registra el trabajo por fotograma, las tareas largas y la latencia de cada evento.
- **Casos:** el habitual y el exigente, con datos sintéticos del sandbox.
- **Validación visible:** arrastres reales, que hace otro modelo con agent-browser.

### 1. Guardado sin bloqueo y visible — 1-A aprobada (2026-10-12)

**A. Blob en IndexedDB bajo una clave nueva**
- La clave de texto `ogs-app` no se escribe ni se borra.
- Lectura: se comparan las dos copias del navegador y la del disco con la regla actual de `idb.ts` (`savedAt` + `baseAt`). Una copia rechazada se conserva aparte (`:conflict-*`).

**B. No construir el texto de 12 MB:** depende de A.

**C. Acuse real del disco:** `disk.setState` y `setBlob` devuelven ok, error o 409. Hoy `setBlob` no mira `res.ok`.

**D. Estado versionado**
- Cada cambio sube una versión.
- «Guardado» solo si la versión confirmada es la última y no queda raster pendiente, en IndexedDB y en el disco si está activo.
- Un cambio hecho durante un guardado deja el estado en «sin guardar».
- 409: «Otra pestaña guardó cambios · recargar». Reintentar nunca sobrescribe.
- Disco no configurado: «Guardado en este navegador».
- Disco configurado que deja de responder: error visible, nunca «Guardado».

**E–G. Para el usuario**
- Indicador en la barra superior.
- Ctrl+S (contrato `shortcuts`: Ajustes y README en el mismo commit).
- Aviso al cerrar si hay algo pendiente. Depende del navegador: no protege frente a un cuelgue.

**Esperado:** ~45 ms por guardado. Es la medida previa, no una garantía; se vuelve a medir.

### 2. Camino de interacción (requiere el banco)
- **Bloqueo tras pulsar:** atribuirlo y recortarlo (suscripciones o memoización de Stage, Propiedades y Capas).
- **PNG por trazo:** medirlo y, si bloquea, sacarlo del hilo principal o del gesto.
- **Resto:** cualquier otra tarea > 50 ms que muestre el banco.

### 3. Estructura (autorizaciones separadas)
- **Límite raster.** Al llegar al límite la capa se aplana una vez y se sigue pintando en ella; una capa nueva vuelve a tener trazos editables. Requisitos:
  - aviso previo y Ctrl+Z en un paso;
  - píxeles exactos al aplanar;
  - una opción para quitar el límite, con advertencia;
  - umbral por trazos y segmentos, fijado midiendo;
  - las capas antiguas por encima del límite no se aplanan sin confirmación dentro de la app.
- **ADR 0014:** guardar solo la sesión que cambió (pendiente de aprobación).

## Lo que no se toca
- `baseAt`, el rechazo 409, las copias, el rechazo de pérdida masiva, `X-OGS-Automated` y el acceso solo local.
- `data/` real, migraciones o borrados (la clave antigua se queda), la frecuencia del guardado y el guardado al ocultar o cerrar.
- Trazos editables, deshacer y exportar. Sin `confirm()` nativo.

## Comprobación por etapa
- **Tests existentes:** `persist-json`, `state-conflict` (servidor real), `idle-save`, `save-max-wait`, `raster-persist`, `store-server`, `automated-write`, `check-safeguards`.
- **Tests nuevos de la etapa 1:**
  - las tres copias: iguales, distintas o ausentes;
  - vuelta a una versión anterior: lee su texto; si escribe en disco recibe 409 y su copia se conserva;
  - un cambio durante el guardado no se marca «Guardado»;
  - 409, HTTP 500 y servidor caído;
  - raster pendiente.
- **Contratos del mapa** en el mismo commit: `persist-json-exact`, `shortcuts` y `sandbox`.
- **Cierre de cada etapa:** `npm run test:related` y `npm test`, build, y banco antes y después en los dos casos.

## Reparto
- **GPT:** implementa.
- **Claude:** pruebas rápidas y verificación.
- **Otro modelo:** pruebas de interacción con agent-browser.

## Enmiendas
- 2026-10-12, GPT: banco sintético ≠ latencia visible; umbral completo al cierre, no por etapa; etiquetas de estado corregidas (incorporado arriba).
- 2026-10-12, GPT (etapa 0): la sonda sintética informa la unión de handlers y callbacks RAF como mínimo observado, no CPU total; el siguiente RAF no es píxel visible. Certificar esos umbrales necesita además el perfil nativo y los gestos reales del agente verificador. Por la memoria disponible, `test:related` limita Vitest a dos workers; no se ejecutan suites en paralelo.

- 2026-10-12, usuario: GPT prepara el banco e instrucciones; no ejecuta agent-browser ni arrastres reales. Comparación antes/después reservada al agente verificador ([instrucciones](fluidez-pruebas.md)); las cifras permanecen pendientes, sin sustituirlas por medidas de desarrollo.

- 2026-10-12, GPT: el directorio opcional de build se valida antes de compilar/servir; no puede ser el proyecto, un ancestro, `data/`, sus copias, `.sandbox/` ni un enlace simbólico. Esto protege los datos también al comparar una build externa.
