# 0029 — Recorredor de interfaz: la máquina busca a lo ancho, solo lo confirmado se fija

## Estado

Aceptado

El usuario aceptó el enfoque el 2026-11-07. Sin implementar: falta la orden de empezar el bloque 1. La conversación completa, con lo que se pidió, lo que se entendió y las correcciones, está en el [historial 060](../history/060-2026-11-W45-recorredor.md).

## Fecha

2026-11-07

## Contexto

- **Lo que pide el usuario.** Un script, enlazado a un árbol de funciones real por área (Designer, Studio, Nodes), que pruebe la app en varios tamaños, despliegue cada menú y popup, ejecute cada acción y tome capturas. Que señale lo mal ubicado, cortado o lento, y lo que se cuelga, con líneas, logs, lugares y capturas. Sin gastar tokens y sin complejidad añadida. Después, el usuario revisa cada caso, lo repite aislado y decide si se repara, se rediseña o se diagnostica mejor.
- **Por qué hace falta.** Hay bugs antiguos que nadie detectó porque no hay pruebas de estrés ni nada que recorra la interfaz. El usuario hace ese recorrido a mano y no termina nunca. Un menú lejos de su botón es un fallo aunque ambos funcionen: rompe la accesibilidad y esconde otros fallos hasta que alguien prueba justo ese punto.
- **Lo que ya existe** (`task/plus-center`, inventario del 2026-11-07):
  - Inventarios de controles con archivo:línea en `docs/designer-controles/`, `docs/nodes-controles/` y `docs/studio-controles/`.
  - Atributos `aria-haspopup`/`aria-expanded` en `src/`: 116 apariciones en 81 líneas.
  - El hook `window.__OGS_TEST__`, 14 specs de Playwright contra el sandbox, `designer-monkey` y la sonda `src/lib/trace` (tareas largas en `trace.ts:136`).
- **Lo que falta.** Ningún recorrido de la interfaz. La sonda no recoge errores de consola ni excepciones. `designer-monkey` comprueba el guardado en cada paso (unos 4 s por acción). `npm test` no está en verde: `bubble-text`, `fx-render` y `ui-single-slider` fallan siempre, y `writer-lock-panel` y `path-boolean` fallan solo con toda la batería.
- **Fuentes estudiadas:**
  - Krita: `TestUtil::checkQImage` (tolerancia por canal y píxeles).
  - GEGL: `gegl-tester` (hash del buffer).
  - Blender: render tests (informe HTML y lista de tests no deterministas).
  - Skia Gold: aprobación humana de referencias.
  - Gentle-AI: su ODD («Organic-Driven Development»), con proporcionalidad, tests de caracterización y estado decidido por script.

## Decisión

### El punto medio

1. **La búsqueda amplia la hace la máquina.** El recorredor y la prueba de estrés corren en segundo plano, sin el usuario y sin tokens, y producen un **informe**. El informe no bloquea la entrega.
2. **Solo lo confirmado se fija.** El usuario revisa el informe y repite el caso aislado. Si se confirma y se arregla, ese bug recibe **una** prueba de regresión.
3. **Sin capturas de referencia mientras la interfaz cambie.** Con los rediseños en curso (caja de herramientas, «+»), cientos de referencias se romperían cada semana. Vuelven cuando haya una versión estable.
4. **Herramientas estándar antes que código propio.** Se usan Playwright, `@axe-core/playwright` y el vídeo y la traza de Playwright. Solo es propio lo que ninguna herramienta trae: el recorrido guiado por el árbol, las recetas de estado y la comprobación de «menú lejos de su botón o cortado».

### Reglas de seguridad (desde el bloque 1)

- Solo en el sandbox, puerto 5183. Si está ocupado se espera; al terminar se detiene. Nunca sobre `data/` ni la app real.
- **Red cortada por código.** Playwright aborta toda petición que no vaya a `localhost:5183`, lo que corta las llamadas directas a los proveedores, que son las que cuestan. También bloquea las descargas.
- **Rutas del sandbox que salen a internet, bloqueadas también.** El servidor del sandbox reenvía `/x/atlas-static` (static.atlascloud.ai) y `/x/fal-web` (fal.ai) en `vite.config.ts:10-16`, y por `/x/media` reenvía descargas, solo de los servidores de `src/lib/mediaHosts.ts` (`vite.config.ts:23-30`; véase [seguridad](../seguridad.md)). Esas rutas pasan por localhost, así que el primer corte no las detiene. Se aborta todo `/x/*` salvo `/x/store/` (el almacén local, `server/local-store.js:413`). Con las dos reglas no sale nada a la red.
- Lista de acciones prohibidas: gastar, descargar, usar la red y abrir diálogos del sistema. Lo destructivo solo se hace sobre documentos de prueba del sandbox.
- Los hallazgos de contraste de axe sobre los temas son **avisos**. Los temas son identidad protegida ([AGENTS.md](../../AGENTS.md), regla 6): ningún color cambia sin aprobación.
- La captura de errores de la sonda solo está encendida por defecto en el sandbox (`VITE_OGS_SANDBOX`), para no ralentizar la app real.

### Bloques (30–45 min cada uno; estimaciones sin medir)

| Bloque | Qué hace | Qué toca |
|---|---|---|
| 1. Batería en verde | Arreglar o poner en cuarentena con motivo y fecha los 3 fallos fijos. Antes, investigar `writer-lock-panel` y `path-boolean`, que fallan con carga: son una pista, no ruido. | Esos tests o su código; lista de cuarentena con su comprobación en `npm test`. Solo vitest: sin navegador ni sandbox. Para reproducir los fallos por carga, `scripts/flaky-probe.mjs` corre al menos 2 baterías completas, o esos dos tests junto a los más pesados; correrlos aislados no aporta, porque solos pasan. La comprobación importa `PROTECTED_TESTS` de `scripts/check-protected.mjs:7` en vez de copiar la lista. |
| 2. Recorredor de Designer | Árbol desde los inventarios. Con 3–4 recetas de estado (sin selección, raster con pincel, objeto vectorial, texto), abre cada menú y popup y toma captura. Comprueba con axe, menú lejos o cortado, Escape y foco, errores de consola y tareas largas. Informe. | `playwright.config.ts` (nuevo: red cortada, traza y vídeo solo si falla); `tests-e2e/recorrido/` (nuevo); `scripts/recorrido-*.mjs` (árbol e informe); script `recorrido` y devDependency `@axe-core/playwright` en `package.json`. |
| 3. Acciones y estrés | Pulsa cada acción permitida, con captura antes y después y tiempo medido. Lo intermedio lo registran la traza y el vídeo. `designer-monkey` en modo rápido: comprueba el guardado cada N pasos y al final; si falla, repite el último tramo paso a paso para ubicar la acción. Guarda captura y traza cuando un paso pasa del umbral. | `tests-e2e/recorrido/`; `tests-e2e/designer-monkey.spec.ts`; captura de errores en `src/lib/trace` solo en el sandbox. |
| 4. Studio y Nodes | El mismo recorredor con sus recetas. | `tests-e2e/recorrido/`. |

Tras cada bloque el usuario mira el resultado y decide si se sigue. Después se valorará añadir más tamaños y la escala de texto al 150 % y 200 %. Se usará el ajuste de escala de la app si existe; si no, la fuente base, porque la interfaz usa `rem`.

### Modo de trabajo (para no gastar cuota)

- **Escribir, lanzar y detenerse.** Cada ejecución larga (sandbox, Playwright, batería) se lanza en segundo plano. El agente se detiene y el sistema lo despierta cuando el proceso termina. Mientras espera no gasta tokens.
- **Resúmenes cortos.** Cada script escribe un resumen de pocas líneas (pasa o falla, archivo:línea, ruta del detalle). El agente lee solo ese resumen. Los logs completos quedan en disco, y el agente solo los abre si el resumen no basta.
- **Tope de ciclos.** Cada test o comprobación tiene como máximo **2 ciclos** de calibración. Si después no queda resuelto:
  - si no es protegido, va a cuarentena con fecha;
  - si es protegido, queda diagnosticado.

  En ambos casos se anota y se sigue.

### Qué entrega

En `.recorrido/<fecha>/`, carpeta ignorada por git:

- `report.html`: primero los estados con fallos y los que cambiaron desde la ejecución anterior, cada uno con su captura y los fallos marcados.
- `resultados.json`: cada fallo con control, área, receta, tamaño, archivo:línea, mensaje o log, captura y, si falló, traza y vídeo.
- **De dónde sale el archivo:línea.** Cada botón de la app se empareja con su fila del inventario por **nombre accesible**. Si varios controles comparten nombre, en el bloque 2 se les añade `data-control` para distinguirlos. El archivo:línea viene del inventario, así que hereda sus errores. Por eso el informe comprueba que el archivo exista y que la línea contenga el control, y marca **«línea dudosa»** cuando no coincide, en vez de señalarla como cierta.
- La lista de **deriva**: controles que están en la app y no en el inventario, y al revés, emparejados por nombre accesible o `data-control`.

## Cómo sabremos si funcionó

Umbrales propuestos; el usuario puede ajustarlos tras el primer informe.

- **Alcance.** El recorredor abre al menos el 80 % de los controles del inventario de Designer con las recetas del bloque 2. Lo no alcanzado aparece nombrado, nunca como «sin fallos».
- **Utilidad.** Encuentra al menos un fallo real que no conocíamos.
- **Ruido.** Menos de 1 de cada 5 hallazgos revisados resulta falso.
- **Estabilidad.** Dos ejecuciones seguidas dan la misma lista de fallos estructurales (posición, corte, tamaño, foco). Los tiempos se comparan con margen.
- **Coste.** Designer completo en menos de unos 10 minutos de máquina, y el usuario revisa un informe en menos de unos 15 minutos.

**Qué haremos después:**

- **Si sale bien:** cada fallo confirmado se arregla y recibe una prueba. El recorredor se ejecuta antes de cada entrega y tras cada rediseño, y se extiende a Studio y Nodes.
- **Si sale mal:**
  - Con ruido, se retira o afina la comprobación ruidosa.
  - Con poco alcance, se añaden recetas.
  - Si es inestable, se para y se informa; no se sube la tolerancia para que pase.
  - Si no encuentra nada nuevo, se revisa qué comprueba antes de seguir invirtiendo.

## Alternativas

- **Recorredor completo con capturas de referencia desde el principio.** Descartado: en alfa cada rediseño rompería cientos de referencias, y el trabajo se iría en aprobar diferencias.
- **Piloto de pinceles con referencias primero.** Aplazado. No arregla nada actual; vuelve justo antes de volver a tocar el motor de pinceles. La semilla ya se guarda en el trazo (`brushStroke.ts:47-48`), así que un trazo guardado se reproduce igual.
- **Comparador propio con `pixelmatch`.** Descartado: `toHaveScreenshot` de Playwright y unas líneas propias bastan cuando vuelvan las referencias.
- **Que el usuario siga recorriendo la app a mano.** Descartado: es interminable y no deja rastro reproducible.

## Consecuencias

- Avanza el punto 6 de la [0010](0010-estrategia-de-pruebas.md) (recorridos en el navegador sobre el sandbox, sin gasto). Esta decisión no cambia las pruebas de la 0010.
- La persistencia protegida no se toca: sigue siendo lo único que bloquea por sí solo.
- Requiere `@axe-core/playwright` como devDependency. El usuario lo aprueba antes del bloque 2.
