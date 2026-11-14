<!-- Copiado de la nota compartida de Fable (2026-11-12). Sustituye al «Orden de trabajo» y a parte de las «Decisiones» de propuesta-todo-es-un-nodo.md. -->
# Plan revisado: todo es un comando, docs como ventanas (Fable, 2026-11-12; consulta, repo sin tocar)

La dirección acordada me convence entera. Un solo añadido: donde una acción del Designer hoy solo sabe actuar sobre el
doc activo, su comando lo dice en `available()` («solo sobre el doc activo») y el check lo lista como deuda. Así la
primera pasada no obliga a reescribir acciones.

## Pasos

**Estado (2026-11-13):** pasos 1 y 2 hechos en `task/commands`; contrato y medidas en el [ADR 0030](decisions/0030-nucleo-de-comandos.md).

Raíz del frente: una rama `task/commands` salida de `task/export`. Cada sesión, su worktree. Como mucho tres sesiones a
la vez; el sandbox es uno, se usa por turno.

| Ola | Paso | Hecho cuando | Quién | Dónde |
|---|---|---|---|---|
| 0 | a. Suite completa de `task/export` | `npm test` verde o lista de fallos | Haiku | `ogs-export` |
| 0 | b. Sandbox: PDF con desenfoque y FX, ida y vuelta SVG, objetos | Informe con capturas | Luna | sandbox |
| 0 | c. Medir: tiempo al cambiar de doc activo y si los docs no activos liberan búferes | Dos cifras | Luna, tras b | sandbox |
| 0 | d. Inventario de lecturas de «lo activo» (doc, capa, selección) por acción | Tabla archivo:línea | Haiku | solo lectura |
| 0 | e. Bocetos de la paleta y del escritorio de ventanas | El usuario los aprueba o corrige | Opus | sin código |
| 1 | 1. Núcleo: `src/engine/commands/` (tipos, registro, `run` y secuencias con `$n`, eco, `aliases`, `available`, `effect`, transacción por historial, índice automático). Primer commit, pequeño | Tests del núcleo; la app no cambia | Fable | `ogs-commands` |
| 1 | 2. Designer: sus 39 acciones como comandos con destino en `on`; `find_commands` y `run_commands` para el agente | El agente encadena tres comandos del Designer en una llamada; coste por llamada medido; `npm test` verde | Fable, misma sesión | `ogs-commands` |
| 1 | 3. Seguridad de la puerta externa (solo propuesta) | Documento con reglas y riesgos | GPT, en paralelo | solo lectura |
| 2 | 4. `check-commands` y prueba de humo desde esquemas | Fallan con archivo:línea ante un comando sin esquema o que rompe el doc | GPT, tras el commit del paso 1 | `ogs-cmd-checks` |
| 2 | 5. Envoltura por apartado: Nodes (22), Studio y chat (35), sesiones, biblioteca, catálogo, skills | El check de ese apartado sin deuda | DeepSeek, Luna, Haiku; uno por apartado | `ogs-cmd-<apartado>` |
| 2 | 6. Paleta (Ctrl+K) con repetir el último | Aprobado el boceto; funciona en el sandbox | Opus | `ogs-cmd-palette` |
| 3 | 7. Nodo de comando en el lienzo actual: el plan del agente se ve, se edita y se guarda | Una secuencia con gasto pide una sola aprobación con su coste | Opus o Fable | `ogs-cmd-node` |
| 3 | 8. Docs como ventanas: desacoplar pestaña, imagen en las no activas, activar al clic, vista general | Las cifras de 0c lo permiten; boceto aprobado; un doc activo rinde igual que hoy | Opus o Fable | `ogs-windows` |
| 4 | 9. Cables entre ventanas (perezosos, «desactualizado») y puertos del usuario | Se decide con el paso 8 a la vista | — | — |
| 4 | 10. Paquete de un nodo; 11. CLI externo y MCP | Decisión de seguridad tomada | — | — |

El paso 5 puede ir en paralelo sin choques porque el índice es automático: cada sesión solo añade un `commands.ts` en su
carpeta. Para que siga siendo así, la lista de deuda del check va por apartado, no en un archivo común; `docs/map.md`
se regenera al juntar.

## Qué cambia respecto al documento, y por qué

- **Paso 1:** fuera la forma de texto con `|`; entran eco, `aliases`, `available`, transacciones, validar solo en la
  frontera y destino explícito. Lo acordado con el usuario y Opus.
- **Paso 2:** era «Nodes y Designer, y las herramientas de Nodes generadas iguales a las escritas a mano». Ahora solo
  Designer, con `find_commands` y `run_commands`. El agente no debe recibir 100 herramientas, y el impacto está en el
  Designer (de 3 capacidades a unas 40). Nodes pasa a la envoltura mecánica.
- **Paso 4 antiguo** (CLI interno): `run_commands` sube al paso 2; la paleta queda y pide boceto antes.
- **Paso 5 antiguo** (nodos `kind: 'ref'` dentro del lienzo de nodos): **se cae.** El omnicanvas es un escritorio de
  ventanas de docs, no nodos que apuntan a cosas. Las clases de enlace y los puertos del usuario sobreviven, pero para
  los cables del escritorio, al final.
- **Se cae también:** «abrir a pantalla completa», la regla 1 estricta y la decisión «lienzo por sesión o global» (ya
  resuelta: un Designer, un Studio y un lienzo de nodos por sesión).
- **Entra nuevo:** la ola 0 (cerrar exportación, medir, bocetos), la prueba de humo, el nodo de comando y las ventanas
  con imagen en las no activas.
- **Se aplaza sin caerse:** el chat visible en varios apartados, el paquete y la puerta externa.

## Decisiones del usuario

1. Permiso para worktrees y ramas de este frente (el 2026-11-05 pidió no abrir más; el paralelo los necesita).
2. Campos opcionales nuevos en lo guardado: posición y estado de las ventanas por sesión, y el nodo de comando en el
   grafo. Sin migración, pero cambian el modelo.
3. Aprobar los bocetos de la paleta y del escritorio antes del código.
4. Una sola tarjeta de aprobación por secuencia con gasto, con el coste total.
5. Reglas de la puerta externa, tras la propuesta de GPT.
6. Más adelante: dos agentes en un chat y qué significa el primer cable entre docs.
