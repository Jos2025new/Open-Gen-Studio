# Propuesta: Spaces separados de los Workspaces, con lugar y modo en cada generación

Fecha: 2026-10-18. Estado: **propuesta y plan, sin implementar**. La ejecutará otro agente. Sustituye a la versión anterior del mismo día, que daba a Create y Tools una «sesión de espacios».

## Qué pidió el usuario

El usuario creó un modelo 3D en el espacio Image, recargó la app y lo vio en el chat de Studio. Además, la app abrió en Studio y no en la última pestaña. Lo calificó de «crítico» y «grave».

En la conversación que siguió, el usuario definió el enfoque:
- **Workspaces** (Studio, Canvas, Designer) y **Spaces** (Create y Tools) son dos grupos distintos.
- Quien va a un Space quiere generar muchas veces «y que no se pierda nada». No le interesan las sesiones: quiere ver lo que creó en la galería, con sus datos, y poder reutilizarlo.
- Un historial de prompts de texto, con tope.
- Cada generación lleva **el lugar y el modo** en que se creó, para filtrar y contar (por ejemplo, cuántas imágenes se hicieron en Create en modo Image). El tipo se escribe como `image`, `video`… y nunca se deduce de la extensión.

## La causa

Se comprobó leyendo el código de `task/agent-stop` en `550eb56`.

1. **Create y Tools escriben en la sesión del chat.**
   - Create se dibuja encima del chat (`ui.space = 'create'`, workspace `chat`).
   - Generate llama a `generateDirect`, que usa `st.activeSessionId` (`src/engine/actions.ts:285`).
   - El tablero muestra esa misma sesión (`SpaceBoard.tsx:27`).
   - Tools usa `runAssetOp`, que guarda en la sesión del activo de origen (`actions.ts:686`).
2. **Ninguna generación dice dónde se creó.** Hoy cada generación guarda:
   - `kind`, el tipo de resultado;
   - `origin`, cómo se lanzó: `composer`, `agent`, `op`, `node` o `designer` (`src/engine/types.ts:281`);
   - `op`, la operación si la hubo; además del modelo, el prompt, los parámetros, el coste y las fechas.

   Una imagen de Create y una del chat de Studio quedan con los mismos datos. La galería filtra por `kind` (`generationsView.ts:36`), no por extensión.
3. **El espacio abierto no se guarda.** `ui.space`, `toolOp` y `homeTab` no están en la lista de `partialize` (`src/store/store.ts:422` y `:441`).

No hay pérdida de datos ni mezcla entre sesiones distintas. Es consecuencia del diseño de la [ADR 0017](decisions/0017-espacios-panel-y-tablero.md).

## Comportamiento propuesto

**1. Dos campos nuevos en cada generación,** que su activo hereda:
- `place`: `studio`, `canvas`, `designer`, `space-create` o `space-tools`.
- `mode`: el modo en que se lanzó.
  - En Create y en el compositor de Studio: `image`, `video`, `audio`, `model3d` o `agent`.
  - En Tools: el tipo de la pestaña (`image`, `video` o `audio`), con la operación en el `op` que ya existe.

Se escriben al crear la generación y no cambian después. No se cambia el formato de los ids ni se deduce nada de la extensión.

**2. Separación por lugar.**
- Studio solo muestra en el chat y en su tablero lo suyo.
- Los Spaces muestran lo de `space-create` y `space-tools`.
- Library y Generations lo muestran todo y ganan dos filtros, Lugar y Modo, junto al de tipo que ya existe.
- Ejemplos: `place: space-create` + `mode: image`; `place: space-tools` + `op: upscale`.

**3. Sin sesiones visibles en los Spaces.**
- Por dentro, sus generaciones cuelgan de un contenedor interno, porque el resto de la app espera una sesión.
- Ese contenedor no aparece en las listas de sesiones de los Workspaces, ni en Home, ni en el buscador.
- Su id se guarda en `ui.spaceSession`.
- Las generaciones de los Spaces nunca se borran solas.

**4. «Reusar».** Es un botón en cada resultado de los Spaces, del tablero y de Library.
- Carga en el panel del Space correspondiente el prompt, el modelo, los parámetros, las referencias y el modo de esa generación.
- Si el modelo ya no existe o un parámetro cambió, carga lo que sigue siendo válido y avisa de qué quedó fuera.

**5. Historial de prompts de texto.**
- Hasta 200 prompts, sin repetidos; se descartan los más antiguos.
- Solo texto, sin ajustes asociados, para evitar conflictos (los ajustes completos se recuperan con «Reusar»).
- Se recorre con ↑/↓ en el campo de prompt y con un desplegable.
- Es uno por Space, Create y Tools, y se guarda como el resto del estado de UI.

**6. Recordar el espacio al recargar.** Se guardan `space`, `toolOp`, `homeTab` y el modo del compositor, y la app vuelve donde estabas.

**7. Generaciones antiguas.** Se quedan como están, sin migración. Como no tienen `place`, los filtros las muestran como «Sin lugar» y siguen visibles donde hoy se ven. Moverlas o etiquetarlas sería una migración y necesita una aprobación aparte.

## Plan previsto

Se hace en un worktree propio, `task/space-session`, que sale de `task/agent-stop`.

1. **Antes de empezar, confirmar en el código:**
   - todos los sitios que crean generaciones (`createGeneration` y quién la llama: compositor, agente, operaciones, nodos, Designer);
   - quién llama a `homeAutoClose` (`src/components/shell/homeGuard.ts:44`);
   - de dónde sacan su sesión `opRun.tsx`, `ToolsPanel.tsx` y `actionGo.ts`;
   - las listas de sesiones del sidebar, de Home y del buscador.
2. **Tipos**: añadir `place?` y `mode?` a `Generation` y a `Asset` en `src/engine/types.ts`. Son opcionales, porque las generaciones antiguas no los tienen. Como el estado guardado cambia, revisar el esquema y los tests de formato.
3. **Escritura de los campos**: cada sitio de creación del paso 1 pasa `place` y `mode`. Lo hace una sola función (`src/engine/place.ts`) que los deduce de `ui.space`, del workspace y del modo del compositor.
4. **Contenedor interno**: `src/store/spaceSession.ts` con `ensureSpaceSession()`. `generateDirect` y `runAssetOp` usan ese contenedor cuando se lanzan desde un Space.
   - Ojo: `store.ts` está en 29 955 bytes y no puede pasar de 30 000, así que el código nuevo va fuera.
5. **Vistas**:
   - el chat y el tablero de Studio filtran por `place`;
   - el `SpaceBoard` muestra los Spaces;
   - las listas de sesiones ocultan `ui.spaceSession`.
6. **Filtros** Lugar y Modo en `generationsView.ts` y en su interfaz, reutilizando el patrón del filtro de Sessions.
7. **«Reusar»**: una acción en el resultado que rellena `composer` (Create) o `toolOp` y sus campos (Tools), y avisa de lo descartado.
8. **Historial de prompts**: `src/store/promptHistory.ts`, con 200 entradas como tope, sin duplicados, persistido en `ui`; ↑/↓ y un desplegable en el panel.
9. **Persistencia del UI**: añadir `space`, `toolOp`, `homeTab`, `spaceSession` y el historial a `partialize`, fuera de las funciones protegidas. Al cargar, se valida que `spaceSession` exista.
10. **Tests**: cada uno debe fallar con el código de ahora.
    - Una generación de Create lleva `place: space-create` y su modo, y no aparece en el chat de Studio.
    - Una operación de Tools sobre un activo de Studio lleva `place: space-tools` y va al contenedor.
    - Las generaciones de Studio, Canvas y Designer llevan su `place`.
    - Los filtros Lugar y Modo funcionan; una generación sin `place` sale como «Sin lugar».
    - «Reusar» carga los ajustes y avisa de un parámetro que ya no existe.
    - El historial respeta el tope de 200 y no guarda repetidos.
    - Al recargar se restaura el espacio; un `spaceSession` inválido se descarta.
11. **Docs**:
    - `features/create-space.md` y `studio.md`;
    - una ADR nueva que enmiende la 0017;
    - una entrada de historial;
    - `node scripts/map.mjs --write`.
12. **Verificar**:
    - `npm run test:related`, y después `npm test -- --maxWorkers=2`;
    - prueba visual en el sandbox (generar en Image, recargar, comprobar que sigue en Image y que Studio no muestra el resultado, probar «Reusar» y los filtros); después detener el sandbox.

## Límites y riesgos

- **Persistencia protegida:** no cambian `flushWrite`, `saveNow`, el disco ni el candado. Solo se añaden campos opcionales al estado. Si hiciera falta tocar la zona protegida, el agente se para y pide autorización (regla 5 de AGENTS.md).
- **Datos:** no se migra ni se borra nada existente.
- **Proveedores de pago:** no se usan. La prueba visual no necesita generar de verdad, salvo que el usuario lo apruebe con un coste máximo.
- **Decisiones abiertas para el usuario:**
  - el tope del historial (se proponen 200);
  - si «Reusar» se ofrece también en los resultados de Studio.
