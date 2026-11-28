# External CLI pilot

Branch `task/external-cli`, baseline `7d829ecd`. Delivery on this branch. Verification with Vitest and repository checks.

## Specs

- S1 — “Reutiliza `findCommands`, `signature`, `argsSchema`, `AGENT_HIDDEN` y `run(..., { caller: 'external', approver })`.”
- S2 — “Solo en `dev:sandbox`” at `127.0.0.1:5183`, with `0600` session token, strict Host/Origin checks, one explicit tab binding, immediate `disconnected`, and contextual Approve/Reject for non-read commands.
- S3 — “`ogs find [--area <área>] [--text <texto>] [--schema <id>]`” and “`ogs run [<json> | --file <ruta>]`” plus stdin, help, JSON stdout and status codes.
- S4 — “Corre `npm run typecheck` y `npm test` (completo, incluyendo `check-all.mjs`, `check-docs`, tamaños y mapas)” and report exact UI selectors for the later Playwright + Hydrogen phase.

## Tasks

- [x] T1, S1–S3 — Implement and test the sandbox bridge, browser executor and CLI inline as one contract. Directed tests and sandbox HTTP checks passed.
- [x] T2, S4 — Regenerate the map, verify the integration and run the full suite. Independent verification found no blockers in security or request ordering.

## Log

### L1 — Original request

> Implementa el piloto **CLI Externo sobre ADR 0030 (Opción A: puente local en sandbox vinculado a 1 pestaña)** en este worktree (`/home/samuel/Documentos/Projects/My New App/ogs-external-cli`, rama `task/external-cli`).
>
> ## Reglas obligatorias
> - Lee primero `AGENTS.md` y `docs/map.md`. Cumple todas las reglas duras del repo:
>   - Nunca tocar `data/` real ni otros directorios fuera de este worktree.
>   - Archivos nuevos/editados ≤ 30 KB; sin `confirm()` nativo; sin secretos en docs ni código.
>   - Si introduces contratos entre archivos, regístralos en `scripts/map-contracts.mjs` y corre `npm run map`.
>   - No fusiones a `main`.
> - **Cero sobreingeniería:** no implementes MCP, no implementes runtime headless en Node, no reescribas el registro de comandos ni el store. Enfócate en lo funcional, mínimo y limpio.
>
> ## Subgoals a completar (1 al 4)
>
> ### Subgoal 1 — Diseño mínimo
> Inspecciona `scripts/dev-sandbox.mjs`, `vite.config.ts`, `server/local-store.js`, `src/engine/commands/{index,registry,run,types}.ts` y `src/engine/agent/commandCalls.ts`. Reutiliza `findCommands`, `signature`, `argsSchema`, `AGENT_HIDDEN` y `run(..., { caller: 'external', approver })`.
>
> ### Subgoal 2 — Puente local en `dev:sandbox` + vinculación de 1 pestaña
> 1. **Solo en `dev:sandbox`** (nunca en `npm run dev` normal), escuchando solo en `127.0.0.1` (puerto sandbox `5183`).
> 2. **Seguridad del canal:**
>    - Al arrancar `dev:sandbox`, genera un token efímero por sesión y escríbelo en `.sandbox/external-cli.json` (con `{ url, port, token, pid }` o similar) con permisos **`0600`**; bórralo limpiamente al cerrar el servidor (`SIGINT`/`SIGTERM`).
>    - Valida estrictamente `Host` (loopback del sandbox) y `Origin` (rechaza peticiones cross-origin o con `Origin` externo no permitido).
>    - Exige `Authorization: Bearer <token>` en las rutas del CLI (`/x/ext/find`, `/x/ext/run`, `/x/ext/status` o equivalentes).
> 3. **Vinculación explícita a 1 pestaña concreta:**
>    - Solo visible en sandbox (`import.meta.env.VITE_OGS_SANDBOX === '1'`): añade un control compacto y no intrusivo en la UI para **vincular / desvincular** esta pestaña al puente externo (usando WebSocket o SSE + POST de respuesta sobre el servidor sandbox).
>    - Regla determinista de 1 pestaña:
>      - Si hay 0 pestañas vinculadas, o si la pestaña vinculada se cierra/desconecta, el puente devuelve de inmediato error JSON claro (`503`, `{ ok: false, error: { code: 'disconnected', message: '...' } }`) sin colgarse.
>      - Si una segunda pestaña intenta vincularse mientras ya hay una activa (o sin reemplazo explícito), evita ejecutar por duplicado o enrutar silenciosamente.
> 4. **Ejecución en la pestaña vinculada:**
>    - `find`: usa `findCommands` filtrando `AGENT_HIDDEN`, devolviendo firmas cortas (`signature`), `args` (JSON Schema) cuando se pida `schema` para un comando concreto, y contexto activo `{ session, doc }`.
>    - `run`: rechaza cualquier paso en `AGENT_HIDDEN`; si el payload omite `on.session`, hereda la sesión activa de la pestaña (y si un paso crea un doc, encadena `on.doc` como `$i.doc` igual que `commandCalls.ts` cuando falte `on.doc`, o respeta el `on` explícito); ejecuta `run(payload, { caller: 'external', approver })`.
>    - **Aprobación humana contextual (sin `confirm()` nativo):**
>      - `read` corre sin pedir permiso.
>      - `write`, `spend` y `delete` muestran una tarjeta/banner contextual en la pestaña vinculada listando los pasos/efectos con botones **Approve** y **Reject** (con `data-testid` claros para pruebas E2E).
>      - Si el usuario rechaza, `run` devuelve `ok: false` con `error.code === 'denied'` y el documento queda intacto.
>      - Timeout claro en puente/CLI si nadie responde.
>
> ### Subgoal 3 — CLI fino `ogs`
> - Crea `scripts/ogs-cli.mjs` y añádelo a `package.json` (`"scripts": { "cli": "node scripts/ogs-cli.mjs" }` y `"bin": { "ogs": "scripts/ogs-cli.mjs" }`).
> - Interfaz mínima:
>   - `ogs --help`: guía breve y clara (~15–20 líneas) con ejemplos reales de `find` y `run` para que un agente externo (como Hydrogen) opere la app sin leer `src/`.
>   - `ogs find [--area <área>] [--text <texto>] [--schema <id>]` → JSON limpio por `stdout`.
>   - `ogs run [<json> | --file <ruta>]` (o leyendo JSON por `stdin`) → JSON (`RunResult`) por `stdout`; exit code `0` si `ok: true`, `1` si `ok: false` o error.
> - Lee automáticamente `.sandbox/external-cli.json` (con override opcional por env/flags `--url`, `--token`, `--timeout` para pruebas).
>
> ### Subgoal 4 — Tests automatizados y salvaguardas
> - Escribe tests Vitest completos cubriendo:
>   1. Seguridad del puente: sin token (401), token inválido (401/403), `Host`/`Origin` inválido (403), archivo de token con permisos `0600` y limpieza al cerrar.
>   2. Ciclo de vida de pestaña: 0 pestañas -> error inmediato, 1 pestaña vinculada -> ok, cierre de pestaña -> error inmediato sin colgarse, sin doble ejecución.
>   3. Ejecutor `external`: `read` directo sin aprobación, `write` aprobado modifica el documento, `write` rechazado devuelve `denied` y deja el documento intacto, `AGENT_HIDDEN` bloqueado.
>   4. CLI: `--help`, `find` (`--area`, `--text`, `--schema`), `run` por `stdin`, inline y `--file`, exit codes `0` y `1`.
> - Corre `npm run typecheck` y `npm test` (completo, incluyendo `check-all.mjs`, `check-docs`, tamaños y mapas) y deja todo 100% en verde.
>
> ## Entrega final
> Al terminar, responde con un resumen conciso que incluya:
> 1. Archivos creados/modificados y decisiones clave.
> 2. Evidencia exacta de `npm run typecheck`, `npm test` y `git status --short`.
> 3. Instrucciones exactas (selectores/testids de la UI sandbox) para nuestra siguiente fase de verificación E2E real con Playwright + Hydrogen en frío.

### Verification log

- Baseline was clean and `node scripts/check-docs.mjs` passed before edits. The new tests initially failed to collect because both entry points were absent.
- `npm run test:related -- tests/external-cli.test.ts tests/external-commands.test.ts tests/designer-commands.test.ts tests/safeguards.test.ts` passed 33 tests in 4 files.
- `npm run dev:sandbox` published a `0600` session. With no tab, `ogs status` exited 1 with `disconnected`. The session path, raw variant and Vite filesystem URL returned 403. The process exited 0 and removed the file on both SIGINT and SIGTERM.
- `npm run map` generated the contract map. `npm run typecheck` and the 22 checks in `check-all.mjs` passed.
- Independent authorization and ordering verification found no blockers. `./node_modules/.bin/vitest run --maxWorkers=1 tests/external-cli.test.ts tests/external-commands.test.ts` passed 9 tests in 2 files in both the independent run and the parent spot check. Browser interaction and provider sends remain outside the observed evidence.
- `npm test -- --maxWorkers=2` exited 0. All 22 preflight checks passed. Vitest reported 779 files passed, 5 skipped, 5604 tests passed, 5 expected failures and 5 skipped (1112.44 s).
- Native assessment classified the sandbox authorization boundary as high risk. A browser E2E phase with Playwright and Hydrogen can use `external-cli-link`, `external-cli-status`, `external-cli-approval`, `external-cli-approve` and `external-cli-reject`.
