# Propuesta: núcleo «todo es un nodo» (borrador para revisión)

## Problema

La tanda anterior intentó envolver cada componente de la interfaz describiendo qué lee y qué escribe. El inventario no converge: cada revisión encuentra más entradas y salidas (ver `revision-desacople.md`). El fallo real está en el núcleo: cableado con dos caminos (`tryConnect` desde la UI y `linkSystemNodes` desde comandos), ejecución que ignora grupos, nodos de sistema que espejan el estado global en vez de ser dueños de él, y un composer y un `activeSessionId` globales como contexto implícito.

Houdini y Blender no envuelven paneles: el estado vive en el nodo y los paneles son vistas de sus parámetros.

## Propuesta

1. **Un único contrato de nodo**, de una página:
   - **Parámetros:** el estado del que el nodo es dueño.
   - **Entradas y salidas tipadas**, con id estable de puerto.
   - **Cálculo puro** (cook): la salida se calcula a partir de parámetros y entradas, sin efectos; un cambio arriba marca como desactualizado lo de abajo.
   - **Efectos solo con acción explícita** (botón: generar, enviar). Conectar o desconectar un cable nunca dispara efectos.
2. **Un space es un subnet**, con nodo de Entrada y de Salida (como Group Input/Output de Blender o el subnet de Houdini). El ejecutor lo trata como grafo anidado; abrirlo muestra el interior en un marco.
3. **Un solo camino de escritura.** La interfaz escribe en los parámetros del nodo, no en el estado global. Lo que se ve no cambia; cambia por dónde pasa el dato. Así desaparecen los dos caminos al mismo estado; los conflictos se resuelven con revisiones (`baseAt`, que ya existe).
4. **Sin perder conexiones.** Cables apuntan a ids estables de puerto; esquema de puertos versionado con migración; un cable cuyo destino falta queda visible como inválido, nunca borrado ni sustituido.
5. **Una tira vertical primero**: prompt → agente (con su LLM) → chat → generación, con varios agentes de verdad (hoy responde siempre el primero). Si el contrato aguanta ahí, el resto de componentes aplica la misma receta y su inventario se hace al envolverlo, no antes.
6. **Revisiones contra el contrato**, no contra la completitud del inventario: las reglas del contrato se convierten en checks y tests; GPT ataca cada tira con tests adversariales.

## Restricciones del proyecto que debe respetar

No cambiar lo que se ve (identidad visual protegida); no tocar la persistencia protegida sin autorización y revisión (`docs/persistencia-protegida.md`); las claves nunca salen por puertos; las acciones con coste conservan su confirmación; los nodos del sistema solo en el omnicanvas, nunca en el lienzo Nodes normal; nada de compatibilidad hacia atrás obligatoria hasta tener versión estable (los datos de prueba pueden cambiar).
