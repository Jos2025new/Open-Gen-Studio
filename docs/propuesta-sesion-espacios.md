# Propuesta: Create y Tools con sesión propia, y el espacio recordado al recargar

Fecha: 2026-10-18. Estado: **propuesta y plan, sin implementar**. La ejecutará otro agente.

## Qué pidió el usuario

El usuario lo vio así: un modelo 3D creado en el espacio Image aparecía en el chat de Studio después de recargar. Además, la app abrió en Studio en lugar de en la última pestaña. Lo calificó de «crítico» y «grave», y pidió las dos cosas: «recordar el espacio al recargar y que Create/Tools tengan su propia sesión, separada del chat de Studio».

## La causa

Se comprobó leyendo el código de `task/agent-stop` en `550eb56`.

1. **Create y Tools escriben en la sesión del chat.**
   - Create se dibuja encima del chat (`ui.space = 'create'`, workspace `chat`).
   - Generate llama a `generateDirect`, que usa `st.activeSessionId` (`src/engine/actions.ts:285`).
   - El tablero muestra esa misma sesión (`SpaceBoard.tsx:27`).
   - Tools usa `runAssetOp`, que guarda en la sesión del activo de origen o, si no existe, en la activa (`actions.ts:686`).
2. **El espacio abierto no se guarda.** `ui.space`, `toolOp` y `homeTab` no están en la lista de `partialize` (`src/store/store.ts:422` y `:441`), así que al recargar siempre se vuelve al chat.

No hay pérdida de datos ni mezcla entre sesiones distintas. Viene del diseño de la [ADR 0017](decisions/0017-espacios-panel-y-tablero.md).

## Comportamiento propuesto

- **Una sesión de espacios** («Create & Tools»): una sesión normal, creada la primera vez que se abre Create o Tools. Su id se guarda en `ui.spaceSession`, que es persistido.
- **Al abrir Create o Tools**:
  - se guarda la sesión que estaba activa en `ui.studioSession`;
  - la activa pasa a ser la de espacios;
  - todo lo que hoy usa `activeSessionId` (Generate, tablero, ETA, avisos) funciona sin más cambios.
- **Al salir a Studio, Canvas o Designer**, se vuelve a `ui.studioSession`.
- **La lista de sesiones de Studio no muestra la sesión de espacios.** Sus activos siguen en Library y en Generations.
- **Tools siempre guarda en la sesión de espacios**, aunque el activo de entrada venga de otra.
- **Al recargar** se restaura el espacio: `space`, `toolOp`, `homeTab` y el modo del compositor. Si el espacio era Create o Tools, se reabre con su sesión.
- **Lo ya generado se queda donde está.** Mover turnos antiguos sería una migración de datos y necesita una aprobación aparte.

## Plan previsto

Se hace en un worktree propio, `task/space-session`, que sale de `task/agent-stop`.

1. **Antes de empezar, confirmar en el código:**
   - quién llama a `homeAutoClose` (`src/components/shell/homeGuard.ts:44`), porque cierra el espacio cuando cambia la sesión;
   - de dónde sacan su sesión `opRun.tsx`, `ToolsPanel.tsx` y `actionGo.ts`;
   - la lista de sesiones del sidebar y de Home.
2. **Persistencia del UI** (`store.ts`, fuera de las funciones protegidas):
   - añadir `space`, `toolOp`, `homeTab`, `spaceSession` y `studioSession` a `partialize` y al tipo;
   - validar al cargar: si `spaceSession` apunta a una sesión que no existe, se descarta.
   - Ojo: `store.ts` está en 29 955 bytes y no puede pasar de 30 000. El código nuevo va en un archivo propio, por ejemplo `src/store/spaceSession.ts`.
3. **`src/store/spaceSession.ts`** con tres funciones:
   - `ensureSpaceSession()`: crea la sesión o reutiliza la existente;
   - `enterSpace()`: guarda la sesión de Studio y activa la de espacios;
   - `leaveSpace()`: vuelve a la sesión de Studio.
   - El cambio de sesión hecho por estas funciones no debe disparar el cierre automático del espacio.
4. **Navegación** (`navModel.ts`, `actionGo.ts`): `openCreate`, `openTool` y Go llaman a `enterSpace`; `openSpace`, `openHome` y `newCanvas`/`newDesign` llaman a `leaveSpace`.
5. **Tools**: `runAssetOp` recibe la sesión de destino; desde Tools es la de espacios. Las demás llamadas siguen igual.
6. **Listas de sesiones**: filtrar `ui.spaceSession` en el sidebar, en Home y en el buscador de sesiones.
7. **Borrado**: si el usuario borra la sesión de espacios (desde Library o «borrar todo»), se limpia `ui.spaceSession` y la próxima apertura crea otra.
8. **Tests**: uno por punto, cada uno fallando con el código de ahora:
   - generar en Create no añade nada a la sesión de Studio;
   - una operación de Tools sobre un activo de Studio va a la sesión de espacios;
   - al salir se vuelve a la sesión anterior;
   - al recargar se restaura el espacio;
   - una `spaceSession` inválida se descarta;
   - la lista de Studio no muestra la sesión de espacios.
9. **Docs**:
   - `features/create-space.md` y `studio.md`;
   - una nota en la ADR 0017 o una ADR nueva, porque cambia una decisión;
   - una entrada de historial;
   - `node scripts/map.mjs --write`.
10. **Verificar**:
    - `npm run test:related`, y después `npm test -- --maxWorkers=2`;
    - prueba visual en el sandbox: generar en Image, recargar, comprobar que sigue en Image y que Studio no muestra el resultado; luego detener el sandbox.

## Límites y riesgos

- **La persistencia protegida no se toca.** No cambian `flushWrite`, `saveNow` ni el formato. Solo se añaden campos de UI al estado guardado. Si el agente necesita tocar la zona protegida, se para y pide autorización (regla 5).
- **No se usan proveedores de pago.** La prueba visual no necesita generar de verdad, salvo que el usuario lo apruebe con un coste máximo.
- **Decisión de interfaz que queda abierta:** si la sesión de espacios debe verse en algún sitio como sesión, por ejemplo para renombrarla o borrarla. Se propone que no.
