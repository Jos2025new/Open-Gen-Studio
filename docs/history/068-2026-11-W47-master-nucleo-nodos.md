# 068 · Sesión maestra 2026-11-18/19: núcleo de nodos (ADR 0031) en rama experimental

Rama `task/nucleo-nodos` (worktree `ogs-nucleo-nodos`, desde `task/sqlite-adopt`), sin push ni fusión. El usuario la prueba antes de fusionar nada.

## Recorrido

1. **Diagnóstico de puntos de desacople** (Sonnet, solo lectura): una tabla de entradas y salidas por componente ([diag-desacople](../nucleo-nodos/diag-desacople.md)).
2. **Revisión independiente** (GPT 6.2 Sol, [revision-desacople](../nucleo-nodos/revision-desacople.md)): la tabla vale como mapa, pero no para programar. Faltan puertos y el núcleo tiene dos caminos de cableado y un ejecutor que ignora los grupos.
3. **Cambio de enfoque** (sesión maestra, aprobado por el usuario): dejar el inventario, que no converge, y fijar un contrato de núcleo. GPT revisó la propuesta ([revision-nucleo](../nucleo-nodos/revision-nucleo.md)) y propuso 7 cambios. El resultado es el [ADR 0031](../decisions/0031-nucleo-de-nodos.md).
4. **Cadena que pidió el usuario:**
   1. Sonnet (subsesión) construyó las piezas 1 a 7 y las tiras 1 y 2.
   2. GPT encontró 8 fallos ([revision-commits-nucleo](../nucleo-nodos/revision-commits-nucleo.md)) y Sonnet los corrigió.
   3. GPT escribió tests adversariales: 10 fallos reales en 24 ([adversarial-nucleo](../nucleo-nodos/adversarial-nucleo.md)). Los reparó un subagente Sonnet.
   4. Suite completa en verde: 4208 tests.
5. **Prueba de usuario nuevo** (Haiku, sandbox): nada roto, pero tampoco demostró lo nuevo. No hubo generación ni segundo agente.
6. **Defectos visuales que vio el usuario**, arreglados y aprobados (`452f100f`, `38a13278`):
   - los puertos de los nodos de space flotaban fuera de la tarjeta (`.nc` con ancho fijo dentro de un envoltorio de 320 px);
   - el buscador de «Add connected node» era una caja metida en otra;
   - la barra de copiar y borrar quedaba lejos del nodo y con una sombra intensa.
7. **Gemini 4 Neon** (High), crítica y tests adversariales: 27 fallos reales en 32, después de dos rondas de GPT ([informe-neon](../nucleo-nodos/informe-neon.md)). Comprobado en el código. La causa era de estructura:
   - quedaban 34 escrituras del grafo por fuera de la capa única;
   - el estado de los agentes se intercambiaba entre ellos;
   - una aprobación se podía usar más de una vez.
8. **Arreglo de raíz** (Sonnet, a petición del usuario: «de raíz», no parchear los 27):
   - una sola vía de escritura, con `check-graph-writes` en `npm test`;
   - aprobaciones de un solo uso;
   - estado por agente;
   - registro de tipos abierto, con migraciones al cargar;
   - `commitSystemGraph` nombra los cables que quita.

   Los 27 tests de Neon pasan.
9. **Avisos y cables inválidos:** se leyó el código fuente de Blender 5.2.3 ([blender-avisos](../nucleo-nodos/blender-avisos.md)) y se encargó un boceto visual.

## Decisiones del usuario (vigentes)

- **Núcleo:** «todo es un nodo». El estado vive en el nodo y los paneles son vistas de sus parámetros. Las siete piezas del ADR 0031 son la base, y el space como subnet se decide más adelante.
- **Arreglos:** de raíz, nunca parche por parche. Un hallazgo que no rompe el contrato va a pendientes y no frena la tira.
- **Avisos a escala** (aprobado 2026-11-19):
  - solo el origen se marca fuerte, con el tirador en rojo, un icono de prohibido y «Se requiere …»;
  - los nodos afectados quedan apagados con «Bloqueado por …» e «Ir al origen»;
  - un contador «N problemas» con una lista que salta a cada nodo;
  - un space o grupo cerrado muestra el recuento de lo que tiene dentro;
  - un cable fijado cuyo origen cambió es un aviso ámbar, con «Usar el valor nuevo» o «Mantener el fijado».

  De Blender se copia: tres niveles con el icono del más grave, el cable inválido en rojo con su motivo, los avisos que suben al grupo y la búsqueda por texto de aviso. Lo que se evita: borrar cables cuando desaparece un socket.
- **Arreglos visuales de los nodos de space, el buscador y la barra:** aprobados tal cual.

## Reveses y su causa

- **«Hecho» antes de tiempo.** Tras GPT y una suite en verde di el núcleo por hecho, y Neon sacó 27 fallos más. Los tests en verde probaban lo que había, no el contrato.
- **Decisiones propias de un subagente** para no romper tests viejos: la edición sin `expect` en un nodo propio y la caída del inspector a la última ejecución. Neon las refutó y se quitaron.
- **Afirmaciones sin verificar.** Describí Blender de memoria y no era exacto: no pone en rojo la cabecera del nodo, pone un icono.
- **`pkill -f` con un patrón amplio** mató el propio shell al detener el sandbox.
- **La suite se paró dos veces** en `tsc`, por un cast en un test de GPT, y en `check-sizes`, porque `flow/actions.ts` creció.
- **La PC se apagó de noche** porque alguien desconectó el cable. No se perdió nada: cada parte tenía su commit.

## Pendiente, en orden

0. **Revisar un cambio de comportamiento** (`b07c5090`). Con el estado por agente, dos agentes de un mismo chat pueden trabajar a la vez y cada uno contesta sus tarjetas, aunque el otro esté ocupado. Antes eso se rechazaba. Sonnet cambió 4 tests viejos en ese sentido. Es coherente con «un chat tiene varios agentes», pero el usuario no lo ha aprobado; que lo ataque el Neon nuevo y lo confirme el usuario.
1. Commit del estado por agente (Sonnet) y suite completa.
2. Boceto de avisos para aprobar, e implementarlo después.
3. Un Neon nuevo que revise las propuestas y todo lo hecho; decidir con el usuario qué hacer con lo que señale.
4. Prueba del usuario en el sandbox, con una clave de proveedor: una generación real y dos agentes.
5. Decisión sobre el space: subnet o solo navegación.
6. Fusionar o no `task/nucleo-nodos`, y en ese momento actualizar `pendientes.md` y `docs/map.md`.

## Lecciones

- **Nada está hecho sin un revisor distinto del que lo construyó.** La suite no es evidencia del contrato. Antes de decir «hecho», un modelo distinto lo ataca: aquí, GPT y después Neon.
- **Un subagente no toma decisiones de diseño por su cuenta.** Si un test viejo choca con el contrato, lo reporta en vez de añadir excepciones.
- **Lo que dice cómo lo hacen Blender, Houdini u otros se verifica en el código o en sus documentos antes de usarlo.**
- **Para detener procesos**, por pid tras `readlink /proc/<pid>/cwd`, nunca con `pkill -f`.
- **Worktrees con `node_modules` enlazado:** `VITE_CACHE_DIR` en la carpeta y `systemd-run` con tope de memoria.
- **Modelos:**
  - GPT: `codex exec -m gpt-6.2-sol -s workspace-write --disable use_legacy_landlock`.
  - Gemini: `agy-run.sh <wt> <log> <brief> complejo gemini-4-neon-high`, con `VITE_CACHE_DIR` exportada.
