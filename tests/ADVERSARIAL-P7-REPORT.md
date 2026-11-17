# Revisión adversarial del punto 7

Objetivo: `89c42d70` en `task/sqlite-adopt` — nodos del sistema en el Nodes normal; Spaces y assets del omnicanvas fuera de ese lienzo.

## Resultado por prueba

| Archivo / prueba | Resultado | Si falla, motivo |
| --- | --- | --- |
| `adversarial-p7-add-node.test.ts` — añadir y quitar cada tipo de sistema que ofrece Add node; sin Spaces en Nodes | **PASA** | — |
| `adversarial-p7-add-node.test.ts` — Add node ofrece Chat además de Agent, Model, Designer Doc, Library y Tools | **FALLA — bug real** | La lista de entradas de sistema omite `chat`. Aunque `ensureSystemNodes` crea el nodo Chat, el usuario no puede añadirlo desde el control solicitado. |
| `adversarial-p7-add-node.test.ts` — borrar un nodo del sistema conserva el Space y el asset del omnicanvas y no deja enlaces colgantes | **PASA** | — |
| `adversarial-p7-add-node.test.ts` — agentes repetidos conservan IDs distintos | **PASA** | — |
| `adversarial-p7-add-node.test.ts` — contrato generado registra las rutas y la cobertura del punto 7 | **FALLA — contrato incompleto** | `scripts/map-contracts-nodes.mjs` no registra `omniSpaces.ts`/`hiddenInOrdinary` ni esta prueba. El contrato existente cubre los nodos del sistema y enlaces, pero no la separación entre Nodes normal y omnicanvas. |
| `adversarial-p7-persistence-studio.test.ts` — serialización estable y restauración íntegra de nodos y enlaces del sistema | **PASA** | — |
| `adversarial-p7-persistence-studio.test.ts` — Nodes incrustado y estrecho en Studio conserva sistema y omite Space/assets | **PASA** | — |

La opción `Asset` de la biblioteca abre la galería; esta prueba no la cuenta como un nodo Asset añadido a Nodes. La exclusión comprobada es la de los nodos de asset que aporta el omnicanvas.

## Ejecución y alcance

Comando ejecutado tres veces durante el ajuste del harness:

```sh
npx vitest run --pool=forks --maxWorkers=1 tests/adversarial-p7-add-node.test.ts tests/adversarial-p7-persistence-studio.test.ts
```

Resultado final: **2 archivos, 5 pruebas pasan, 2 fallan**. La ejecución final duró 27.97 s. Los primeros intentos también detectaron errores del propio harness (expectativa sobre el rótulo Asset, import de `deleteNodes` y falta de `ResizeObserver` en jsdom); se corrigieron solo en los tests nuevos y se repitió la ejecución. No se ejecutaron otros archivos ni `npm test`; no se usaron navegador ni sandbox y no se tocó `data/`.

No se cambió código de producto ni `scripts/map-contracts-nodes.mjs`. Las únicas adiciones son los dos tests adversariales y este informe.

Risk: none
