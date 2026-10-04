# Nodes

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| El ejecutor común pasa el candidato elegido a referencias, fotogramas y operaciones; si falta ese candidato, rechaza el dependiente. | [src/engine/executor.ts](../../src/engine/executor.ts) | [tests/node-execution.test.ts](../../tests/node-execution.test.ts) |
| El historial separa sesiones, agrupa escritura y preserva resultados recientes y viewport al deshacer. | [src/engine/flow/history.ts](../../src/engine/flow/history.ts) | [tests/graph-history.test.ts](../../tests/graph-history.test.ts) |

## Diseño aprobado: desacoplar resultados
El nodo acoplado sigue siendo el comportamiento por defecto.
Desacoplar muestra una tarjeta por resultado, conservando generación, miniaturas y ajustes.
Las entradas se copian a todas las tarjetas; las salidas originales quedan solo en la tarjeta del `outputIndex` seleccionado.
El conjunto reutiliza el marco de grupos y conserva el nodo original, sus conexiones y su grupo previo para reacoplar.
Reacoplar restaura ese original y conserva las conexiones nuevas compatibles; las incompatibles se descartan con un aviso.
La validación exige igualdad del grafo en la ida y vuelta y que el nodo de abajo reciba el mismo resultado.
