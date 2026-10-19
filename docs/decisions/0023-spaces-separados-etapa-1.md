# 0023 — Spaces separados de los Workspaces (etapa 1)

## Estado

Aceptado

Etapa 1 en `task/space-session-1`, sin fusionar. Enmienda la [0017](0017-espacios-panel-y-tablero.md).

## Fecha

2026-10-19

## Contexto

Un modelo creado en el Space Image aparecía en el chat de Studio al recargar, y la app abría en Studio en vez de en la última pestaña. Create y Tools escribían en la sesión activa y el tablero no distinguía de dónde venía cada resultado.

## Decisión

- Cada `Generation` y `Asset` lleva `place` y `mode` opcionales, fijados al crearse. Los derivados (reintento, variante, mejorar plano, pasos de un plan) los copian.
- Create y Tools escriben en una única sesión marcada `hidden`, encontrada por la marca y nunca mostrada en listas, Home, buscador ni contadores. `ensureSpaceSession()` no cambia la sesión activa.
- Los tableros de Space filtran por su `place`; el de Studio excluye `space-*`.
- Library y Generations muestran todo y filtran por Lugar y Modo con contadores; lo antiguo queda «Sin lugar».
- Los resultados de Space abren solo el visor (`openGeneration`), sin cambiar de sesión.
- `ui.home`, `homeTab`, `space`, `toolOp` y `toolAsset` se persisten; al hidratar se valida `toolAsset` y se descarta `home` si también hay `space`. La guarda de Home re-basa `last` y `spaceWas` al primer estado hidratado.

## Alternativas

Una sesión visible por Space, guardar el id del contenedor, deducir `place` de `canvasIndex` y migrar lo antiguo: ver [la propuesta](../propuesta-spaces-v5.md#por-qué).

## Consecuencias

No hay migración: lo antiguo sigue donde estaba. El contenedor crece y no se vacía solo. Quedan para la etapa 2 los resultados de texto, «Reusar», el historial de prompts y el cambio autorizado de `ALL_DB_NAMES`.
