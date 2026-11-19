# Revisión adversarial C0: `pagehide`

Comparación: `git diff task/sqlite-adopt -- src/lib/disk.ts`. C0 añade un indicador global `unloading`, activado en `pagehide` y borrado en `pageshow`; `report()` omite el aviso si el indicador está activo y el error es `TypeError`. El reporte HTTP usa `reportHttp()`, salvo que las respuestas `409` se clasifican aparte.

## Ejecución

Comando solicitado: `npx vitest run --pool=forks --maxWorkers=1 tests/adversarial-c0-pagehide.test.ts`.

**No ejecutado:** el worktree no tiene `node_modules` ni Vitest disponible. `npx` intentó descargarlo, pero la caché global está en un filesystem de solo lectura (`EROFS`). No se instaló nada para respetar el límite de RAM. Por eso los resultados de abajo indican expectativa por lectura estática, no resultados observados de Vitest.

## Casos

| Caso | Resultado | Evaluación |
|---|---|---|
| HTTP 418 tras `pagehide`, commit v2 | Pendiente de ejecución; esperado: pasa | El estado no exitoso llama `reportHttp()` y debe avisar. |
| HTTP 500 tras `pagehide`, commit v2 | Pendiente de ejecución; esperado: pasa | Igual que el caso anterior; el cuerpo no cambia el manejo HTTP. |
| HTTP 503 tras `pagehide`, `setState` | Pendiente de ejecución; esperado: pasa | La rama HTTP no exitosa llama `reportHttp()`. |
| `TypeError` durante `pagehide`, commit v2 | Pendiente de ejecución; esperado: pasa | `report()` suprime el aviso; el resultado sigue siendo `fail`. |
| `TypeError` durante `pagehide`, `setState` | Pendiente de ejecución; esperado: pasa | Ambas rutas comparten el mismo `report()`. |
| `TypeError` sin `pagehide` | Pendiente de ejecución; esperado: pasa | `unloading` comienza en `false`; debe avisar. |
| `pagehide` → `pageshow` → `TypeError` | Pendiente de ejecución; esperado: pasa | `pageshow` vuelve a poner `unloading` en `false`; debe avisar. |
| Dos fallos HTTP en serie tras `pagehide` | Pendiente de ejecución; esperado: pasa | Cada respuesta no exitosa debe producir su propio aviso. |
| `AbortError` durante `pagehide` | Pendiente de ejecución; esperado: pasa | No es `TypeError`; no debe quedar silenciado por esta regla. |
| Error HTTP 502 con cuerpo HTML/no JSON | Pendiente de ejecución; esperado: pasa | `reportHttp()` avisa por estado sin depender de JSON. |
| HTTP 409 no JSON tras `pagehide`, commit v2 | **Falla por lectura estática** | `setCommit` devuelve `conflict` desde la rama `409` sin llamar a `reportHttp()`. El aviso queda ausente aunque hubo respuesta HTTP, no aborto de red. |
| HTTP 409 no JSON tras `pagehide`, `setState` | **Falla por lectura estática** | `setState` también clasifica `409` con `refusal()` y no avisa. El texto no JSON se convierte en conflicto genérico; no equivale a fallo de red. |

Los dos casos 409 son bugs reales respecto al criterio pedido: una respuesta del servidor que informa conflicto no es un rechazo de red provocado por la descarga. El código omite el aviso debido a la clasificación especial de `409`, no por `pagehide`. La prueba solo espera aviso; no se modificó código de producción.

## Archivos y comprobaciones

- `tests/adversarial-c0-pagehide.test.ts` — pruebas nuevas; no ejecutadas por falta de Vitest local.
- `git diff --no-index --check /dev/null <archivo>` para ambos archivos nuevos — sin diagnósticos de whitespace (el código de salida 1 indica diferencias frente al archivo vacío).
- No se ejecutaron otros tests, `npm test`, navegador ni sandbox; no se tocó `data/`.
