# Canvas

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| El índice asigna resultados a Chat o Nodes y el contexto del agente filtra los de otros lienzos. | [src/engine/canvas.ts](../../src/engine/canvas.ts), [context.ts](../../src/engine/agent/context.ts) | [tests/canvas-scope.test.ts](../../tests/canvas-scope.test.ts) |
| Cambiar el tamaño desplaza capas según el ancla, valida dimensiones y permite deshacer; recortar ajusta el lienzo al contenido visible. | [src/engine/design/canvasSize.ts](../../src/engine/design/canvasSize.ts) | [tests/canvas-size.test.ts](../../tests/canvas-size.test.ts) |
