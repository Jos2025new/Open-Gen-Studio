# Problemas conocidos y límites (2026-10-18, `task/agent-stop`)

Registro de lo visto en el uso del sandbox el 2026-10-18 y de pendientes antiguos revisados contra el código de esta rama. Nada de esto se arregla aquí. «Verificado» = leído en el código de esta rama; ninguna fila tiene prueba con proveedor real.

## Vistos hoy en el sandbox (no arreglados en esta rama)

| Problema | Estado | Evidencia |
| --- | --- | --- |
| Un resultado 3D (Tripo H3.1 vía Atlas) mostró «Failed to fetch» y «Provider URL only». | **Causa probable, sin verificar:** el relé de descarga `MEDIA_HOSTS` de [vite.config.ts](../vite.config.ts) solo admite `volces.com`, `bytepluses.com`, `atlascloud.ai` y `aliyuncs.com`; un host de 3D distinto recibiría 403. No se vio el host real. | Lectura de `vite.config.ts:23` y `:39`. Sin reproducir. |
| El usuario siguió generando tras detener el servidor y todo lo posterior se perdió al recargar, sin aviso visible. | Abierto en esta rama: no hay guarda de guardado. La rama `task/save-guard` (fase 1) lo aborda y está sin fusionar, pendiente de revisión. | Relato del usuario; la rama existe (`git branch`). No se leyó su diff. |
| Se registró un conflicto de guardado a las 17:49 en otro sandbox. | Sin analizar: no se tiene el registro ni la causa. | Relato del usuario. |
| `npm audit` marca una vulnerabilidad alta en `source-map-js`. | Arreglada en la línea el 2026-10-22 (`46045ae`, traído de `task/audit-source-map`, `eea511d`). | Comprobado: lockfile en 1.2.2. |

## Pendientes antiguos revisados en el código

- **Archivos de más de 30 KB en el código** ([pendientes](pendientes.md) dice 13): hoy son **11** fuera de `docs/` (`runtime.ts` 115 KB, `Stage.tsx`, `jobs.ts`, `plan.ts`, `params.ts`, `context.ts`, `shell.css`, `nodes.tsx`, `actions.ts`, `types.ts`, `tools.ts`). Siguen sin poder crecer (ADR 0008); `actions.ts` y `types.ts` se tocaron en esta rama con cambios de líneas netas pequeñas. El «13» de pendientes está desactualizado; no se editó porque el archivo está en el límite de tamaño.
- **Commit del formato 2 del servidor no atómico** (`server/store-v2.js`): sigue vigente en lo leído: `HEAD.json` es el punto de publicación y las sesiones se leen aparte; el orden exacto de escritura **sin verificar**.
- **Contraste de `--text-4`** (2,39:1 según pendientes): el valor es `#61616a` en `src/styles/tokens.css:20` y se sigue usando en textos pequeños (`chat-cards.css`); la razón de contraste **sin verificar** (no se recalculó).
- **Límites de Stop** (decididos adrede, no errores): una herramienta ya a medias puede terminar su cambio y Stop no para un plan aprobado. Ver [agente](features/agente.md).
- Resto de pendientes de [pendientes.md](pendientes.md) (FX, máscaras, PSD, fal.ai, importar `.zip`, etc.): **sin verificar** en esta rama.
