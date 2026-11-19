# 069 · Sesión maestra 2026-11-19 (segunda mitad): agentes por hilo, rondas adversariales y fusión

Continúa la [068](068-2026-11-W47-master-nucleo-nodos.md). La rama `task/nucleo-nodos` se fusionó en `main` (avance directo, `main` era ancestro) y se subió a GitHub con la aprobación del usuario. La app real sigue en `task/agent-forcing` y no se tocó: sus datos solo se migran cuando el usuario la pase a `main`.

## Recorrido

1. **Agentes en paralelo.**
   - El usuario preguntó qué implicaba cada opción y cómo lo resuelven n8n, LangGraph, AutoGen o ComfyUI, y eligió lo más versátil: paralelo con un hilo por agente.
   - Autorizó tocar `writerHandoff.ts` (zona protegida): «Lo autorizo, que lo haga Sonnet, YA». Sonnet pidió la confirmación también en su propia sesión, y el usuario se la dio.
2. **Historial por dueño** (Sonnet, `b892a9cd..f11c3c74`), con tests que fallaban antes. `writerHandoff` cuenta como ocupada una sesión con cualquier agente ocupado.
3. **Tanda de 5** (Sonnet, `086b815a..e33d9123`):
   - el doble gasto de `approveNodeRun`;
   - `expect_rev` y `replaces` en las herramientas del agente;
   - `deleteGeneration` por la capa de edición y el check por AST;
   - el rendimiento de los botones de ejecutar, el ledger y el resolvedor;
   - la migración importada al arrancar;
   - el ADR.
4. **Neon, primer ataque al historial por dueño:** 20 fallos reales ([informe-neon-owner](../nucleo-nodos/informe-neon-owner.md)). Diagnóstico: parchear el dueño sobre la proyección `session.agent` fuga por diseño.
5. **Arreglo de raíz: un hilo por agente** (`57c9c086`, `f6b5776a`), al estilo de `thread_id` de LangGraph.
   - `session.agent` y `syncAgents` desaparecen;
   - `migrateAgents` convierte los datos viejos;
   - 72 archivos de tests se reescribieron con un helper.
6. **Neon, segundo ataque:** 25 fallos reales ([informe-neon-hilos](../nucleo-nodos/informe-neon-hilos.md)). Causa común: el dueño seguía siendo opcional. Sonnet lo hizo obligatorio en todo el motor (`6afcf373..c4c6b440`).
7. **GPT 6.2 Sol, DRY y KISS** (solo lectura, [revision-dry-kiss-sol](../nucleo-nodos/revision-dry-kiss-sol.md)): 10 simplificaciones, aplicadas una por commit (`aae09317..b0025cd6`). Sol recomendó conservar `agentLane`, `main`, `onlyMain`, `recipientOf` y `resolveOwner`.
8. **Neon, ataque de cierre:** los 45 fallos anteriores seguían cerrados (90 de 90 tests, ninguno debilitado), pero salieron 14 nuevos ([informe-neon-cierre](../nucleo-nodos/informe-neon-cierre.md)). Sonnet los corrigió.
9. **Grok, crítica dura del núcleo** (en Cursor, por el bus; [critica-grok-nucleo](../nucleo-nodos/critica-grok-nucleo.md)). Tres frenos, corregidos con un test cada uno:
   - doble cobro en planes del lienzo;
   - un cable que cambia de imagen al borrar el resultado elegido;
   - borrar un agente perdía su memoria al deshacer.

   Además, una crítica de diseño que queda pendiente (ver abajo).
10. **Auditoría de cierre en paralelo** (Neon y GPT 6.2 Sol sobre el transcript y el código; [auditoria-cierre](../nucleo-nodos/auditoria-cierre.md)). La sesión maestra cruzó los dos informes. Últimos frenos, corregidos:
    - una sola puerta de cobro en los planes de Nodes;
    - deshacer no reconecta el resultado vecino;
    - dueño estable en filas antiguas;
    - `retired` sin tope que pierda hilos;
    - la recarga en Nodes;
    - el registro de la zona protegida.
11. **Prueba de Haiku sin contexto** en el sandbox ([prueba-haiku-final](../nucleo-nodos/prueba-haiku-final.md)): nada roto ni en rojo. La fricción encontrada va a pendientes.
12. **Suite completa** sobre `4d5fd436`: 4367 tests en verde y 3 fallos de tiempo (`path-boolean`, `pdf-look` y `writer-lock-panel`) que pasan solos (59 de 59). Son los intermitentes conocidos (pendientes, punto 11).
13. **Fusión:** `main` avanzó hasta la rama, se borraron las ramas absorbidas con sus carpetas y se subió `main` a GitHub, todo con la aprobación del usuario.

## Decisiones del usuario (vigentes, se suman a las de 068)

- **Agentes en paralelo, con un hilo por agente.** Cada agente lleva su historial, sus ajustes y su chat; dos pueden trabajar a la vez sin cruzarse.
- **Cable cuya fuente se borró** («Me parece bien»):
  - se va de la vista, sin rojo ni aviso;
  - deshacer lo devuelve conectado;
  - por dentro queda en `graph.broken` con `reason: 'deleted'`, que es silencioso;
  - solo `reason: 'incompatible'` se dibuja en rojo, con el motivo al pasar el ratón: el cable existe pero no puede funcionar, por ejemplo tras un cambio de modelo.
- **Controles «Model» y «To» de la tarjeta del agente:** aceptados como provisionales; su diseño es uno de los próximos puntos.
- **Fusión:**
  - mover `main` hasta la rama;
  - borrar las ramas absorbidas y sus carpetas;
  - archivar sus sesiones;
  - subir `main` a GitHub, con aprobación explícita.
  - La app real migra sus datos solo cuando el usuario la pase a `main`.

## Reveses y su causa

- **Tres veces «casi hecho».** Cada ronda adversarial encontró fallos reales: 20, luego 25, luego 14, y 3 de Grok. Tres causas:
  - se parcheó el dueño encima de una proyección rota en vez de ir a la raíz desde el principio;
  - el dueño quedó opcional;
  - los checks empezaron como regex.
- **Un subagente cambió el comportamiento sin aprobación** (`ddf27bcb`, paralelo con estado compartido), y no se frenó al instante. Eso disparó cuatro rondas.
- **56 commits sin suite completa ni 068 al día**, hasta que la auditoría de cierre lo señaló.
- **Ataques cortados:** el login de Antigravity caducó, la red cortó a Neon dos veces y la API dio un 404. Todo se retomó desde lo ya escrito, no desde cero.
- **Ruta relativa en `agy-run.sh`:** el script cambia de carpeta antes de leer el encargo. Hay que pasarle siempre una ruta absoluta.

## Lecciones

- **Si un diseño fuga dos veces, no se parchea la tercera:** se cambia la estructura, y el compilador hace cumplir la regla (dueño obligatorio).
- **Cada revisión necesita un criterio de salida fijado antes de empezar**, es decir, qué hallazgo frena la fusión. Si no, cada informe abre una puerta nueva.
- **Comprobar el SHA y el resultado antes de decir «hecho»**, y revisar el contrato antes de aceptar que se adapte un test.
- **Un fallo que ya existe en la base no frena una fusión que no lo empeora,** pero se arregla igual si es de dinero.

## Pendiente, en orden

1. **Diseño de los controles del agente** («Model» y «To») y nombres distintos para cada agente: Haiku vio dos opciones iguales, «Agent», en «Send messages to».
2. **Crítica de diseño de Grok:**
   - el descriptor debe declarar valor y puertos, para quitar los `switch` de `evaluate.ts`, `resolver.ts:78` y `graph.ts:458`;
   - el space como subnet, con nodos de Entrada y Salida y un plan de ejecución aplanado, antes de añadir más recorridos.
   - Decidirlo con el usuario: es la «varilla» que más cuesta cambiar después.
3. **Revisión de Neon sobre las propuestas** (ADR 0031, propuesta y diagnóstico). La pidió el usuario al principio y se perdió al reordenar.
4. **Rehacer el boceto de avisos** con la corrección del usuario (068, «Decisiones»), aprobarlo e implementarlo.
5. **Agentes de suscripción** como agentes reales de la app, mediante un túnel por la CLI oficial, ACP o MCP, sin API de pago ([investigacion-agentes-suscripcion](../nucleo-nodos/investigacion-agentes-suscripcion.md)). Después, una prueba de Haiku con dos agentes reales.
6. **Prueba del usuario** con una clave real y paso de la app real a `main`, que migra sus datos: necesita su aprobación.
7. **Rama menor de Grok** desde `main`: A5 (bucle de DeepSeek sin `prompt`), A2 (etiqueta de proveedor falsa) y los tests intermitentes `writer-lock-panel` y `path-boolean`.
8. **Fricción vista por Haiku:**
   - puertos diminutos con el zoom por defecto;
   - el primer clic de «Add node» no añade nada y no avisa;
   - nada indica que «Omnicanvas» es el lienzo;
   - Stop no se ve cuando la respuesta es inmediata;
   - un puerto incompatible no avisa al soltar (no concluyente);
   - «Run all» confirma todos los nodos, no solo uno.
9. **Envolver el resto de componentes como nodos** (ADR 0031) y dar panel al inspector; medir con grafos grandes.
