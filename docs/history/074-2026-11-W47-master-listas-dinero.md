# 074 · Listas cerradas, una vía de cableado y núcleo del dinero (sesión maestra 6, 2026-11-21/22)

Rama `task/listas-cerradas` (worktree `ogs-listas`), fusionada en `main` (`37c8a395`) y subida con el sí del usuario. Neon y Sonnet: «fusionable sí». Evidencia, no estado actual.

## Fusionado
- **Que añadir sea solo registrar (punto 1 de 073), casi entero:**
  - **Listas cerradas, una definición cada una** (`2ea13ed8`, `2f413cd9`): tipos de sistema (`BASE_SYSTEM_NODE_TYPES`, `SYSTEM_ADD_TYPES`), clases de nodo, de enlace, modos de adjunto y `MEDIA_KINDS`. Los `z.enum` derivan de las tuplas; los tests fijan cada lista.
  - **Puertos creativos una sola vez** (`0541c7f3`): `CREATIVE_LINK_PORTS`, compartido por `allNodePorts` y `LinkHandles`.
  - **Una vía de cableado** (`20ac15f8`, `9e0910c5`): lienzo, `nodes.edge.connect` y `nodes.system.link` pasan por `resolveWiring` + `applyEdit`. `inferReplaces` solo en la interfaz y solo con un ocupante sin fijar. Costó tres rondas de Sol (ver lecciones).
  - **Interfaz por tipo de nodo** (`f9ec5f14`, `4d793b89`): el menú «Add node» y la biblioteca leen `NODE_UIS`, con iconos de `KIND_ICON`. Vitest ahora corre `tests/**/*.test.tsx`: `descriptor-ui-registry` nunca se había ejecutado.
  - **Reglas de hooks de React en `npm test`** (`a578777d`): oxlint, `rules-of-hooks` bloquea y `exhaustive-deps` avisa (~70 avisos).
  - **Guía** [como-se-anade](../como-se-anade.md): comando, nodo, puerto, cableado, panel y envío de pago, cada uno con su comprobación.
  - **A medias:** los paneles no tienen envoltorio de nodo (queda para «Todo es un nodo»); los nodos de sistema siguen en `spec.ts`, fuera de `defineNode`.
- **Núcleo del dinero (punto 2 de 073), casi entero:**
  - **Una puerta antes de cada transporte de pago** (`eaa4cc06`): `commitPaidSend` guarda la intención y vuelve a comprobar aborto y autorización. Un aborto a mitad sin id remoto deja el envío `uncertain` y el trabajo `lostJob`.
  - **`purgeDiscarded`** (`0cd5f92c`, `db45ed79`) conserva la generación de una sesión borrada mientras tenga trabajo remoto activo o un rastro de cobro sin cerrar.
  - **LLM y presupuesto** (`d225c676`, `abe5cbbc`, `0e2585f7`, `131515b3`, `c463454a`): las llamadas LLM respetan el tope del usuario. Al pasarlo, «Continue once» desbloquea una acción o un turno del agente, con pase propio que no lee ni gasta el de otra acción. Las llamadas gratis nunca paran. El contador muestra el exceso («$12 of $10 · +$2 over»).
  - **Ataques:** Hydrogen diagnosticó, Neon convirtió los hallazgos en 9 rojos (`5a4d8a7b`), Sonnet atacó dos veces (14 verdes y 5 rojos en `25854e87`; 3 verdes y 1 rojo en `5ed826e4`), todos arreglados. GPT revisó el diagnóstico, no el código: sin cuota.
  - **Abierto:** el gasto de un lote recargado sin precio y las aprobaciones solo en memoria.
- **`npm test`:** 1925 pasan, 1 fallo esperado y 2 omitidos (254 archivos), antes del último arreglo `c463454a`. Tras él, solo check-all y los tests relacionados.

## Prueba en sandbox (Haiku como usuario nuevo)
Bus `20261122-haiku-nodos.md`. Bien: el menú encuentra «song» y «glb» por descripción; Texto → Imagen conecta; Ctrl+Z deshace un movimiento. Mal: los nodos nuevos se apilan en el centro; Imagen → Vídeo no conectó en 4 intentos, sin mensaje de rechazo; el composer flotante tapa las salidas; no se encuentra cómo conectar un modelo.

## Lecciones (retrospectivas de Neon y Sonnet sobre el transcript)
Fuentes: bus `20261122-neon-retro-master6.md` y `20261122-sonnet-retro-master6.md`.
1. **«Hecho» = un check en `npm test` que falla si se rompe.** El test `.tsx` invisible y las listas duplicadas lo muestran.
2. **El brief lleva consumidores (grep), intocables y casos que atacará el revisor.** Faltaron en listas y cableado y causaron rondas extra.
3. **Orden fijo:** implementa → ataca → corrige → re-ataca → un solo `npm test`. No se pide fusión con commits sin atacar ni se ofrece saltarse al revisor.
4. **Cada hallazgo dice si es heredado o nuevo.**
5. **No se borran comentarios para pasar `check-sizes`:** un archivo cerca del límite se divide antes. `llmTurn.ts` quedó en 29 993 B.
6. **Workers:** 4 de 11 corridas de Neon se cortaron sin informe; el brief exige informe desde el minuto 1. Comprobar cuota y plan B antes de lanzar. Sonnet no implementa: gasta la cuota de la sesión.
7. **Comunicación:** breve, parte de una línea cada ≤10 min, sin preguntar lo ya ordenado. «Tope del usuario» y «crédito del proveedor» son cosas distintas.

## Pendiente, en orden (sustituye a la lista de 073)
La lista vigente es la del bus `20261122-master6-orden-prioridad.md` (cruce de Neon, Sonnet y el orquestador):
- **Crítico:** un solo veredicto de presupuesto en `budget.ts`; lock de nodo en `runInNodes` (ver si `abe5cbbc` lo cerró); lote recargado sin precio nunca cuenta $0.
- **Alto:** checks de disciplina (todo test corre, literal de medio fuera de `types.ts` falla, tamaño avisa al 90%); enums de medio literales → `MEDIA_KINDS`; una tabla para los nodos de sistema; dividir `llmTurn.ts`.
- **Medio:**
  - **Cierre de plan y «Continue once», decidido por el usuario (2026-11-22):** el resumen del plan vuelve a preguntar, con una opción «no volver a preguntar». La misma opción está en settings, junto al tope de gasto, sin enredar los settings. Con «no preguntar» activo, se pregunta una vez (al pasar el tope) y el resumen ya no vuelve a preguntar. La pregunta es tan sencilla como en cualquier app de su tipo.
  - **Aprobaciones al recargar, decidido por el usuario (2026-11-22): lo convencional.** Al recargar nunca se envía nada sin el usuario (fail-closed, como hoy). El envío pendiente sigue a la vista como «esperando aprobación» y se aprueba de nuevo con un clic. Lo ya enviado al proveedor sigue su curso, como en ComfyUI o Midjourney.
  - Nodos apilados y handles ≥24 px; `exhaustive-deps` en `src/components/node` como error; `it.fails` sin dueño.
- **Después:** 073 puntos 3 a 7 (14 dudas de interfaz, vista por espacio en sandbox, «Todo es un nodo», subnet, agentes de suscripción).
