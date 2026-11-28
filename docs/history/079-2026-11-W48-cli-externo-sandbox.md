# 079 · Piloto de CLI externo en sandbox sobre ADR 0030 (2026-11-28)

Base `7d829ecd` → `task/external-cli` (`53ab7773` + este cierre documental), integrado en `main` por avance rápido en `ogs-merge`. Contrato de referencia: [ADR 0030](../decisions/0030-nucleo-de-comandos.md) y ficha de tarea `odd/tasks/external-cli.md`. Evidencia del cierre, no estado actual.

## Objetivo

Exponer el registro de comandos existente (`src/engine/commands/`, ADR 0030) a agentes externos mediante un CLI mínimo (`ogs`), sin reinventar el motor ni el store, operando en vivo contra una pestaña explícitamente vinculada del sandbox y conservando la aprobación humana para escrituras, gasto y borrado.

## Qué quedó en `main`

- `53ab7773` (`task/external-cli`, implementado por **Codex / GPT 6.2 Sol**):
  - **Puente local solo en `dev:sandbox` (`server/external-cli.mjs`, `scripts/dev-sandbox.mjs`, `vite.config.ts`):** enlazado exclusivamente a `127.0.0.1:5183`, token efímero por sesión en `.sandbox/external-cli.json` con permisos `0600` (borrado al apagar por `SIGINT`/`SIGTERM`), validación estricta de `Host`/`Origin` y `Authorization: Bearer` con `timingSafeEqual`, límite de 256 KiB y vinculación determinista a 1 sola pestaña (`409 already_linked` para una segunda pestaña; `503 disconnected` inmediato con 0 pestañas o al cerrarla).
  - **Ejecutor y UI contextual (`src/engine/externalCommands.ts`, `src/lib/externalCliTab.ts`, `src/components/shell/ExternalCliControl.tsx`):** reutiliza `findCommands`, `signature`, `argsSchema`, `AGENT_HIDDEN` y `run(..., { caller: 'external', approver })`, hereda `on.session` activa, exige `holdsWriterLock`, y muestra aprobación contextual (**Approve / Reject**, sin `confirm()` nativo) bloqueando gastos cuyo máximo no sea verificable.
  - **CLI fino (`scripts/ogs-cli.mjs`, `package.json`):** `ogs --help`, `ogs find [--area] [--text] [--schema]`, `ogs run [<json> | --file | stdin]`, `ogs status`, con JSON por `stdout` y códigos de salida `0`/`1`.
  - **Contratos y tests:** `scripts/map-external-cli.mjs`, `docs/map.md`, `docs/map-contracts*.md`, `tests/external-cli.test.ts` y `tests/external-commands.test.ts`.

## Verificación y pruebas independientes

- **Suite automatizada:** `npm run typecheck` (código `0`) y `npm test -- --maxWorkers=2` (código `0`: 22 checks de `check-all.mjs`, 779 archivos, 5.604 tests aprobados).
- **Prueba ciega real con Hydrogen (`gemini-4-hydrogen-medium`) en sandbox vivo (Playwright + Chromium):**
  - Sin leer ningún archivo de `src/`, `server/`, `docs/`, `tests/` ni `scripts/`, Hydrogen usó solo `ogs --help`, `status`, `find` y `run` y completó en **42 s, 8 comandos CLI y 0 errores** el flujo completo de Designer (`designer.doc.new` → `designer.layer.add_text("Hola Hydrogen")` → `designer.layer.set({ x: 180, y: 220, opacity: 0.5 })` → `designer.doc.read`).
  - Cada escritura levantó `external-cli-approval` en la pestaña vinculada; `designer.doc.read` corrió sin tarjeta de aprobación. Estado verificado en vivo vía `window.__OGS_TEST__()`.
- **Prueba negativa (rechazo):** `designer.doc.rename` rechazado en `external-cli-reject` devolvió `denied` (código `1`); lectura posterior confirmó el documento intacto (`"Hydrogen Pilot"`) y sin nueva tarjeta de aprobación.
- **Prueba de desconexión:** antes de vincular y al cerrar la pestaña vinculada, `ogs status` y `ogs run` devolvieron `disconnected` de inmediato (código `1`).

## Fuera de alcance en este piloto (trabajo futuro opcional)

- Adaptador MCP por stdio sobre el mismo contrato de `find` / `run`.
- Modo headless en Node o habilitación opt-in fuera de `dev:sandbox`.
- Compactación adicional de `ogs find --area designer` sin `--text` y simetría `x`/`y` vs `box` en `designer.doc.read`.
