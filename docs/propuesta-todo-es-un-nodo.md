# Propuesta: todo es un nodo, todo es un comando (2026-11-12, sin implementar)

Idea del usuario: cada parte de la app (chat, proveedores, herramientas, lienzo del Designer, biblioteca, sesión, docs)
nace como un nodo con entradas y salidas, existe sin estar conectada y se enlaza después, como las notas de Obsidian.
Todo lo que la app sabe hacer es un comando, usable desde la interfaz, el agente, un CLI interno y, más adelante, un
CLI externo o MCP. Cada nodo se guarda como un paquete autocontenido.

Este documento fija el contrato y el orden de trabajo para ejecutarlo en varias pasadas de un solo intento.

**2026-11-14:** el [plan único](propuesta-todo-es-un-nodo-plan.md) manda sobre el «Orden de trabajo» de abajo; recupera los nodos `ref`, enlaces, paquete y MCP que la revisión del 12-11 había quitado.

## Qué hay hoy (inventario del 2026-11-12)

- **No hay registro de comandos ni paleta.** Las acciones están en cuatro módulos: Designer
  `src/engine/design/actions.ts` (39), Studio y chat `src/engine/actions.ts` (35), Nodes `src/engine/flow/actions.ts`
  (22), FX `src/engine/fx/commands.ts` (4). Sesiones en `src/store/store.ts:630-660`; catálogo en `src/engine/catalog.ts`.
- **El agente tiene 22 herramientas escritas a mano** con esquemas zod (`src/engine/agent/tools.ts:23-333`). Su mapa
  de capacidades se genera de esas descripciones (`tools.ts:479`).
- **El lienzo de nodos ya existe** sobre @xyflow/react: `GraphNode`, `GraphEdge` y `Graph` en `src/engine/types.ts:749-782`,
  guardado en `Session.graph`. Tipos de nodo: texto, generación, herramienta y recurso. Puertos: texto, imagen, vídeo,
  audio y 3D.
- **No hay CLI ni MCP.** [Seguridad](seguridad.md) rechaza peticiones de fuera del ordenador y escrituras automatizadas.

## Contrato

Cuatro piezas. Ninguna reescribe una función: envuelven lo que hay.

**1. Comando.** La unidad de todo. La interfaz, los atajos, el agente y el CLI llaman al mismo registro.

```ts
interface CommandSpec<A, R> {
  id: string;                    // 'designer.layer.add': tipo de nodo + verbo
  title: string;                 // lo que muestra la paleta
  args: z.ZodType<A>;            // zod, como ya usan las herramientas del agente; de ahí sale el JSON Schema
  effect: 'read' | 'write' | 'spend' | 'delete';
  run(ctx: { node?: string; session: string; caller: 'ui' | 'agent' | 'cli' | 'external' }, args: A): R | Promise<R>;
}
```

El resultado es siempre un dato serializable. Forma canónica de una llamada: `{ cmd, args, on? }`. Un árbol de
operaciones es `{ seq: [...] }`, donde un argumento puede ser `"$1"` (el resultado del paso 1). La forma de texto
(`designer.layer.add --name Fondo | designer.layer.opacity 0.5`) solo se traduce a esa; no es un lenguaje aparte.

**2. Tipo de nodo.** Un manifiesto sobre algo que ya existe.

```ts
interface NodeTypeSpec {
  type: string;                  // 'chat', 'designer.doc', 'providers', 'toolset', 'library', 'session'…
  version: number;               // el paquete la guarda; cada tipo migra sus versiones viejas
  ports: PortSpec[];             // puertos de fábrica; cada nodo puede añadir los suyos
  commands: string[];            // ids del registro que este nodo ofrece
}
interface PortSpec { id: string; dir: 'in' | 'out'; kind: 'data' | 'ref' | 'control'; type: string; many?: boolean }
```

En el lienzo, un nodo de estos es un `GraphNodeData` nuevo, `{ kind: 'ref', type, ref }`, que **apunta** a los datos
donde ya viven (un doc, una sesión, la biblioteca). No copia ni migra nada.

**3. Enlace.** Pieza propia, guardada una sola vez y por identificador (ya es así en `GraphEdge`). Gana dos campos
opcionales: `kind` (`data` por defecto, `ref` o `control`) y `both` (bidireccional).

**4. Paquete.** `{ ogs: 1, type, version, name, ports, state, assets, nodes?, links? }` en JSON. Un grafo es un nodo
cuyo paquete contiene otros. Nunca lleva claves ni código.

## Reglas

1. La interfaz no hace nada que no sea un comando. Un check en `npm test` lo exige por apartado, con una lista de
   excepciones que solo puede encoger.
2. Un nodo es una instancia; puede tener varias vistas (el mismo chat en dos apartados).
3. Tres clases de enlace, visibles como distintas: datos (imagen, texto, doc), referencia (proveedor, herramientas) y
   control (agente unido a un chat). Solo se conectan puertos de la misma clase y tipo.
4. Bidireccional solo en referencia y control. En datos, un ciclo exige un nodo de realimentación explícito.
5. El orden de ejecución sale de los enlaces, nunca de la posición en pantalla.
6. Un nodo vivo solo calcula cuando algo mira su salida. En el lienzo es una tarjeta con miniatura; uno abierto a la vez.
7. `effect` decide el permiso: `spend` y `delete` piden siempre al usuario; desde fuera, `write` también.
8. Los puertos que añade el usuario se guardan en el nodo, no en el tipo.

## Referencias

V = leído en la fuente oficial; P = solo resumen de buscador o fuente secundaria.

| Idea | Referencia | Qué copiar | Error a evitar |
|---|---|---|---|
| Nodos sueltos, enlace como pieza | [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) (V) | Arista con `fromNode`, `toNode` y flecha por extremo (`fromEnd`, `toEnd`): eso es uni o bidireccional | En Obsidian los enlaces de notas van por nombre y hay que reescribirlos al renombrar (V): aquí, por id |
| Nodo empaquetado con versión | [Houdini](https://www.sidefx.com/docs/houdini/assets/namespaces.html) (V) | Nombre `[espacio::]nombre[::versión]` e interfaz de parámetros propia | Sin valores de fábrica que funcionen nadie entra (opinión, no fuente) |
| Todo es un comando | [VS Code](https://code.visualstudio.com/api/extension-guides/command) (V) | Id ligado a una función; teclas, menús y código llaman al mismo id, con argumentos | — |
| La interfaz muestra su comando | Maya, eco de MEL (P); Blender, `bpy.ops` (P) | Poder ver el comando de lo que se acaba de hacer | Dos formas de escribir lo mismo |
| Puertos que define el usuario | [Blender, grupos de nodos](https://docs.blender.org/manual/en/latest/interface/controls/nodes/groups.html) (P) | Añadir, quitar y ordenar entradas y salidas de un grupo | Varios sistemas de nodos separados |
| Datos frente a control | Unreal Blueprints (P) | Pines de ejecución y de datos, dibujados distinto | Grafos enormes: el detalle va en texto |
| Tipos que impiden conexiones absurdas | [TouchDesigner](https://docs.derivative.ca/Operator_Family) (V) | Solo se cablean operadores de la misma familia (siete) | — |
| Calcular solo lo que se mira | [TouchDesigner, Cook](https://docs.derivative.ca/Cook) (V) | Un operador calcula cuando algo se interesa por su dato | — |
| Realimentación explícita | [Feedback TOP](https://docs.derivative.ca/Feedback_TOP) (V); zonas de Blender (P) | Un nodo propio para el ciclo | Ciclos implícitos |
| Flujo como archivo | [ComfyUI](https://docs.comfy.org/development/api-development/workflow-metadata) (V) | El flujo viaja en JSON dentro del PNG que genera | Sus nodos ajenos son código Python libre (V) y la versión es del paquete, no de cada tipo (P) |
| Orden de ejecución | [Max/MSP](https://docs.cycling74.com/learn/articles/basicchapter05) (V) | — | El orden depende de la posición: derecha a izquierda y de abajo arriba |
| Puerta externa | [MCP, herramientas](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) (V) | Herramienta con nombre, descripción, esquema de entrada y de salida: sale directa de `CommandSpec` | Las anotaciones (solo lectura, destructiva) no son de fiar si el servidor no lo es (V); sus nombres exactos, sin confirmar |
| «Todo es X» | [Plan 9](https://9p.io/sys/doc/9.html) (V) | Controlar con mensajes de texto en vez de llamadas especiales | `ioctl` como puerta trasera (crítica de ESR, P) |

Corrección a lo dicho en la conversación: TouchDesigner no recalcula todo siempre; es el modelo a copiar. Sin confirmar
en fuente oficial: dónde guarda Node-RED las credenciales y el orden en Pure Data.

## Orden de trabajo

Cada paso es una pasada de un solo intento, con su prueba. 1 y 2 fijan el contrato; hasta que no pasen no se reparte.

| Paso | Qué | Hecho cuando | Quién |
|---|---|---|---|
| 1 | `src/engine/commands/`: tipos, registro, formas JSON y de texto, `scripts/check-commands.mjs`, ADR | Tests del registro; `npm test` verde; nada cambia en la app | Opus o Fable |
| 2 | Prueba medida: las 22 acciones de Nodes y las 39 del Designer como comandos; las herramientas del agente para Nodes salen del registro | La lista generada es igual a la escrita a mano; coste por llamada y peso del paquete medidos | Opus o Fable |
| 3 | Un apartado por pasada, en paralelo, sin archivos compartidos: Studio y chat, sesiones, biblioteca, catálogo, skills y workflows | El check de ese apartado sin excepciones | GPT, DeepSeek, Opus |
| 4 | CLI interno: paleta de comandos y una herramienta `run_commands` para los árboles del agente | El agente encadena tres comandos en una llamada | Opus |
| 5 | Nodos `ref` y clases de enlace en el lienzo; puertos del usuario | Un chat, un doc y un proveedor sueltos y enlazados en el sandbox | Con el usuario delante |
| 6 | Paquete: exportar e importar un nodo y un grafo | Ida y vuelta idéntica en un test | Cualquiera |
| 7 | CLI externo y MCP generados del registro | Decisión de seguridad tomada antes de empezar | Fable u Opus |

Para quien ejecute: las sesiones viven en `store.ts`, cuya escritura está en
[persistencia protegida](persistencia-protegida.md); los comandos llaman a las acciones que hay, no las cambian.
`types.ts` y `Stage.tsx` no pueden crecer: los tipos nuevos van en `src/engine/commands/`.

## Decisiones del usuario

- **Lienzo por sesión o global.** Propuesta: empezar con el de cada sesión, que ya existe y no pide almacenamiento
  nuevo; un nodo de sesión apunta a otra sesión. El global, después.
- **Campos nuevos en el grafo guardado** (`kind: 'ref'` en nodos; `kind` y `both` en enlaces): son opcionales y no
  migran nada, pero cambian el modelo guardado.
- **Puerta externa (paso 7).** Hoy la app rechaza peticiones de fuera y escrituras automatizadas. Propuesta: solo en el
  propio ordenador, lectura libre, y toda escritura, gasto o borrado con aprobación en la app.
- **Dos agentes en un chat:** quién habla y cuándo. Se decide al llegar al paso 5.
- **Paleta de comandos** (paso 4): es interfaz nueva; necesita verse antes de hacerse.
