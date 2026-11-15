# Plan único: todo es un nodo (2026-11-14)

Este documento es **la única referencia** del frente. Cada encargo enlaza su paso. Un cambio de alcance se escribe
aquí con lo que se quita, y el usuario lo aprueba antes. La versión anterior (Fable, 2026-11-12) está en el historial
de git. Recortó en silencio la mitad de la idea del usuario, y eso no debe repetirse.

## La idea del usuario (13 y 14-11, sus palabras resumidas)

1. **Todo nace como nodo:**
   - el chat, al que se conectan uno o dos agentes;
   - el agente, que vive en un nodo;
   - los proveedores con su catálogo y los modelos;
   - las herramientas, el lienzo del Designer con sus capas, los docs, la biblioteca y la sesión;
   - los Spaces.

   Los Spaces muestran esos nodos de la forma que les toca, y siguen siendo nodos.
2. **Autocontenido «inicio»…«fin», empaquetable:** un nodo o un grafo se envuelve, se guarda y se reutiliza.
3. **Todo se puede ejecutar como comando:** con un CLI interno, uno externo o MCP. El agente escribe árboles de
   comandos encadenados, y el CLI le devuelve los resultados exactos.
4. **Enlaces como en Obsidian:** los nodos existen sueltos y se enlazan después, en una dirección o en las dos.
   - Puertos personalizables, como en Blender: un Space admite entradas y salidas nuevas.
   - Modelos de varios proveedores se acoplan, agrupan o fusionan con el chat o el agente.
5. **Chat:** mensajes agente–usuario, cada uno con fecha, hora y metadatos clave.
6. **Ejecución:** los nodos se acoplan, se encadenan y se ejecutan con run y stop acotados. La traza es clara para la
   app, la depuración y el propio agente.
7. **Omnicanvas** (definición del usuario, 14-11): es un lienzo de nodos. Solo se selecciona, se edita y se añaden
   nodos; no se dibuja en él ni hay ventanas de doc. Los nodos salen de la biblioteca de nodos, donde todo es un nodo.
   - Por sesión hay **un nodo Studio, un nodo Nodes y un nodo Designer**. Cada uno muestra una miniatura o instantánea
     de su Space. Igual con el resto: los nodos de imagen se ven como hoy cuando aparecen ahí.
   - El chat es un nodo con el aspecto del chat de Studio; desacoplado, es un nodo con sus conexiones de agente, etc.
   - Todo otro nodo que se añade sigue el esquema del lienzo de Nodes (las mismas tarjetas).
   - Los Spaces (Studio, Nodes, Designer) tienen **dos aspectos que el usuario conmuta**: 1) miniatura; 2) vista de
     nodo como Blender o ComfyUI (puertos y parámetros).
   - Un Designer, un Studio y un lienzo de nodos por sesión. No debe ralentizarse.

Referencias verificadas y errores que evitar: tabla de [la propuesta original](propuesta-todo-es-un-nodo.md#referencias).
Incluye JSON Canvas, Houdini, VS Code, Blender, Unreal, TouchDesigner, ComfyUI, Max/MSP, MCP y Plan 9. Contrato de los
comandos: [ADR 0030](decisions/0030-nucleo-de-comandos.md).

## Estado y pasos

| # | Paso | Estado | Hecho cuando | Idea |
|---|---|---|---|---|
| 1 | Núcleo de comandos (`src/engine/commands/`) | **Hecho** (`task/commands`) | Tests del núcleo | 3 |
| 2 | Designer como comandos; `find_commands` y `run_commands` | **Hecho** | El agente encadena comandos en una llamada | 3 |
| 3 | Propuesta de puerta externa | Escrita ([doc](propuesta-puerta-externa.md)), sin revisar | El usuario decide las reglas | 3 |
| 4 | `check-commands` y prueba de humo | **Hecho** | Falla con archivo:línea | 3 |
| 5 | Envoltura del resto: 111 comandos, 7 apartados, 38 con deuda | **Hecho** | Check por apartado | 3 |
| 5b | Caché de prompts | **Hecho** (`e647b327`), medido: 12.140 de 12.144 tokens en caché | — | 3 |
| 5c | Menos llamadas: catálogo en el prompt, `"$1.doc"` | Rama `task/agent-fewer-calls`, revisada, sin fusionar ni medir con modelo real | De 5 a 2 llamadas en la petición del cartel, medido | 3 |
| 6 | Paleta Ctrl+K | Rama `task/cmd-palette`, código revisado; falta prueba de usuario nuevo | Funciona en el sandbox | 3 |
| 7 | Aprobación con coste real y límite de gasto (tres opciones al tope) | En curso (Argon, `task/approval-cost`) | Una aprobación por secuencia con el total | 3, 6 |
| 8 | **Nodos del sistema** (recuperado): chat, agente, proveedor y modelo, sesión, Space, doc, biblioteca, herramientas. Son nodos que **apuntan** a los datos donde ya viven: no se copia ni se migra nada, y la persistencia protegida no se toca | **Motor hecho** en `task/system-nodes` (`src/engine/nodes/`, `SystemNode.tsx`, `tests/system-nodes.test.ts`). Los nodos del sistema **no se ven en el lienzo de Nodes ordinario**, que queda como antes: se muestran en el omnicanvas (paso 12) y mientras tanto por comandos (`nodes.system.*`, el agente). Falta la UI, que espera el boceto del paso 12 | En el lienzo de nodos se ven el chat con su agente y modelos acoplados, el doc y el Space, enlazados | 1, 4 |
| 9 | **Enlaces** (recuperado): clases datos, referencia y control, dibujadas distinto; `both` para bidireccional en referencia y control; orden de ejecución por enlaces, nunca por posición | **Motor y dibujo hechos** en `task/system-nodes`: clase por estilo de trazo (datos continuo, referencia punteado, control discontinuo con flecha), `both` conmutable, `executionOrder` solo por datos. Se ven en el omnicanvas (paso 12); el lienzo de Nodes ordinario no cambia | Enlazar y desenlazar con un deshacer | 4 |
| 10 | **Chat como nodo con metadatos** (nuevo): fecha, hora con huso, agente, Space, proveedor y modelo, uso, coste e id de ejecución por mensaje; uno o dos agentes; varios modelos acoplados | Pendiente | Cada mensaje muestra sus metadatos; el hilo no se corta al cambiar de Space | 1, 5 |
| 11 | **Run, stop y traza** (nuevo): ejecución acotada por nodo, stop inmediato y una traza que leen la interfaz, la depuración y el agente. Nodo de comando: el plan del agente se ve, se edita y se guarda. Solo se calcula lo que se mira | Pendiente | Stop corta una cadena en vuelo; el agente lee la traza de lo que hizo | 3, 6 |
| 12 | **Omnicanvas** (recuperado, redefinido por el usuario el 14-11): lienzo de nodos puro (seleccionar, editar, añadir desde la biblioteca de nodos); sin dibujo ni ventanas de doc. Un nodo Studio, uno Nodes y uno Designer por sesión, cada uno con dos aspectos conmutables (miniatura / vista de nodo con puertos y parámetros); el chat como nodo con el aspecto del de Studio, con su agente y modelos acoplados; el resto de nodos, con las tarjetas del lienzo de Nodes | Pendiente: antes, medir el cambio de doc activo y un boceto aprobado por el usuario (`omnicanvas-boceto.html`, rehecho con esta definición). **Aquí se muestran los nodos del sistema (8) y sus enlaces (9)**: el motor, las tarjetas y los comandos ya existen; la UI espera el boceto | Un doc activo rinde igual que hoy | 1, 7 |
| 13 | **Puertos del usuario y cables entre ventanas** (recuperado): perezosos, con «desactualizado» | Pendiente | Añadir una entrada a un Space y cablearla | 4 |
| 14 | **Paquete «inicio»…«fin»** (recuperado): exportar e importar un nodo o un grafo en JSON, con versión al estilo Houdini, sin claves ni código | Pendiente | Ida y vuelta idéntica en un test | 2 |
| 15 | **CLI externo y MCP** desde el registro | Pendiente: primero la decisión del paso 3 | Una herramienta MCP sale de un comando | 3 |

Orden: 7, 5c y 6 cierran lo empezado. Después 8 → 9 → 10 → 11 forman el núcleo visible de «todo es un nodo». 12 y 13
van con un boceto aprobado. 14 y 15 van al final.

## Lo que ya se sabe para los pasos 8 a 11

Diagnóstico de Argon con archivo:línea, en la rama `task/agent-node-design`, `docs/propuesta-nodo-agente.md` §2:

- **El agente pierde el contexto al pasar del Designer a Nodes** por cuatro causas:
  1. `buildContext` tiene ramas excluyentes por Space (`context.ts:334-357`);
  2. `on.doc` se fija una vez por lote (resuelto en 5c);
  3. `FeedList.tsx:198-200` oculta mensajes de otros Spaces;
  4. el agente no lee lo que ejecutó.
- **El desfase entre `usage` y `agentMetrics`:** `approvePlan` cierra la petición antes del turno final del agente
  (`planRun.ts:75`).

De ese documento se aprovecha la evidencia. Su modelo de datos no se adopta tal cual, porque no partía de este plan.

## Decisiones del usuario abiertas

Solo lo que la idea del usuario no resuelve y exige su aprobación por regla (seguridad, identidad visual):

1. Reglas de la puerta externa (paso 3).
2. Boceto del omnicanvas (paso 12).

Resuelto por la media profesional, cambiable si el usuario lo pide:

- **Dos agentes en un chat:** responde el agente principal; el segundo, cuando se le menciona (@nombre) o se le
  pasa el turno.
- **Acople de modelos:** los tres modos que nombró el usuario: cable, acoplado (en el borde o agrupado) y fusionado.

Decidido: el gasto lo pone el usuario. Fija un límite una vez; al llegar al tope se ofrece «Permitir esta vez»,
«Permitir durante toda la sesión» o «No volver a preguntar hasta la próxima sesión». Sin modo automático ni topes
inventados por la app.
