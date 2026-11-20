# 070 · Sesión maestra 2026-11-19/20: workers con revisión de Neon e integración

Continúa la [069](069-2026-11-W47-master-cierre-fusion.md). Todo está en `main` (fast-forward desde `task/integracion`, `fcca386a`, con la aprobación del usuario el 2026-11-20; sin push). La app real no se tocó.

## Método

- **Workers:** Grok (Cursor) para el primer encargo; Sonnet en subsesiones visibles para el resto; GPT 6.2 Sol para diagnósticos de solo lectura y para los avisos; Opus 5.5 en agy como relevo del gasto.
- **Revisión:** Neon (agy) revisa cada entrega solo por el diff y la califica con la rúbrica del bus. Criterio 5, solución 5, comprobación 4, decisiones 3 y rapidez 2,5. Las notas están en `~/.local/share/ogs-workers/notas-ponderadas.tsv`.
- **Diagnóstico previo:** GPT diagnosticó en paralelo, con `archivo:línea`, cada encargo antes de implementarlo.
- **Una sola suite completa:** las sesiones solo corren `test:related` y los checks rápidos; la sesión maestra corre `npm test` una vez, sobre la integración.

## Recorrido

1. **Rama menor de Grok** (`task/grok-menor`): A5, A2 y los tests intermitentes.
   - Grok agotó su cuota semanal en 15 minutos y no escribió informe. Neon lo calificó con 2,59, «con arreglos».
   - Sonnet hizo dos rondas de arreglos (3,82). Con autorización del usuario («Sí, autorizo») tocó el test protegido `writer-lock-panel`; la causa era la importación en frío.
2. **Fricción de Haiku y nombres de agentes** (`task/grok-friccion`):
   - nombres «Agent N» que se pueden renombrar;
   - aviso al soltar un cable en un puerto incompatible;
   - puertos con un tamaño mínimo;
   - «Add node…» y «Omnicanvas · Node canvas».
   - Notas: Sonnet 3,36 y, tras los arreglos con prueba en sandbox, 4,19.
3. **Revisión de Neon sobre las propuestas:** recomendó hacer el descriptor y aplazar el subnet. El usuario recordó que ya lo había decidido el 2026-11-18: primero el envoltorio genérico y después el subnet con inicio y fin.
4. **Gasto por una sola puerta** (`task/gasto-puerta`):
   - **Ronda 1** (8,1/10, integrada): el reintento que decide el agente ya no reenvía, y los planes de Nodes pasan por una sola puerta.
   - **Rondas 2 y 3** (3,67 y 3,63, no integradas): cerró rutas que ya existían y añadió dos decisiones del usuario (abajo), pero cada ronda trajo fallos nuevos.
   - Por el criterio fijado de antemano, la sesión se retiró y **Opus 5.5 en agy** la relevó: 4 commits y 4,01, incluido un doble cobro tardío tras Retry; agotó la cuota de agy.
   - GPT cerró las rutas restantes y luego el sobrebloqueo de gastos legítimos (4,29 → **4,56, fusionable**). Al fusionar, `credit.ts` chocó con la nota veraz de Grok, y la suite completa destapó `schema-guard` (Retry con esquema derivado) y la tarjeta nueva de Settings; quedaron arreglados con el test de dinero intacto.
5. **Descriptor** (`task/descriptor`, 4,17, integrado): los puertos, el valor, el paso y los valores por defecto viven en el descriptor, con tests de equivalencia. Faltan la frescura, la selección en `graph.ts` y la interfaz.
6. **Avisos** (`task/avisos-3`, GPT): tres rondas, con notas de 3,59, 3,96 y 4,68.
   - La primera recalculaba todo en cada arrastre.
   - Al fusionarla con el descriptor aparecieron conflictos, y 4 tests de contrato del núcleo que ya fallaban en la rama: Neon solo había corrido los tests que tocó. GPT los restauró sin cambiar las aserciones.
7. **Medición del arrastre** (200 nodos y 262 cables): los avisos no son más lentos; dan unos 2× más frames. Pero **las dos ramas arrastran a menos de 3 fps**: es un cuello de botella que ya existía en el lienzo.
8. **`npm test` sobre `task/integracion` (`c2a0b682`, con todo integrado):** 4560 pasan y 5 se omiten, 0 fallos.

## Decisiones del usuario

- **Auto-cambio de proveedor sin saldo:** configurable en Settings (preguntar, siempre o nunca; por defecto, preguntar). La primera vez pregunta, con «Yes, this time» y «Don't ask again», reutilizando el mecanismo del aviso de presupuesto.
- **Envío en curso tras recargar:** un aviso temporal «puede haberse cobrado», con «Don't show again». Todos los avisos silenciables se pueden ver y reactivar en Settings, desde un único registro.
- **Grok queda fuera del equipo:** la cuota no da para trabajar y el usuario no pagará la suscripción. Desinstalará Cursor.
- **Subsesiones visibles, no subagentes ocultos:** el usuario ve y aprueba sus permisos. Mientras el objetivo sigue en marcha, las respuestas en el chat ocupan una línea.
- **Próxima sesión:** revisión SOLID, DRY y KISS con Opus 5.5 en agy.

## Lecciones

- Un worker que suma funciones nuevas sobre un arreglo acumula fallos: una función, una sesión.
- Neon revisó solo los tests que tocó la rama y se le pasaron 4 contratos rotos. Toda revisión debe correr también los tests adversariales del área (`tests/adversarial-*`, `nodecore-review*`).
- Las suites completas repetidas dentro de las sesiones se comían el tiempo: unos 15 minutos por pasada bajo carga.
- El sandbox de un worker puede quedar vivo y bloquear el puerto 5183, y la sesión maestra no tiene permiso para detenerlo.
- El clasificador de permisos solo deja abrir sesiones cuando el usuario lo pide en sus propias palabras.

## Pendiente, en orden

1. **Push de `main`** cuando el usuario lo pida.
2. **Una revisión de Neon que corra la suite de su área**, no solo los tests tocados: dos fallos de dinero solo aparecieron con `npm test` completo.
3. **Arrastre a menos de 3 fps con 200 nodos** (crítico, ya existía): medir con la sonda y arreglar. Neon señaló cálculos O(n) en `CanvasNavigation` y `NodeSide`.
4. **Check permanente** que impida cálculos pesados del lienzo en cada arrastre.
5. **Próxima sesión:**
   - revisión SOLID, DRY y KISS con Opus en agy;
   - completar el descriptor (frescura, selección e interfaz) y ajustar su contrato antes del subnet (Neon: `env`, `sourceHandle`, `PlanStep[]`, `DefaultsEnv`);
   - envolver los componentes y el subnet;
   - prueba del usuario con clave real y paso de la app real a `main`;
   - registro durable de envíos en `jobs.ts`;
   - agentes de suscripción (baja prioridad).
