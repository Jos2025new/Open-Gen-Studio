# Propuesta: Spaces separados de los Workspaces, con lugar y modo en cada generación

Fecha: 2026-10-18. Estado: **sustituida por la v5** ([propuesta-spaces-v5.md](propuesta-spaces-v5.md)). Se conserva como historial.

Cuarta versión del día. Incorpora dos revisiones de otro agente, sobre `53bf4a3` y `cd38d75`, comprobadas contra el código, y las respuestas del usuario a las decisiones abiertas.

## Qué pidió el usuario

El usuario creó un modelo 3D en el espacio Image, recargó la app y lo vio en el chat de Studio. Además, la app abrió en Studio y no en la última pestaña. Lo calificó de «crítico» y «grave».

En la conversación que siguió, el usuario fijó el enfoque:
- **Workspaces** (Studio, Canvas, Designer) y **Spaces** (Create y Tools) son grupos distintos.
- En un Space se genera muchas veces «y que no se pierda nada». No hacen falta sesiones: basta con ver lo creado en la galería, con sus datos, y reutilizarlo.
- Cada generación lleva **lugar y modo**, para filtrar y contar. El tipo se escribe (`image`, `video`…) y no se deduce de la extensión.
- Un historial de prompts de texto, con favoritos que no se borran.
- **Library muestra todo y puede filtrar por lugar y modo.**
- **Abrir un resultado muestra solo el resultado**, sin cargar ninguna sesión.

## La causa

Se comprobó leyendo el código de `task/agent-stop` (`550eb56`; hasta `53bf4a3` solo cambiaron documentos).

1. **Create y Tools escriben en la sesión del chat.**
   - `generateDirect` usa `st.activeSessionId` (`src/engine/actions.ts:285`).
   - `runAssetOp` usa la sesión del activo de origen (`actions.ts:686`).
2. **El tablero de los Spaces no separa nada.** En Studio su alcance por defecto es la sesión; en Create y Tools es `'all'`, todo (`src/components/space/SpaceBoard.tsx`).
3. **Ninguna generación dice dónde se creó.**
   - `origin` dice cómo se lanzó (`composer`, `agent`, `op`, `node`, `designer`), no dónde.
   - Ya existe una noción de lugar para navegar: `canvasIndex` (`src/engine/canvas.ts`) y `generationPlace`/`goToGeneration` (`src/engine/goTo.ts`). Deduce el workspace (chat, nodo, designer) de la sesión, y `goToGeneration` **cambia la sesión activa**.
4. **El espacio abierto no se guarda.** `ui.space`, `toolOp`, `homeTab` y `home` no están en `partialize` (`src/store/store.ts:422`, `:441`). `composer.mode` sí se guarda.

No hay pérdida de datos ni mezcla entre sesiones distintas.

## Comportamiento acordado

### 1. Dos campos nuevos: `place` y `mode`

- **Valores de `place`:** `studio`, `canvas`, `designer`, `space-create` o `space-tools`.
- **Valores de `mode`:**
  - en Create y en el compositor: `image`, `video`, `audio`, `model3d` o `agent`;
  - en Tools: el tipo de la pestaña, con la operación en el `op` que ya existe.
- **Dónde se guardan:** en `Generation` y en `Asset`. Son opcionales, porque lo anterior no los tiene.
- **Cuándo se fijan:** al crear la generación o el activo, y no cambian después.
- **Generaciones derivadas** (reintento, variantes, «mejorar plano», pasos de un plan del agente, cola): copian `place` y `mode` de la generación o del plan de origen. **No** se deducen de la pantalla abierta en ese momento.
- **Activos sin generación** (subidas, frames, exportaciones): llevan el lugar donde se crearon. Los antiguos quedan «Sin lugar».

### 2. Qué se ve en cada sitio

| Sitio | Muestra |
|---|---|
| Chat y tablero de Studio | Lo de Studio y lo antiguo (sin `place`), como hoy; nunca lo de los Spaces |
| Tablero de Create | Todo lo de `space-create`, de cualquier tipo de salida; el tipo es un filtro del usuario (por defecto, todos), no viene impuesto por el modo |
| Tablero de Tools | Todo lo de `space-tools`, igual (una transcripción o un frame extraído también salen) |
| Library y Generations | **Todo**: en Library y en Generations abiertos desde Home o un Space, el alcance por defecto es «All sessions»; en Studio sigue «This session». Con filtros Lugar y Modo con contadores (como el filtro Canvas que ya existe) junto al de tipo. Lo antiguo sale en «Sin lugar» |

Ejemplos de filtro: `place: space-create` + `mode: image`; `place: space-tools` + `op: upscale`.

### 3. Contenedor interno, sin sesiones visibles

- Un solo contenedor para Create y Tools, que es una sesión marcada con `hidden: true` o una marca equivalente. Se filtra por esa marca, no comparando ids.
- No aparece en las listas de sesiones, ni en Home, ni en el buscador.
- No se crea con `newSession()`, porque esa función cambia la sesión activa y cerraría el Space (`homeAutoClose`).
- Lo que contiene nunca se borra solo.
- No se guarda su id: se encuentra por la marca. Si no existe, `ensureSpaceSession()` lo crea vacío.
- El visor, la fila de Generations y la información de la generación (`GenerationInfo.tsx`) muestran el nombre del Space («Create» o «Tools»), nunca el título del contenedor.

### 4. Abrir un resultado

- Desde Library, Generations o el tablero, un resultado de un Space **abre solo el visor** de ese resultado.
- No cambia la sesión activa, no abre el contenedor ni cambia de espacio.
- Hoy `goToGeneration` selecciona la sesión. Para lo creado en Spaces, el clic en la miniatura y el botón «Go» de Generations abren el visor. Lo de los Workspaces sigue como hoy.

### 5. «Reusar»

- Está en los resultados creados en Spaces: en su tablero y en Library. En Studio no.
- Abre el Space correspondiente con prompt, modelo, parámetros, referencias y modo cargados.
- Si algo ya no es válido, carga el resto y avisa de qué quedó fuera.
- **En Tools**, los parámetros viven en estado local (`useOpRun`, `src/components/assets/opRun.tsx`). Se añade `ui.toolSeed`, un valor de un solo uso que `ToolsPanel` observa con un efecto, aplica y borra; así funciona también con el Space ya abierto. Se borra también al cerrar el Space.

### 6. Historial de prompts (solo Create en esta versión)

- Dos listas: **200 recientes** sin repetidos, que descartan los más antiguos, y **favoritos con estrella**, que nunca se borran solos. Al llegar a 1000 favoritos se avisa y no se borra nada.
- Un prompt se guarda al pulsar Generate, no al teclear.
- Solo texto, sin ajustes asociados (para los ajustes completos está «Reusar»).
- Se recorre con ↑/↓ solo cuando el cursor está en la primera o la última línea, para no estorbar al escribir, y con un desplegable que tiene una pestaña de favoritos.
- **Almacenamiento:** una base IndexedDB propia, `ogs-prompts`, solo en el navegador, sin copia en disco. Se puede borrar sin afectar a nada más. Para que «borrar todos los datos» también la borre, se añade su nombre a `ALL_DB_NAMES` (`src/lib/idb.ts:107`).
  - **El usuario autorizó este cambio en la zona protegida el 2026-10-18.** Solo ese cambio: añadir el nombre a la lista y su test. Cualquier otro cambio en la zona protegida requiere una autorización nueva.
- Tools no tiene historial en esta versión: no tiene un único campo de prompt.

### 7. Recordar el espacio al recargar

Se guardan `home`, `homeTab`, `space`, `toolOp` y `toolAsset`. `composer.mode` ya se guardaba.
- Al cargar, si `toolAsset` ya no existe, se descarta.
- **Trampa:** `installHomeAutoClose` (`homeGuard.ts`) se instala en `main.tsx` antes de hidratar el store. Al hidratar cambia `activeSessionId` y el guardia cerraría Home y el Space restaurados. Hace falta una guarda de hidratación: tomar la clave de referencia después de hidratar, no antes.

### 8. Sin migración

Lo existente no se mueve ni se etiqueta.

## Plan previsto

Se hace en un worktree propio, `task/space-session`, que sale de `task/agent-stop`.

1. **Presupuesto de tamaño, antes que nada.** `check-sizes` impide que estos archivos crezcan:
   - `store.ts`: 29 955 bytes de un límite de 30 000;
   - `types.ts`: 37 280 de 37 306 (su línea base);
   - `actions.ts`: 40 520 de 40 714;
   - `jobs.ts`: 67 373 de 67 471 (aquí viven `GenerationSpec` y `createGeneration`);
   - `retryPartial.ts` (`retrySpec`): medir antes de tocarlo.

   Primero hay que hacer sitio sin cambiar el comportamiento:
   - `store.ts`: mover la proyección de `ui` de `partialize` a un módulo propio (`pickUi(s.ui)`, por ejemplo en `src/store/persistUi.ts`);
   - `types.ts`: los tipos nuevos van en `src/engine/placeTypes.ts`, pero el import y los campos también ocupan (unos 120 bytes), así que hay que condensar unos 100 bytes de comentarios en `types.ts`;
   - `jobs.ts`: los campos y su copia suman unos 150 bytes; hay que sacar a un módulo una función que copie `place`/`mode` del spec a la generación y al activo, o condensar.

   Medir con `node scripts/check-sizes.mjs` después de cada paso. Las cifras de crecimiento son estimaciones.
2. **Confirmar en el código:**
   - todos los sitios que llaman a `createGeneration`, incluidos `jobs.ts:843` (reintento), `retryPartial.ts`, el ejecutor del agente, la cola, las variantes e `improveShot`;
   - los sitios que crean activos sin generación;
   - quién llama a `homeAutoClose` (`src/components/shell/homeGuard.ts`, hacia la línea 41);
   - las listas de sesiones (sidebar, Home, buscador).
3. **Tipos:** `place?` y `mode?` en `Generation` y `Asset`, y la marca del contenedor en `Session`. Revisar el esquema guardado y los tests de formato.
4. **Escritura:** una función única (`src/engine/place.ts`) calcula `place` y `mode` en el punto de lanzamiento: compositor, Create, Tools, nodo, Designer o plan del agente. Las derivadas los copian (paso 2).
5. **Contenedor:** `src/store/spaceSession.ts` con `ensureSpaceSession()`. Crea la sesión marcada sin cambiar la sesión activa. `generateDirect` y `runAssetOp` la usan cuando se lanzan desde un Space.
6. **Vistas:**
   - Studio filtra para quitar `space-*`;
   - el `SpaceBoard` de Create y Tools muestra `space-*`;
   - las listas de sesiones ocultan el contenedor marcado.
7. **Filtros Lugar y Modo con contadores** en `src/components/shell/generationsView.ts` y en Library, reutilizando el patrón del filtro Canvas y del de Sessions.
8. **Abrir:** para resultados con `place: space-*`, Library, Generations y el tablero abren el visor (`lightbox`) sin `selectSession`.
9. **«Reusar»:**
   - en Create, rellena `composer`;
   - en Tools, fija `toolOp` y `ui.toolSeed`, y `ToolsPanel`/`useOpRun` lo consume una vez.
10. **Historial:** `src/lib/promptHistory.ts`, sobre la base `ogs-prompts` (idb-keyval con su propio store), con las dos listas, su tope y el aviso. Añadir `'ogs-prompts'` a `ALL_DB_NAMES` (autorizado). Interfaz: ↑/↓ en los extremos y el desplegable.
11. **Persistir el UI:** `home`, `homeTab`, `space`, `toolOp` y `toolAsset` en `pickUi`. Validar `toolAsset` al cargar. Añadir la guarda de hidratación en `installHomeAutoClose`.
12. **Contrato:** `place` y `mode` conectan a quien los escribe, los filtros, el visor y «Reusar». Añadirlo a `scripts/map-contracts.mjs` y regenerar con `node scripts/map.mjs --write`.
13. **Tests,** cada uno fallando con el código de ahora:
    - Create escribe `place: space-create` y su modo, y Studio no lo muestra.
    - Tools sobre un activo de Studio escribe `space-tools` y va al contenedor.
    - Un reintento y un paso del agente conservan el `place` de origen aunque la pantalla abierta sea otra.
    - Studio sigue mostrando lo antiguo (sin `place`).
    - Library muestra todo; los filtros Lugar y Modo filtran y cuentan; lo antiguo sale en «Sin lugar».
    - Abrir un resultado de un Space no cambia `activeSessionId`.
    - «Reusar» rellena Create, y en Tools se consume una sola vez; avisa de un parámetro que ya no existe.
    - Historial: tope de 200, sin repetidos, favoritos que nunca se descartan, aviso a 1000, y borrado con «borrar todos los datos».
    - Al recargar se restauran `home`, `homeTab`, `space`, `toolOp` y `toolAsset`, y Home o el Space no se cierran al hidratar; un `toolAsset` inexistente se descarta.
    - El tablero de Tools muestra una transcripción (audio → texto); el de Create, un vídeo del agente.
    - «Reusar» desde el tablero de Tools con el Space abierto aplica el seed.
    - El visor y Generations muestran «Create» o «Tools», no el título del contenedor, y «Go» abre el visor.
    - El contenedor no aparece en las listas de sesiones y crearlo no cierra el Space.
14. **Docs:**
    - `features/create-space.md`, `studio.md` y la feature de Library;
    - una ADR nueva que enmiende la 0017;
    - una entrada de historial;
    - enlazar la ADR y la entrada de historial desde `docs/README.md` (check-docs lo exige);
    - `docs/persistencia-protegida.md`: una fila con el cambio autorizado en `idb.ts`.
15. **Verificar:**
    - `npm run test:related` tras cada cambio;
    - al final, `npm run typecheck`, `node scripts/check-sizes.mjs` y `npm test -- --maxWorkers=2`;
    - prueba visual en el sandbox: una generación en Image (con el modelo local gratuito si existe; si no, la de pago aprobada, ver Límites), recargar, comprobar que sigue en Image y que Studio no la muestra, y verla en Library con los filtros; probar «Reusar», el visor y los favoritos; después detener el sandbox.

## Límites

- **Zona protegida:** solo el cambio autorizado en `ALL_DB_NAMES`. La regla 5 pide además revisión independiente: el diff de `idb.ts` y su test se entregan aparte para que el usuario lo pase a un revisor externo antes de fusionar. Si hace falta cualquier otro cambio en `idb.ts`, `disk.ts`, `writerLock.ts`, el servidor o `flushWrite`/`saveNow`, el agente se para y pregunta.
- **Coste:** la prueba visual usa primero el modelo local gratuito si existe. Si no, antes de lanzar una generación de pago, el agente propone al usuario un modelo concreto barato y su coste máximo, y espera su aprobación explícita (regla de AGENTS.md). Si el usuario no aprueba, la prueba se hace sin esa generación y se dice así.
- **Datos:** nada se migra ni se borra.
- **Repositorio:** ni fusión ni push. La rama se entrega con `npm test` en verde.
