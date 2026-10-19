# Propuesta v5: Spaces separados de los Workspaces

Fecha: 2026-10-18. Estado: **propuesta y plan, sin implementar**. Base: `task/agent-stop` en `3e7c553`. Sustituye a la v4 del mismo día.

Esta versión incorpora las dos revisiones anteriores y cierra los dos puntos que quedaban: los resultados de texto sin activo (transcripciones) y la guarda de hidratación de Home y del Space. También fija el presupuesto de tamaño de `jobs.ts` y el contrato de `toolSeed`.

## Qué pidió el usuario

El usuario creó un modelo 3D en el espacio Image, recargó la app y lo vio en el chat de Studio. Además, la app abrió en Studio y no en la última pestaña. Lo calificó de «crítico» y «grave».

En la conversación que siguió fijó el enfoque:

- **Workspaces** (Studio, Canvas, Designer) y **Spaces** (Create y Tools) son grupos distintos.
- En un Space se genera muchas veces «y que no se pierda nada». No hacen falta sesiones: basta con ver lo creado en la galería, con sus datos, y reutilizarlo.
- Cada generación lleva **lugar y modo**, para filtrar y contar. El tipo se escribe (`image`, `video`…) y no se deduce de la extensión.
- Un historial de prompts de texto, con favoritos que no se borran.
- **Library muestra todo** y puede filtrar por lugar y modo.
- **Abrir un resultado muestra solo el resultado**, sin cargar ninguna sesión.

## Causa comprobada

Comprobado leyendo el código de `task/agent-stop` en `3e7c553`.

1. **Create y Tools escriben en la sesión del chat.**
   - `generateDirect` usa `st.activeSessionId` ([actions.ts:285](../src/engine/actions.ts#L285)).
   - `runAssetOp` usa la sesión del activo de origen ([actions.ts:686](../src/engine/actions.ts#L686)).
2. **El tablero de los Spaces no separa nada.** En Studio su alcance por defecto es la sesión; en Create y Tools es `'all'`, todo ([SpaceBoard.tsx](../src/components/space/SpaceBoard.tsx)). El `kind` del tablero ya es un filtro del usuario en `'all'`; `activeKind` solo elige el objetivo de las acciones.
3. **Ninguna generación dice dónde se creó.**
   - `origin` dice cómo se lanzó (`composer`, `agent`, `op`, `node`, `designer`), no dónde.
   - Ya existe una noción de lugar para navegar: `canvasIndex` ([canvas.ts](../src/engine/canvas.ts)) y `generationPlace`/`goToGeneration` ([goTo.ts](../src/engine/goTo.ts)). Deduce el workspace de la sesión, y `goToGeneration` **cambia la sesión activa**.
4. **El espacio abierto no se guarda.** `ui.space`, `toolOp`, `toolAsset`, `homeTab` y `home` no están en `partialize` ([store.ts:420](../src/store/store.ts#L420)). `composer.mode` sí se guarda.
5. **Los resultados de texto no tienen activo.** Una transcripción es `kind: 'text'` con `assetIds: []` y el texto en `Generation.text` ([types.ts:300](../src/engine/types.ts#L300), [jobs.ts:748](../src/engine/jobs.ts#L748)). `splitBoard` solo llena Done con activos ([boardModel.ts:28](../src/components/space/boardModel.ts#L28)) y Library lista activos ([GalleryPanel.tsx](../src/components/gallery/GalleryPanel.tsx)). Hoy una transcripción terminada no sale ni en el tablero ni en Library.

No hay pérdida de datos ni mezcla entre sesiones distintas.

## Decisiones

### 1. Dos campos nuevos: `place` y `mode`

- **Valores de `place`:** `studio`, `canvas`, `designer`, `space-create` o `space-tools`.
- **Valores de `mode`:**
  - en Create y en el compositor: `image`, `video`, `audio`, `model3d` o `agent`;
  - en Tools: el tipo de la pestaña (el que usa `ToolsSpace`, `OPS[op].input`), con la operación en el `op` que ya existe.
- **Dónde se guardan:** en `Generation` y en `Asset`. Son opcionales, porque lo anterior no los tiene.
- **Cuándo se fijan:** al crear la generación o el activo, y no cambian después.
- **Generaciones derivadas** (reintento, variantes, «mejorar plano», pasos de un plan del agente, cola): copian `place` y `mode` de la generación o del plan de origen. **No** se deducen de la pantalla abierta en ese momento.
- **Activos sin generación** (subidas, frames, exportaciones): llevan el lugar donde se crearon y `mode` si se conoce; si no, quedan «Sin modo». Los antiguos quedan «Sin lugar».

### 2. Qué se ve en cada sitio

| Sitio | Muestra |
|---|---|
| Chat y tablero de Studio | Lo de Studio y lo antiguo (sin `place`), como hoy; nunca lo de los Spaces |
| Tablero de Create | Todo lo de `space-create`, de cualquier tipo de salida, incluidos los textos; el tipo es un filtro del usuario (por defecto, todos) |
| Tablero de Tools | Todo lo de `space-tools`, igual; una transcripción o un frame extraído también salen |
| Library y Generations | **Todo**: activos y generaciones de texto. Abiertos desde Home o un Space, el alcance por defecto es «All sessions»; en Studio sigue «This session». Con filtros Lugar y Modo con contadores, junto al de tipo. Lo antiguo sale en «Sin lugar» |

Ejemplos de filtro: `place: space-create` + `mode: image`; `place: space-tools` + `op: upscale`.

### 3. Contenedor interno, sin sesiones visibles

- Un solo contenedor para Create y Tools, que es una sesión marcada con `hidden: true` o una marca equivalente. Se filtra por esa marca, no comparando ids.
- No aparece en las listas de sesiones, ni en Home, ni en el buscador, ni en los contadores.
- No se crea con `newSession()`, porque esa función cambia la sesión activa y cerraría el Space (`homeAutoClose`).
- No se guarda su id: se encuentra por la marca. Si no existe, `ensureSpaceSession()` lo crea vacío.
- Lo que contiene nunca se borra solo. En esta versión no hay una acción para vaciarlo; el contenedor crece con lo que el usuario crea, como una galería.
- El visor, la fila de Generations y la información de la generación muestran el nombre del Space («Create» o «Tools»), nunca el título del contenedor.

### 4. Abrir un resultado

- Desde Library, Generations o el tablero, un resultado de un Space **abre solo el visor** de ese resultado.
- Si es un activo, el visor actual (`lightbox`). Si es texto, un visor de texto nuevo.
- No cambia la sesión activa, no abre el contenedor ni cambia de espacio.
- Hoy `goToGeneration` selecciona la sesión. Para lo creado en Spaces, el clic en la miniatura y el botón «Go» de Generations abren el visor. Lo de los Workspaces sigue como hoy.

### 5. «Reusar»

- Está en los resultados creados en Spaces: en su tablero y en Library. En Studio no.
- Abre el Space correspondiente con prompt, modelo, parámetros, referencias y modo cargados.
- Si algo ya no es válido, carga el resto y avisa de qué quedó fuera: modelo desaparecido, parámetro que ya no existe, activo borrado.
- **En Create**, rellena `composer` y cambia `composer.mode`.
- **En Tools**, los parámetros viven en estado local (`useOpRun`, [opRun.tsx](../src/components/assets/opRun.tsx)). Se añade `ui.toolSeed` con `{ generationId, assetId, parentId?, op, params, modelRef? }`. `ToolsPanel` lo observa con un efecto, lo aplica a `useOpRun` y lo borra; así funciona también con el Space ya abierto. Se borra al aplicar, al cerrar el Space y al desmontar.
- **En Tools con un resultado de texto** (transcripción), el activo de origen es `g.op.sourceAssetId`; no hay activo de resultado. Si el origen ya no existe, se ofrece copiar el texto o usarlo como prompt, no Reusar.
- Si el resultado no tiene un destino válido (por ejemplo, un texto del agente sin operación), «Reusar» no aparece.

### 6. Historial de prompts (solo Create en esta versión)

- Dos listas: **200 recientes** sin repetidos, que descartan los más antiguos, y **favoritos con estrella**, que nunca se borran solos. Al llegar a 1000 favoritos se avisa y no se borra nada.
- Un prompt se guarda al lanzar Generate, no al teclear. Repetir un prompt lo mueve al principio; no se duplica.
- Solo texto, sin ajustes asociados (para los ajustes completos está «Reusar»).
- Se recorre con ↑/↓ solo cuando el cursor está en la primera o la última línea, para no estorbar al escribir, y con un desplegable que tiene una pestaña de favoritos.
- **Almacenamiento:** una base IndexedDB propia, `ogs-prompts`, solo en el navegador, sin copia en disco. Se puede borrar sin afectar a nada más. Para que «borrar todos los datos» también la borre, se añade su nombre a `ALL_DB_NAMES` ([idb.ts:107](../src/lib/idb.ts#L107)).
  - **El usuario autorizó este cambio en la zona protegida el 2026-10-18.** Solo ese cambio: añadir el nombre a la lista y su test. Cualquier otro cambio en la zona protegida requiere una autorización nueva.
- Tools no tiene historial en esta versión: no tiene un único campo de prompt.

### 7. Recordar el espacio al recargar

Se guardan `home`, `homeTab`, `space`, `toolOp` y `toolAsset`. `composer.mode` ya se guardaba.

- Al cargar, si `toolAsset` ya no existe, se descarta.
- Si `home` y `space` vienen a la vez, se descarta `home`: los dos no se muestran juntos.
- **Trampa:** `installHomeAutoClose` ([homeGuard.ts](../src/components/shell/homeGuard.ts)) se instala en `main.tsx` antes de hidratar el store. Al hidratar cambia `activeSessionId` y el guardia cerraría Home y el Space restaurados. Hace falta una guarda de hidratación: al pasar a `hydrated`, tomar como referencia **`last` y `spaceWas`** del estado hidratado, no antes. Re-basar solo `last` haría que el primer cambio de sesión posterior no cerrara el Space.

### 8. Sin migración

Lo existente no se mueve ni se etiqueta. Lo que no tiene `place` sale como «Sin lugar» y sigue donde se ve hoy.

## Etapas

Decidido por el usuario el 2026-10-18: se implementa en dos etapas, cada una con su rama, sus tests y `npm test` en verde.

- **Etapa 1, la separación** (rama `task/space-session-1`). Arregla el fallo reportado. Pasos del plan: 1 (tamaño), 2 (tipos), 3 (cálculo de `place`/`mode`), 4 (contenedor), 5 (vistas), 7 (abrir solo el visor), 10 (persistencia y guarda de hidratación) y 11 (contrato), más los filtros Lugar y Modo de Library y Generations, y sus tests y docs. No toca la zona protegida ni crea interfaz nueva.
- **Etapa 2, las comodidades** (rama `task/space-session-2`, sale de la 1 cuando la 1 esté aceptada). Pasos 6 (resultados de texto), 8 («Reusar» y `toolSeed`) y 9 (historial de prompts y favoritos, con el cambio autorizado en `ALL_DB_NAMES` y su revisión independiente), y sus tests y docs.

Hasta la etapa 2, una transcripción de Tools sigue sin salir en el tablero, como hoy.

## Plan

Se hace en un worktree propio por etapa (`task/space-session-1`, luego `task/space-session-2`), que sale de `task/space-plan`. Nada de datos reales: solo `.sandbox/data` y el puerto 5183.

### 1. Presupuesto de tamaño, antes que nada

`check-sizes` impide que estos archivos crezcan. Cifras actuales y margen:

| Archivo | Ahora | Límite o línea base | Margen | Qué añade |
|---|---:|---:|---:|---|
| `src/store/store.ts` | 29 955 | 30 000 | 45 | `toolSeed`, `textView` y la proyección de `ui` |
| `src/engine/types.ts` | 37 280 | 37 306 | 26 | `place`/`mode` en dos interfaces, `hidden`, import |
| `src/engine/jobs.ts` | 67 373 | 67 471 | 98 | `GenerationSpec`, copia en `createGeneration`, activo |
| `src/engine/actions.ts` | 40 520 | 40 714 | 194 | dos puntos de lanzamiento y el import |
| `src/engine/retryPartial.ts` | 2 084 | 30 000 | 27 916 | `retrySpec` |

Primero se hace sitio sin cambiar el comportamiento:

- `store.ts`: mover la proyección de `ui` de `partialize` a `src/store/persistUi.ts` (`pickUi(s.ui)` y el tipo `PersistedUi`). La línea actual es larga; sustituirla deja margen para `toolSeed` y los campos nuevos.
- `types.ts`: los tipos nuevos van en `src/engine/placeTypes.ts`, pero el import y los campos también ocupan unos 120 bytes. Hay que condensar unos 100 bytes de comentarios de `types.ts`.
- `jobs.ts`: los campos del spec, su copia en `createGeneration` y en el activo suman unos 150 bytes. Sacar la copia a un módulo no elimina los campos del spec ni la llamada; el ahorro tiene que venir de condensar. Medir después de cada sitio.
- `actions.ts`: los dos puntos de lanzamiento y la función de lugar; medir.
- `retryPartial.ts`: `retrySpec` copia `place` y `mode`; sobra espacio.

Medir con `node scripts/check-sizes.mjs` después de cada paso. Las cifras de crecimiento son estimaciones; la única prueba es el script.

### 2. Tipos y datos

- `src/engine/placeTypes.ts`: `Place`, `Mode`, `PLACE_LABEL`, `MODE_LABEL`. Sin imports.
- `types.ts`: `place?: Place`, `mode?: Mode` en `Generation` y `Asset`; `hidden?: boolean` en `Session`.
- `jobs.ts`: `place?` y `mode?` en `GenerationSpec`; copiarlos en `createGeneration`.
- `retryPartial.ts`: copiarlos en `retrySpec`.
- Revisar el formato guardado y los tests de `formatV2`/`persistJson`; los campos son opcionales, así que no hay migración.

### 3. Cálculo en el punto de lanzamiento

`src/engine/place.ts`:

- `placeFor(ui, workspace)`: `space-create`, `space-tools`, `canvas`, `designer` o `studio`.
- `modeFor(ui, composerMode, op?)`: el modo del compositor; en Tools, el tipo de la pestaña.
- `placeLabel(g)`: «Create», «Tools», «Studio», «Canvas» o «Designer», para el visor y Generations.

Se llama en:

- `generateDirect` (Create, compositor, nodo, Designer);
- `runAssetOp` (Tools; el llamador pasa el lugar y el modo; SketchEditor y `improveShot` pasan Studio);
- `runLayerOp` (Designer);
- `executor.ts` y el plan del agente (Studio, `mode: agent`);
- `uploadFiles` y las exportaciones (lugar donde se crean; modo si se conoce);
- `retrySpec`, variantes e `improveShot` (copian, no deducen).

### 4. Contenedor

`src/store/spaceSession.ts`:

- `isSpaceSession(s)`: `s.hidden === true`.
- `ensureSpaceSession()`: busca una sesión marcada; si no existe, añade una con `createSession`, título «Spaces», `hidden: true` y `titleLocked: true`, **sin** tocar `activeSessionId`.
- `visibleSessions(sessions)`: la lista que usan Sidebar, Home, Sessions y el buscador, sin la marcada.
- `generateDirect` y `runAssetOp` usan el contenedor cuando `ui.space` está abierto; el resto sigue con la sesión activa o la del activo.
- El contenedor no se borra solo. `deleteSession` no se expone para él.

### 5. Vistas

- `SpaceBoard`: recibe `place` y muestra solo ese lugar (más el filtro de tipo del usuario). El alcance por defecto sigue `'all'`; el `place` es el que separa.
- `Studio`: el chat y el tablero siguen con la sesión activa; se añade el filtro para excluir `space-*` si el tablero se pone en «all».
- `CreateSpace` y `ToolsSpace` pasan `place` al tablero y conservan su `activeKind` para elegir el objetivo de las acciones; `activeKind` no filtra las filas.
- `GalleryPanel`: alcance por defecto `'all'` cuando `ui.home || ui.space`; `'session'` en Studio.
- `GenerationsPanel`: mismo criterio de alcance por defecto.
- Listas de sesiones: usan `visibleSessions`; también los contadores y las recientes de Home.

### 6. Resultados de texto

Sin esto, la transcripción no aparece y el test no puede pasar.

- Extraer el bloque de texto de `GenerationCard` ([GenerationCard.tsx:241](../src/components/chat/GenerationCard.tsx#L241)) a `src/components/assets/TextResult.tsx`, con copiar, usar como prompt y letras; `GenerationCard` lo reutiliza sin cambiar su comportamiento.
- `SpaceBoard`: `DoneCell` gana `{ type: 'text'; generationId }`; `splitBoard` añade las generaciones `kind: 'text'` con estado `done`; la fila Done las pinta con `TextResult` compacto. El filtro de favoritos no las incluye (no tienen activo que marcar).
- `GalleryPanel`: en la pestaña Generated, unir activos y generaciones de texto en una sola lista ordenada por fecha. El filtro de tipo gana `text`; Lugar y Modo cuentan ambos. Las tarjetas de texto no se arrastran, no entran en la selección múltiple y no se borran desde Library en esta versión.
- `GenerationsPanel`: una fila de texto abre el visor de texto; el botón «Go» de un resultado de Space también.
- Visor: `ui.textView: string | null` (id de generación, no persistido) y `src/components/assets/TextLightbox.tsx`, que muestra `TextResult` y la información. `Esc` cierra; no cambia de sesión. No se reutiliza `ui.lightbox`, que es de activos.
- Reusar un texto: si tiene `op`, usar `op.sourceAssetId`; si no, solo copiar o usar como prompt.

### 7. Abrir resultados

Un helper `openGeneration(g, assetId?)`:

- si `place` es `space-*`: activo → `ui.lightbox`; texto → `ui.textView`; nunca `selectSession`;
- si no: el comportamiento actual (`goToGeneration` o visor).

`GenerationInfo` y las filas de Generations usan `placeLabel(g)` para los Spaces; nunca el título del contenedor.

### 8. «Reusar»

`src/store/reuse.ts` o `src/engine/reuse.ts`:

- Create: `setComposer` con modo, texto, modelo, ajustes y referencias; `setUi({ space: 'create', home: false, panel: null })`; validar modelo, parámetros y activos; avisar de lo descartado.
- Tools: `setUi({ space: 'tools', toolOp: g.op.id, toolAsset: g.op.sourceAssetId, toolSeed: { ... } })`.
- `useOpRun` acepta un `seed` opcional y lo aplica una vez; `ToolsPanel` limpia `toolSeed` después.
- Sin destino válido, no se muestra el botón.

### 9. Historial de prompts

`src/lib/promptHistory.ts`:

- `idb-keyval` con `createStore('ogs-prompts', 'kv')`; una clave por Space (`create` en esta versión).
- `{ recents: string[], favorites: string[] }`; 200 recientes, sin repetidos; favoritos sin tope duro; aviso a 1000.
- `recordPrompt(text)`, `toggleFavorite(text)`, `loadPromptHistory()`.
- `'ogs-prompts'` en `ALL_DB_NAMES`; test de que «borrar todos los datos» la borra.
- `src/components/space/PromptHistory.tsx`: desplegable con pestaña de favoritos; ↑/↓ en los extremos del textarea de `SpacePanel`.
- `SendDirect` acepta un `onLaunch` opcional; Create lo usa para guardar el prompt; Studio no lo pasa.

### 10. Persistencia y guarda de hidratación

- `src/store/persistUi.ts`: `PersistedUi` y `pickUi` con `home`, `homeTab`, `space`, `toolOp`, `toolAsset`. `toolSeed` no se persiste.
- `store.ts`: usar `pickUi`; `Persisted.ui` pasa a `PersistedUi`.
- Al hidratar: validar `toolAsset`; si no existe, borrarlo; si `home` y `space` vienen juntos, borrar `home`.
- `installHomeAutoClose`: mientras `!hydrated`, actualizar `last` y `spaceWas` y salir; al primer estado hidratado, fijar ambos y salir. Después, el comportamiento actual.
- Test: tras recargar en Create, cambiar de sesión sigue cerrando el Space; tras recargar en Home, navegar a un workspace cierra Home.

### 11. Contrato y mapa

`scripts/map-contracts.mjs` gana un contrato `space-place` (quien escribe `place`/`mode` ↔ filtros, visor y Reusar) y otro `space-container` (creación con `hidden` ↔ listas que lo ocultan). Regenerar con `node scripts/map.mjs --write`.

### 12. Tests

Cada uno debe fallar con el código de ahora.

- Create escribe `place: space-create` y su modo; Studio no lo muestra.
- Tools sobre un activo de Studio escribe `space-tools` y va al contenedor.
- Un reintento, una variante, `improveShot` y un paso del agente conservan `place`/`mode` de origen aunque la pantalla abierta sea otra.
- Studio sigue mostrando lo antiguo (sin `place`).
- Library muestra todo; Lugar y Modo filtran y cuentan; lo antiguo sale en «Sin lugar».
- El tablero de Tools muestra una transcripción (audio → texto) y el de Create un vídeo del agente.
- Abrir un resultado de un Space no cambia `activeSessionId`; un texto abre `ui.textView`.
- «Reusar» rellena Create; en Tools se consume una sola vez, también con el Space abierto; avisa de un parámetro, un modelo o un activo que ya no existen.
- Historial: tope de 200, sin repetidos, favoritos que nunca se descartan, aviso a 1000 y borrado con «borrar todos los datos».
- Al recargar se restauran `home`, `homeTab`, `space`, `toolOp` y `toolAsset`; Home y el Space no se cierran al hidratar; después, un cambio de sesión sí cierra el Space; `toolAsset` inválido se descarta.
- El contenedor no aparece en listas, Home, buscador ni contadores; crearlo no cierra el Space.
- El visor y Generations muestran «Create» o «Tools», no el título del contenedor; «Go» abre el visor.

### 13. Docs

- `features/create-space.md`, `features/studio.md` y `features/biblioteca.md`.
- Una ADR nueva que enmiende la [0017](decisions/0017-espacios-panel-y-tablero.md), con Estado, Fecha, Contexto, Decisión, Alternativas y Consecuencias.
- Una entrada de historial.
- Enlazar la ADR, el historial y esta propuesta desde [docs/README.md](README.md); `check-docs` lo exige.
- `persistencia-protegida.md`: una fila con el cambio autorizado en `idb.ts` y la revisión independiente pendiente antes de fusionar.

### 14. Verificar

- `npm run test:related` tras cada cambio.
- Al final: `npm run typecheck`, `node scripts/check-sizes.mjs` y `npm test -- --maxWorkers=2`.
- Prueba visual en el sandbox: una generación en Image con el modelo local gratuito si existe; si no, la de pago aprobada. Recargar, comprobar que sigue en Image y que Studio no la muestra, verla en Library con los filtros, probar «Reusar», el visor, el texto y los favoritos. Después detener el sandbox.
- No se arranca la app real, no se toca `data/` y no se fusiona ni se hace push.

## Límites y riesgos

- **Zona protegida:** solo el cambio autorizado en `ALL_DB_NAMES`. La regla 5 pide además revisión independiente: el diff de `idb.ts` y su test se entregan aparte para que el usuario los pase a un revisor externo antes de fusionar. Cualquier otro cambio en `idb.ts`, `disk.ts`, `writerLock.ts`, el servidor o `flushWrite`/`saveNow` se para y se pregunta.
- **Coste:** primero el modelo local gratuito. Si no existe, el agente propone un modelo concreto barato y un coste máximo, y espera aprobación explícita. Sin aprobación, la prueba visual se hace sin esa generación y se dice así.
- **Datos:** nada se migra ni se borra.
- **Historial:** vive solo en el navegador; borrar los datos del sitio lo pierde. Es una comodidad, no un dato crítico.
- **Contenedor:** crece sin límite y no hay una acción para vaciarlo en esta versión. No se borra solo.
- **Texto:** el visor y las tarjetas de Library son nuevos; no existían y hay que probarlos también en el sandbox.
- **Tamaño:** los márgenes de `types.ts` y `jobs.ts` son pequeños; el orden del plan (hacer sitio primero) no es opcional.

## Por qué

### Por qué separar Spaces y Workspaces

Porque el usuario los usa de forma distinta. Un Workspace es una conversación con estado (agente, plan, borradores); un Space es un taller de generación repetida. Mezclarlos hacía que un modelo 3D creado en Image apareciera en el chat de Studio y que el Space se perdiera al recargar. Separarlos por `place` y por contenedor resuelve las dos cosas sin cambiar el modelo de sesiones que ya usan el agente y los canvas.

### Por qué un contenedor oculto y no una sesión visible

Porque el resto de la app espera una sesión para las generaciones, pero el usuario no quiere gestionar sesiones en un Space. Un contenedor marcado reutiliza toda la maquinaria (feed, activos, generaciones) sin añadir una sesión a las listas. La marca `hidden` es mejor que comparar un id guardado: sobrevive a que el contenedor se recree y no deja huérfanos visibles. No se crea con `newSession()` porque esa función cambia la sesión activa y el guardia cerraría el Space.

### Por qué guardar `place` y `mode` en vez de deducirlos

Porque `canvasIndex` deduce el lugar de la sesión y del feed, y eso es navegación, no historia: cambia si el resultado se mueve, si la sesión se renombra o si el feed se poda. El usuario quiere filtrar y contar lo que se hizo, y eso exige un dato fijo en la generación. `origin` no basta: dice cómo se lanzó, no dónde; y `mode` no siempre coincide con `kind` (una transcripción es `text` pero se lanzó en Audio; un frame extraído es `image` pero se lanzó en Vídeo). Las generaciones derivadas copian el dato en vez de volver a mirar la pantalla, porque un reintento o un paso del agente puede terminar cuando el usuario ya está en otro sitio.

### Por qué el visor y no `goToGeneration`

Porque `goToGeneration` selecciona la sesión del resultado. Para un resultado de Space eso abriría el contenedor oculto como si fuera un chat de Studio. El usuario pidió «abrir un resultado muestra solo el resultado»; el visor lo hace sin cambiar de sesión ni de espacio. Para los Workspaces se conserva `goToGeneration`, que es lo que el usuario ya conoce.

### Por qué los textos también

Porque «que no se pierda nada» incluye una transcripción, y una transcripción no tiene activo. Si el tablero y Library solo listan activos, el resultado desaparece justo cuando termina. La solución es una tarjeta de texto y un visor de texto, no fingir que el texto es una imagen. Es la misma razón por la que el historial de prompts es solo texto: son datos que el usuario quiere recuperar, no ajustes.

### Por qué el historial en su propia base

Porque 200 prompts recientes y hasta 1000 favoritos pueden ocupar cerca de 1 MB, y el estado principal se serializa en cada guardado. Meterlos ahí haría más lento cada guardado y mezclaría una comodidad con los datos críticos. Una base propia, sin copia en disco, mantiene el guardado protegido intacto; añadir su nombre a `ALL_DB_NAMES` es lo único necesario para que «borrar todos los datos» también la borre.

### Por qué la guarda de hidratación

Porque el guardia existente cierra Home y el Space cuando cambia la sesión activa, y al hidratar la sesión activa cambia siempre (la sesión inicial es nueva). Sin una guarda, restaurar `home` o `space` sería inútil: se cerrarían en el mismo instante. La guarda no debilita el cierre automático; solo mueve la referencia al estado ya hidratado. Hay que re-basar `last` **y** `spaceWas`: si solo se re-basa `last`, el primer cambio de sesión posterior no cerraría el Space.

### Por qué no hay migración

Porque etiquetar o mover lo existente es una operación irreversible sobre datos del usuario y no hace falta para arreglar el caso reportado. Lo antiguo se queda donde está y sale como «Sin lugar»; los filtros nuevos lo muestran y el usuario puede seguir usándolo. Una migración, si algún día se quiere, va en una propuesta aparte con aprobación explícita.

### Por qué el presupuesto de tamaño va primero

Porque `check-sizes` es una puerta dura: `store.ts` tiene 45 bytes libres, `types.ts` 26 y `jobs.ts` 98. Añadir campos antes de hacer sitio hace fallar `npm test` y empuja a recortar deprisa y mal. Mover la proyección de `ui` a un módulo y condensar comentarios es un cambio sin comportamiento que deja margen para el cambio real.

### Alternativas descartadas

- **Una sesión visible por Space.** Descartada: vuelve el problema de las listas y no es lo que pidió el usuario.
- **Deducir `place` de `canvasIndex`.** Descartada: es navegación, cambia con el tiempo y no distingue Create de Tools.
- **Guardar el id del contenedor.** Descartada: se rompe si el contenedor se recrea y obliga a validar un id que no aporta nada; la marca `hidden` es la fuente de verdad.
- **Meter el historial en el estado principal.** Descartada por tamaño y por coste de serialización.
- **Copiar el historial al disco.** Descartada: exigiría una ruta nueva en el servidor y tocar la zona protegida para una comodidad.
- **Migrar lo antiguo.** Descartada: riesgo de datos y fuera del alcance.
- **Usar el título de la sesión oculta en el visor.** Descartada: filtra la existencia del contenedor y confunde; se muestra el nombre del Space.
- **Generar de pago sin aprobación.** Descartada por la regla de coste de `AGENTS.md`.

## Cambios respecto a la v4

- **Textos:** se añaden tarjetas y visor de texto, y Library mezcla activos y generaciones de texto. Es el hueco que impedía cumplir «no se pierda nada» y el test de la transcripción.
- **Guarda de hidratación:** se re-basan `last` y `spaceWas`, no solo la clave; se añade el test de que después de recargar un cambio de sesión sigue cerrando el Space.
- **`toolSeed`:** se define su forma, incluido el activo de origen y el `parentId`, y se aclara que se limpia al aplicar y al cerrar.
- **`jobs.ts`:** el presupuesto ya estaba; se aclara que sacar la copia a un módulo no ahorra por sí solo y que hay que condensar.
- **Library/Generations:** se concreta que el alcance por defecto depende de `ui.home || ui.space`.
- **Textos y Reusar:** se define que una transcripción se reutiliza desde `op.sourceAssetId`, no desde un activo de resultado.

## Evidencia

Revisión de código y medición de tamaños sobre `task/agent-stop` en `3e7c553`. No se ha implementado nada ni se han ejecutado tests; las cifras de crecimiento son estimaciones y la prueba real es `node scripts/check-sizes.mjs` en cada paso.

Referencias principales: [actions.ts](../src/engine/actions.ts), [jobs.ts](../src/engine/jobs.ts), [types.ts](../src/engine/types.ts), [store.ts](../src/store/store.ts), [homeGuard.ts](../src/components/shell/homeGuard.ts), [SpaceBoard.tsx](../src/components/space/SpaceBoard.tsx), [boardModel.ts](../src/components/space/boardModel.ts), [GalleryPanel.tsx](../src/components/gallery/GalleryPanel.tsx), [GenerationsPanel.tsx](../src/components/shell/GenerationsPanel.tsx), [goTo.ts](../src/engine/goTo.ts), [canvas.ts](../src/engine/canvas.ts), [opRun.tsx](../src/components/assets/opRun.tsx).
