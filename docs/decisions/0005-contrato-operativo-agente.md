# 0005 — Contrato operativo del agente: propuesta para revisión

## Estado

Propuesto

Samuel aprobó únicamente P0 + P1a el 2026-10-05: referencias temporales sin guardado; guardar requiere petición explícita o aceptación de una oferta de guardado. El resto permanece Propuesto. La implementación y sus límites se registran en [P0 + P1a: evidencia de la corrección](../agent-library-consent.md). Este ADR no autoriza P1b, P2, P3, migraciones ni llamadas de pago.

## Fecha

2026-10-05

## Contexto

### 1. Qué pidió el usuario y cómo evolucionó el alcance

Samuel aportó un transcript de una petición: «Hazme una serie de tres vistas de este personaje, una imagen por vista: lateral, trasera, tres cuartos». Es material para analizar el sistema, no una orden de generar esas imágenes en esta sesión. El archivo aportado se llama Texto pegado.txt, adjunto 4160e2be-da13-49af-8266-0964d116c042. El registro muestra «Worked for 84s», dos bloques de pensamiento de 27 y 33 segundos, lectura de Character sheet y preparación de un plan; el pie identifica mimo-v2.6-flash / NanoGPT. No muestra una ejecución de proveedor ni sus resultados.

El usuario pidió atacar la raíz transversal, evitando sumar una excepción por tarea hasta acumular cientos de reglas. Señaló que el agente debe ser un operador eficiente que entienda el procedimiento de un vistazo y que la etiqueta op no explica lo necesario. Después autorizó corroborar en código si la resolución ya existe y ampliar la revisión a system prompts, skills y workflows. Finalmente pidió documentar la propuesta completa, el respaldo exacto, las inferencias, qué se hizo, qué se sugiere y por qué, dejando el plan para revisar antes de implementar.

Los comentarios de GPT 6 Astra fueron aportados por Samuel como material de contraste. Sus matices incorporados a esta propuesta son: resolver decisiones mecánicas en código donde corresponda; comprobar primero lo existente; eliminar duplicaciones en vez de añadir una regla de precedencia sobre contradicciones intactas; no equiparar comportamiento actual con intención deseada; priorizar datos, aprobación y etapas que agregan generaciones. Astra dijo expresamente que no verificó personalmente las referencias. Sus comentarios no se usan como prueba del repositorio ni como autorización de implementación.

### 2. Entorno, restricciones y procedencia

Base inspeccionada: worktree ogs-price-auth, rama task/price-auth, HEAD 4f137ce60230203ccee33ffa75bebb737f3ce224. Al iniciar esta documentación: árbol limpio salvo node_modules sin seguimiento, enlace esperado. Las líneas de código citadas abajo pertenecen a esa revisión y deben revalidarse si cambia HEAD.

Se respetan [AGENTS.md](../../AGENTS.md): datos reales protegidos, revisión distinta de implementación, sandbox exclusivo para pruebas visuales, aprobación explícita y máximo para llamadas de pago. Samuel ya había indicado reutilizar este worktree, no crear ramas ni worktrees, no tocar data/ real, checkout principal, better-worflows-xyz765 ni trabajo de precios; no fusionar ni hacer push. Este trabajo no necesita abrir la app, arrancar servidores ni gastar dinero.

Método: búsquedas acotadas con rg; lectura de SYSTEM_PROMPT, contexto dinámico, contratos de herramientas, ensamblado de guías, workflows, skills pertinentes y funciones de normalización/ejecución/persistencia. No se leyó toda la app. Skill directora de la auditoría: code-review-and-quality; para documentar: documentation-and-adrs. No hubo subagentes. No se modificaron instrucciones, skills o código de la app durante la auditoría.

### 3. Cómo leer la evidencia

- Hecho de código: la condición o transformación está presente en el código leído. No prueba por sí sola una ejecución real.
- Contradicción textual: dos instrucciones aplicables indican conductas incompatibles. Prueba el conflicto de texto; no cuál elegirá un modelo concreto.
- Ambigüedad operativa: conceptos o ámbitos insuficientemente delimitados, aunque pueda existir una interpretación consistente.
- Inferencia: consecuencia plausible de los hechos. Se declara como tal, sin atribuirle una frecuencia ni una latencia demostrada.
- Propuesta: cambio sugerido para revisión. No describe una implementación terminada ni una preferencia del usuario que no haya expresado.

La auditoría no demuestra que todos los posibles conflictos estén encontrados. No se reconstruyó el prompt completo exacto enviado en el transcript: falta su snapshot, estado del compositor, contratos enviados y argumentos reales de los tool calls. La coincidencia entre el registro y el código actual apoya la hipótesis, pero no demuestra identidad de versión ni causalidad total.

### 4. Evidencia del contexto realmente ensamblado

El sistema no envía únicamente un prompt aislado. [runtime.ts, AGENT_SYSTEM, línea 1281](../../src/engine/agent/runtime.ts#L1281) concatena MUST, CAPABILITIES, SYSTEM_PROMPT y MUST otra vez. [tools.ts, CAPABILITIES/MUST, líneas 477–488](../../src/engine/agent/tools.ts#L477) deriva capacidades desde herramientas y añade órdenes generales. [context.ts, buildContext, líneas 254–267](../../src/engine/agent/context.ts#L254) agrega modo, skill activa y workflow elegido. [guides.ts, readGuide, líneas 55–63](../../src/engine/skills/guides.ts#L55) devuelve workflow y guidance de su skill. [runtime.ts, modelGuidesFor, líneas 308–311](../../src/engine/agent/runtime.ts#L308) adjunta staged a workflows cuando no está ya presente.

Conclusión respaldada: varias contradicciones llegan juntas al agente mediante rutas existentes. Límite: esto no prueba que todos los bloques aparecieran en cada llamada del caso aportado. La duplicación de MUST se registra como composición actual, sin afirmar que explique la demora ni proponer quitarla sin comparación.

### 5–6. Hallazgos y verificación de la auditoría

El respaldo detallado, sus matices y las sugerencias H01–H13 están en [Evidencia del contrato operativo](../agent-contract-evidence.md). Forma parte de esta propuesta y comparte su estado Propuesto, base Git y límites.

## Decisión

### 7. Propuesta central y tres frentes delimitados

La ampliación [Recorridos, UX y validación sostenida](../agent-contract-validation.md) concreta qué cambiar, qué debe ver el usuario, las conexiones afectadas, la comprobación inmediata y a largo plazo y los riesgos. Forma parte de este mismo plan; no agrega una metodología independiente.

La propuesta es que cada decisión operativa tenga un responsable inequívoco, que se eliminen sus definiciones duplicadas y que el agente reciba la información pertinente para actuar. No basta añadir «esta regla manda» encima de instrucciones incompatibles. Tampoco se presupone que el código existente sea la política deseada.

| Frente | Incluye | Por qué se delimita así | Fuera de este frente |
| --- | --- | --- | --- |
| F1. Políticas generales | Ajustes/aprobación, preguntas según modo, alcance de etapas adicionales y persistencia. Responsable común; skills/workflows no redefinen permisos. | H01, H07, H09, H11 afectan datos, decisiones humanas y gasto; necesitan intención de producto antes de texto o código. | Nueva política de precios/proveedores, migraciones, autorización inferida del silencio. |
| F2. Distinciones operativas | Vistas/ficha; identidad/toma; sujeto temporal/biblioteca; requisito/recomendación; referencia visual/descripción sin imagen. | H06, H08–H11 muestran conceptos mezclados que producen acciones diferentes. Delimitar aplicabilidad elimina conflictos sin una regla por tarea. | Nuevos workflows por cada frase, recetas universales, cambios de capacidad de modelos. |
| F3. Contrato fiel y resolución existente | Resumen OPS, model/variantes/herencia/style, reparación, estado de guías y preparación antes de aprobar. | H02–H05, H11–H13: el operador debe conocer efectos reales y decisiones ya resueltas, sin reconstruir ejecución. | Nueva arquitectura/tool resolver por defecto, reescritura de agente/ejecutor, promesas de coste o calidad no verificadas. |

Los frentes tienen dependencias: F1 decide políticas; F2 delimita sus ámbitos; F3 las comunica y conecta a resolución/validación. No son tres fuentes independientes. La prioridad de intervención es persistencia y aprobación, después etapas que agregan generaciones; luego coherencia creativa y recuperación de guías. Es propuesta de orden, no autorización de implementación.

### 8. Procedimiento objetivo del operador

Entender entregable e inventario → elegir capacidad/procedimiento pertinente → usar resolución existente → preguntar únicamente lo imprescindible pendiente o presentar el plan en el límite autorizado → ejecutar solo por la ruta de aprobación vigente → informar el resultado observado.

El agente conserva interpretación y decisiones creativas. El código conserva compatibilidad, variante, parámetros y autorizaciones mecánicas que ya implementa. El usuario conserva decisiones materiales pendientes y aprobación requerida. Si la resolución depende de una salida futura, el plan dice qué se resolverá después y bajo qué restricción; no presenta una predicción como elección firme.

Una petición directa con referencia y tres vistas debe conservar exactamente tres entregables, sin ficha, frontal nueva, piloto o guardado implícito. Es un caso de aceptación propuesto basado en la petición literal, no una implementación ya probada.

### 9. Decisiones de producto pendientes y recomendaciones

| Decisión a revisar | Recomendación concreta | Respaldo y límite |
| --- | --- | --- |
| Ajustes de op generativa | Mantener provisionalmente el filtro actual, diferenciarlo de gasto y decidir si la UI de plan basta para esas elecciones. | H01 prueba conducta, no preferencia de producto. No añadir confirmación universal por reflejo. |
| Auto y look | Agente decide look no fijado; pregunta datos imprescindibles y elecciones que cambien materialmente el alcance/gasto. | H07 y petición de eficiencia. Guided conserva opciones creativas. Requiere aceptación del comportamiento exacto. |
| Biblioteca | Identidad reutilizada en plan no implica guardar; guardado explícito. Primero corregir contratos y mensajes. | H11 y regla existente de no guardar sin petición. Estructura temporal definitiva pendiente; evitar migración. |
| Etapas adicionales | Dependencias necesarias se representan; piloto/candidatos extra se ofrecen o ejecutan solo dentro de la elección autorizada. | H09 y alcance mínimo. No se inventa umbral monetario nuevo. |
| Elección de modelo | Elección humana se conserva; variante compatible es mecánica; recomendación creativa no duplica routing. | H02–H03. No seleccionar nuevos proveedores ni familias en este documento. |
| Model/coste antes de aprobar | Mostrar selección efectiva conocida; identificar incertidumbre de fuentes futuras y revalidar diferencias por ruta existente. | H03 y estimateSteps/approvePlan. No garantiza igualdad ya comprobada ni convierte estimación en máximo. |

El [ADR 0004](0004-coste-maximo.md) exige máximo/aprobación como regla operativa y declara que no todos los flujos lo imponen. [priceAuthorization.ts:28–59](../../src/engine/priceAuthorization.ts#L28) pausa solo diferencias conocidas materiales bajo sus condiciones y permite otros casos. No se propone endurecer/reducir esa política en este trabajo ni presentarla como equivalente al ADR. Antes de una comparación de pago se necesita aprobación específica de proveedor, modelo, alcance y máximo; el plan presente no la concede.

### 10. Plan de implementación propuesto, pendiente de revisión

P0. Aplicar desde el primer cambio la ficha recorrido → consumidores → invariantes → cambio intencional → evidencia del complemento de validación. Cerrar las decisiones materiales de la tabla anterior necesarias para ese tramo, sin reabrir las ya aceptadas ni bloquearlo por decisiones independientes. Identificar responsable, consumidores, textos sustituidos y excepciones justificadas. Verificar base Git y conservar un caso/línea base reproducible antes de editar, no al terminar P4.

P1a. Biblioteca y consentimiento (H11, C06): alinear tools/context, planSubjects/unknownMentions, executor y PlanCard. Recorrido: adjunto/resultado → referencia temporal o petición de guardar → plan que explica el efecto → aprobación → ejecución → reutilización/recarga. Para uso temporal de una imagen existente, reutilizar refs; no pasar por subjects con from asset, que actualmente guarda. Subjects de paso permanecen temporales: no prometer guardado automático. Si hace falta otro contrato, decidirlo antes de cambiar ejecución; corregir texto por sí solo no demuestra C06. Conservar serialización y biblioteca existente, sin migración. Probar sujetos existentes/desconocidos, revisión, cancelación y reintento en sus rutas pertinentes.

P1b. Ajustes y aprobación (H01–H03, C07–C09): recorrer elección/entradas → confirmación cuando aplique → plan → aprobación → resolución efectiva → resultado. Alinear tools/context/runtime/plan y tarjeta con la política aceptada. Reutilizar resolución, estimación y autorización existentes; contrastar image/video/op/local y los modos afectados. Separar ajuste, autorización de gasto y aprobación del plan. No introducir una confirmación universal ni alterar la política económica incidentalmente.

P2. Etapas que agregan generaciones (H08–H10, C01–C02/C05/C12): delimitar dependencia necesaria, recomendación y extra elegido; sincronizar texto y pasos de staged/workflows. Comprobar número de salidas, candidatos, fases y fuentes antes y después. La referencia aportada no requiere regeneración ritual. No eliminar una preparación técnicamente necesaria para reducir pasos; explicar su motivo y revisar alcance antes de ejecutarla. Distinguir continuidad de toma e identidad donde cambien dependencias entre etapas.

P3. Coherencia y eficiencia (H04–H07/H12–H13): alinear Auto/Guided, identidad visual/textual, herencia de parámetros, resumen OPS, recuperación de guías y copy. Archivos candidatos: context/tools, skills/catalog/workflows, guías específicas y runtime/attachments solo según la ruta afectada. Eliminar políticas incompatibles sin borrar técnicas con ámbitos distintos. Probar contexto compuesto, no solo guías aisladas. Cambiar lógica solo ante discrepancia reproducida; no crear otro resolver. La comparación entre estimateSteps, presentPlan, approvePlan, opSpec y checkStepAuthorization pertenece a P1b; cubrir allí fuentes futuras mediante resolución diferida y revalidación sin proveedor. Medir eficiencia aparte de corrección.

P4. Verificación conjunta e informe. Ejecutar tests pertinentes tras cada cambio y npm test completo al final (incluye safeguards/check-docs), typecheck cuando se toque TypeScript. Probar interfaz solo con npm run dev:sandbox, puerto 5183, fixtures propios y terminar servidor/browser. Capturar ajustes, plan, aprobación y efectos; no inferir éxito visual de tests. Comparación de agente real solo con autorización de pago separada. Entregar diff, evidencia, cambios de política y pendientes antes de considerar lista la rama. No fusionar/push.

Condición previa al arranque: [dev-sandbox.mjs:26–32](../../scripts/dev-sandbox.mjs#L26) copia data/ del checkout si existe. Comprobar aislamiento y no arrancarlo bajo una prohibición de lectura de datos reales sin resolver esa condición. La [receta de precio](../price-review-sandbox.md) documenta una alternativa sintética que debe contrastarse con las reglas vigentes; esta propuesta no cambia lanzadores ni debilita salvaguardas. Si P1–P3 cambia una decisión, mensaje o control visible, su comprobación visual pertenece a ese tramo y no se aplaza a P4.

Si se aprueba implementar: commits pequeños por política/concepto verificable, staging con rutas explícitas, reversión por commit. No reescribir serialización ni contratos persistidos salvo aprobación material posterior. Ningún archivo nuevo de más de 30 KB; no crecer módulos ya grandes con una nueva colección de reglas.

### 11. Casos representativos y criterios de aceptación

| Caso | Resultado/procedimiento esperado para revisar | Evidencia necesaria |
| --- | --- | --- |
| C01. Referencia + tres vistas separadas | Tres salidas desde la fuente, sin ficha/frontal/piloto/guardado extra; lado no fijado admite elección creativa coherente. | Contexto efectivo, llamadas y DAG, resolución model/params. |
| C02. Ficha compuesta desde referencia | Capacidad/layout de ficha; no tres imágenes independientes por confusión de término. | Guía cargada y plan según deliverable. |
| C03. Auto sin estilo explícito / Guided | Auto decide lo creativo según política aceptada; Guided puede preguntar opciones; ningún re-pedido de datos ya dados. | Historial de tarjetas y llamadas, tests del modo. |
| C04. Personaje/producto con y sin imagen | La referencia realmente enviada gobierna identidad; texto fijo cuando no hay imagen, sin órdenes opuestas en contexto. | Inputs del modelo + contexto, no solo prompt suelto. |
| C05. Toma continua / montaje narrativo | Último frame al continuar toma; escenas independientes conservan identidad sin dependencia física obligatoria. | DAG e inputs por clip. |
| C06. Sujeto temporal / guardar explícitamente | Uso temporal no altera biblioteca; guardar ejecuta efecto aceptado; repair de @Name no induce guardado inadvertido. | Estado biblioteca antes/después, undo si aplica y tests con mocks. |
| C07. Modelo explícito, omitido e incompatible | Precedencia/variante conocida coincide con ejecución o rechazo concreto; no cambio silencioso de elección humana. | Resolución normalizada y spec, variantes/source/default. |
| C08. Op local / generativa | Resumen permite distinguir motor y efectos; ajustes/aprobación obedecen política aceptada. | Contexto, tarjeta y llamada al ejecutor mock. |
| C09. Fuente futura | Pendientes señalados; selección/coste se revalidan cuando la fuente existe por mecanismos actuales. | Estimación y autorización antes/después con schemas/precios fixture. |
| C10. Guía compactada | Puede releerse sin prohibición contradictoria; no se duplica texto aún disponible. | Tests de historial por encima/debajo de umbral y respuesta read_guide. |
| C11. Copy solicitado | Entregable completo conservando mensajes de estado breves. | Texto/feed/plan conforme al pedido. |
| C12. Piloto y candidatos | Ninguna etapa/candidato adicional por regla indefinida; petición o elección autorizada determina alcance. | Rondas, pasos, count y aprobación por fase. |

Los mocks prueban contratos y rutas, no que un modelo comprenda mejor. La inspección semántica debe mirar bloques que coexisten y ámbitos, no buscar palabras como always con un lint y declarar coherencia. Evitar tests que solo inmortalizan una frase nueva o espejan la implementación.

### 12. Comparación de latencia propuesta

Primero fijar baseline del caso y escenarios, con snapshot efectivo del contexto y tool schemas, estado/modelos/opciones, versión y mismo pedido. Comparar antes/después bajo condiciones equivalentes; ejecutar varias repeticiones, reportar tamaño de muestra, tiempos individuales y dispersión. Registrar primer contenido útil, tiempo a plan válido, llamadas a herramientas, rondas/preguntas, rechazos/reintentos, tokens y caché si el proveedor los informa. Separar modelo, lectura de guía, validación, espera humana y generación. Las esperas humanas no se atribuyen al agente.

Mantener proveedor/modelo/ajustes equivalentes y registrar diferencias de caché; no cambiar de modelo para atribuirle a las instrucciones una mejora. Una muestra pequeña no sostiene p95 estable. No exigir un porcentaje arbitrario de ahorro: primero cero conflictos aplicables en casos revisados, procedimiento correcto y cero efectos extra; después evaluar si hay mejora temporal o regresión. Llamadas pagadas pendientes de presupuesto/selección/aprobación. No prometemos reducir 84 s a un número concreto.

## Alternativas

Añadir precedencia sin eliminar texto contradictorio: rechazado como solución principal; mantiene arbitraje y volumen. Unificar todo en un archivo enorme: rechazado; autoridad única no significa archivo único. Crear resolver/tool/arquitectura nueva: no justificado por la lectura; ya hay normalizador, routing, OPS y ejecutor. Cambiar solo el prompt: insuficiente para contratos/repair/persistencia o decisiones diferidas. Asumir código actual correcto y documentarlo: insuficiente; tiene que contrastarse con intención. Quitar todas las confirmaciones para acelerar: fuera de alcance y contrario a preservar decisiones humanas/gasto. Corregir todo en una PR masiva: dificulta revisar políticas y atribuir regresiones.

## Consecuencias

Beneficio esperado, aún no medido: menor necesidad de deducir procedimiento y efectos; contratos con ámbito claro; menos duplicaciones y preguntas innecesarias. Riesgos: borrar una técnica útil al quitar una duplicación, cambiar política de producto inadvertidamente, romper referencias/serialización, ocultar incertidumbre de coste y atribuir ahorro a un cambio de modelo/cache. Mitigación: decisiones pendientes explícitas, casos comparativos, límites de cada frente, reuse de resolución y commits reversibles.

No se incluyen reparación de Designer, controles de zoom, modo desarrollador, modelos nuevos, precios nuevos, migración de biblioteca, cambios de proveedor ni reescritura de UI. La revisión identifica áreas candidatas, no garantiza coherencia de toda la app. Si se descubre otro conflicto, se ubica en el responsable existente y se verifica su ámbito; no se añade automáticamente una nueva regla global.

### 13. Estado de esta entrega

Hecho: lectura y auditoría descritas; 23 tests existentes pasaron en la auditoría; documento propuesto, evidencia, complemento de recorridos/UX/validación e índice. La ampliación verifica fragmentos del historial y PlanCard/CSS; no demuestra todavía una mejora visual. No hecho: cambios de app, nuevos tests de coherencia/procedimiento, suite completa de esta propuesta, sandbox visual, llamadas reales, comparación de latencia ni aceptación de políticas. La documentación nueva se valida con check-docs y safeguards y se deja sin commit para revisión. El resumen de entrega informa el resultado efectivo de esos controles; no se promete anticipadamente que pasen.
