# 072 · Arrastre con 200 nodos y registro durable de envíos (sesión maestra 4, 2026-11-20/21)

Ramas `task/drag200` y `task/envios-durables`, fusionadas en `main` con el sí del usuario. Evidencia, no estado actual.

## Arrastre (puntos 1 y 2 de 071)
- **Diseño:** durante el gesto las posiciones viven solo en React Flow; al soltar, un único `editPresentation` y un paso de undo. El gesto tiene identidad propia (inicio de React Flow, puntero e ítems): solo su Stop, o el `pointerup`/`blur` del mismo puntero, lo cierra. Flechas de teclado: escritura directa, agrupadas en 700 ms como antes. `useNodeDrag.ts`.
- **Índices por ID** en tarjetas, aristas e historial; `NodeToolbar` solo montada si se ve; suscripciones finas en `CanvasNavigation` y `NodeSide`. Tijeras: solo recalculan el tramo nuevo.
- **Check:** `scripts/check-node-drag.mjs` (en `npm test` vía `check-all`) y un test de conteo: 0 publicaciones del grafo durante el arrastre, 1 al soltar.
- **Medida, build de producción en sandbox (Chrome headless, 3 repeticiones):** 200 en cadena 43 → 52-53 fps (≈30 tareas largas por arrastre → 1-4); 200 sueltas 52-54 → 55-59 fps; 20 sueltas igual (~59). El build de desarrollo exageraba (daba la rama peor en cadena).
- **Prueba visual (Sonnet):** soltar y recargar conserva la posición; blur sin soltar deja la tarjeta donde estaba; tres flechas = un Ctrl+Z.
- **Proceso:** tandas A-G3. B-F fueron parches sobre la inferencia del gesto por lotes y fugaron en cada borde; G cambió la estructura a los eventos de React Flow. Lección: cuando un diseño fuga dos veces, cambiar la estructura.

## Registro durable de envíos (punto 7, diseño C aprobado por el usuario)
- Antes de cada POST facturable: guardado con tope de 8 s; se envía solo si resolvió, hay candado de escritor y no se descarta. Si no: «Not sent … Nothing was charged» + Reintentar. Basta IndexedDB. Persistencia protegida intacta.
- `Generation.sends[]`: registro por solicitud (`intent|sent|done|uncertain`, `remoteJob`, coste y lo anotado). El gasto se anota por solicitud una sola vez (`src/engine/sendLedger.ts`), venga de jobs, recuperación, abort, error o cambio de proveedor. Generaciones antiguas sin `sends`: como antes.
- Todo reenvío de algo incierto pide confirmación (incluidos «Continue once», «Don't ask again», «Retry failed»). Local/gratis no pasa por la puerta. En la vista de Gasto, un lote aparece ahora con una línea por solicitud.
- **Revisiones:** Neon (2/5 → verificación), Opus, GPT; cada hallazgo con un test que fallaba antes.

## Otros
- `SessionsLayout.css`: un comentario roto rompía `vite build` en `main` desde el 2026-11-07 y anulaba en dev la regla `.sess-row .pc-col.num`.

## Pendiente, en orden (próxima sesión maestra; sustituye a la lista de 071)
1. **Descriptor:** frescura, selección, interfaz y contrato (`env`, `sourceHandle`, plano plano con `ownerNodeId`, `DefaultsEnv`) antes del subnet. Plan de 5 commits de GPT con los ajustes de Neon; `out` del espacio → nodos Output explícitos con `out` como respaldo.
2. **Envolver los componentes y el subnet.**
3. **Prueba del usuario con una clave real**, y paso de la app real a `main`.
4. **Agentes de suscripción** (baja prioridad).

Decisiones del usuario abiertas (arrastre): objetivo táctil que desaparece sin `pointerup` ni `blur` (¿descartar o guardar?); multitáctil (hoy se ignora el segundo dedo); `touchcancel`/`pointercancel`. Más la lista de la exploración de Sonnet: barra del marco que tapa su título y la chapita, menú contextual de imagen, vista por espacio al volver, «Ajustar a la vista» con tarjetas de sistema, etiquetas de puertos, plegar marco y undo, marco plegado no seleccionable, «Add node» Upscale/Relight fuera de vista, «y» que cambia tras recargar en Nodes.

Abierto en envíos: proveedor síncrono sin id, aprobaciones solo en memoria, `purgeDiscarded`, LLM fuera de `jobs.ts`; el gasto de un lote recargado sin precio conocido queda estimado.
