# Nodes

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| El ejecutor común pasa el candidato elegido a referencias, fotogramas y operaciones; si falta ese candidato, rechaza el dependiente. | [src/engine/executor.ts](../../src/engine/executor.ts) | [tests/node-execution.test.ts](../../tests/node-execution.test.ts) |
| El historial separa sesiones, agrupa escritura y preserva resultados recientes y viewport al deshacer. | [src/engine/flow/history.ts](../../src/engine/flow/history.ts) | [tests/graph-history.test.ts](../../tests/graph-history.test.ts) |
