# Documentación de Open Gen Studio

## Dónde mirar

- [Reglas de trabajo](../AGENTS.md).
- Cada ficha de feature enlaza comportamiento, código y test; «sin test» marca falta de cobertura directa.
- Los ADRs conservan contexto, decisión y consecuencias.
- El historial conserva el texto original y su orden; los prefijos numéricos gobiernan la concatenación. Sus referencias históricas no prueban el estado actual.

## Features

- [agente](features/agente.md).
- [biblioteca](features/biblioteca.md).
- [canvas](features/canvas.md).
- [designer](features/designer.md).
- [nodes](features/nodes.md).
- [persistencia](features/persistencia.md).
- [proveedores](features/proveedores.md).

## Decisiones

- [0001 — Proteger los datos tras el incidente del 2026-10-03](decisions/0001-proteger-datos.md).
- [0002 — No usar confirm() nativo](decisions/0002-confirmaciones-de-la-app.md).
- [0003 — Probar la app solo en el sandbox](decisions/0003-pruebas-en-sandbox.md).
- [0004 — Aprobar un coste máximo antes de usar proveedores de pago](decisions/0004-coste-maximo.md).

## Historial

- [001-2026-10-W40](history/001-2026-10-W40.md) — 29393 bytes.
- [002-2026-10-W40](history/002-2026-10-W40.md) — 28429 bytes.
- [003-2026-10-W40](history/003-2026-10-W40.md) — 29562 bytes.
- [004-2026-10-W40](history/004-2026-10-W40.md) — 29117 bytes.
- [005-2026-10-W40](history/005-2026-10-W40.md) — 29387 bytes.
- [006-2026-10-W40](history/006-2026-10-W40.md) — 29432 bytes.
- [007-2026-10-W40](history/007-2026-10-W40.md) — 3706 bytes.
- [008-2026-09-W40](history/008-2026-09-W40.md) — 29535 bytes.
- [009-2026-09-W40](history/009-2026-09-W40.md) — 29062 bytes.
- [010-2026-09-W39](history/010-2026-09-W39.md) — 28940 bytes.
- [011-2026-09-W39](history/011-2026-09-W39.md) — 896 bytes.
- [012-2026-09-W40](history/012-2026-09-W40.md) — 11079 bytes.
- [013-2026-09-W39](history/013-2026-09-W39.md) — 29187 bytes.
- [014-2026-09-W39](history/014-2026-09-W39.md) — 29414 bytes.
- [015-2026-09-W39](history/015-2026-09-W39.md) — 8682 bytes.
- [016-2026-09-W40](history/016-2026-09-W40.md) — 1339 bytes.
- [017-2026-10-W40](history/017-2026-10-W40.md) — 6333 bytes.

## Verificación

`node scripts/check-docs.mjs` comprueba tamaños, índice, ADRs, enlaces de las fichas y posibles secretos. `npm test` ejecuta primero las salvaguardas y esta comprobación. La lectura de data/ real no forma parte de estos controles.
