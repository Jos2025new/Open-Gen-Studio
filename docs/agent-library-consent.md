# P0 + P1a — Biblioteca y consentimiento

## Autorización y alcance

El 2026-10-05 Samuel dijo «Apruebo P0 + P1a con ese alcance». Se aplica [ADR 0005](decisions/0005-contrato-operativo-agente.md), H11/C06: uso temporal sin guardado; guardado explícito con efecto anunciado; referencias y dependientes conservados. P1b/P2/P3 siguen propuestos. Las pruebas no autorizan gasto, cambios de modelos, migraciones ni cambios del trabajo de precios.

Base: task/price-auth, HEAD 4f137ce. Al comenzar solo había documentación de la propuesta sin commit y el enlace node_modules esperado. Se conservó ese trabajo. No se creó rama/worktree ni se abrió la app real.

## P0: recorrido e invariantes

Recorrido inspeccionado: petición → herramienta/prompt → normalización y repair → tarjeta → aprobación/cancelación/revisión → ejecutor → inputs del dependiente → biblioteca/reutilización/recarga. Productores y consumidores: [tools.ts](../src/engine/agent/tools.ts), [context.ts](../src/engine/agent/context.ts), [plan.ts](../src/engine/plan.ts), [PlanCard.tsx](../src/components/chat/PlanCard.tsx), [runtime.ts](../src/engine/agent/runtime.ts), [executor.ts](../src/engine/executor.ts), [jobs.ts](../src/engine/jobs.ts).

Invariantes: refs mantiene las mismas imágenes y no escribe biblioteca; sujetos de paso sirven al plan sin guardarse; sujetos de asset anuncian guardado antes de aprobar; cancelar antes no guarda; revisar conserva el guardado solicitado; repetir no reemplaza una identidad; reanudar conserva el sujeto temporal sin regenerar su fuente.

Línea base conservada como tests antes de corregir: 3 fallos de 12 casos en plan-subjects/reference-sheet, reproducidos con Vitest. Después apareció otro fallo reproducible: el aviso de colisión de nombres prometía reutilización donde jobs aplica una imagen temporal. Los casos permanecen como protección en la suite.

## P1a: cambios, motivos y respaldo

| Cambio concreto | Evidencia exacta y motivo |
| --- | --- |
| Sustituir la promesa de que todos los subjects se guardan. Explicar refs para uso temporal, asset para guardado explícito y paso para uso temporal. | tools.ts:235 y context.ts:48,125,129,148. El ejecutor ya distingue estos efectos (executor.ts:271–284); había contradicción en las instrucciones. No se creó otro contrato ni herramienta. |
| Repair de un @Name desconocido ofrece refs y limita asset subjects al guardado solicitado. | plan.ts:1009. El mensaje anterior recomendaba agregar un subject desde un adjunto sin distinguir persistencia. El test de reparación fallaba antes. |
| Recuperar sujetos temporales al cargar outputs previos. | executor.ts:291 llama a la misma saveSubjectsOf usada al terminar un paso. Antes se cargaban outputs pero no la identidad temporal; el test encontraba inputs.subjects ausente en el dependiente. No vuelve a ejecutar el paso fuente. |
| Avisar con precisión cuando un sujeto temporal tiene nombre de biblioteca. | plan.ts:979–984; jobs.ts:476–478 da precedencia a la referencia local. El aviso decía «reused», contradiciendo esa ejecución. Solo cambió el aviso; biblioteca y precedencia se conservan. |

La tarjeta existente, PlanCard.tsx:203, ya anuncia «saved ... when you run it» para asset y «this plan only» para paso. No se cambió su layout. El ejecutor no interpreta el texto del usuario: la petición de guardar sigue siendo una obligación del contrato del agente y el efecto se presenta en la tarjeta. **No se afirma una barrera mecánica capaz de reconocer consentimiento semántico**, ni que un modelo real nunca emitirá un plan incorrecto. Añadir esa barrera requeriría decidir un contrato distinto.

## Tests y procedimiento

- [plan-subjects](../tests/plan-subjects.test.ts): dependencias, nombres, repair y coherencia de instrucciones. El aviso de alias temporal y el caso asset existente conservan sus diferencias.
- [reference-sheet](../tests/reference-sheet.test.ts): refs de adjunto y output previo; temporal generado; temporal recuperado; colisión con biblioteca intacta; guardado repetido sin reemplazo.
- [plan-revision](../tests/plan-revision.test.ts): propuesta sin escritura, cancelación y revisión seguida de aprobación. Respuestas LLM simuladas; usa el runtime real. No prueba que un LLM preserve espontáneamente esas elecciones.
- Focalizados: 28 tests en 5 archivos aprobados, incluyendo library y agent-procedure. TypeScript aprobado.
- Verificación completa: npm test -- --maxWorkers=2 aprobado: 694 tests, 124 archivos; 5 tests/archivos omitidos. Salvaguardas y check-docs aprobados. Duración de Vitest: 27,63 s. Los omitidos no se cuentan como comprobados. La primera pasada falló en agent-workspace, que exigía la frase anterior que también restringía temporales; se sustituyó esa expectativa por las distinciones aprobadas, manteniendo la prohibición de guardado por iniciativa propia.

Los mocks evitan proveedores y disco. No se eliminaron controles ni se añadieron diagnósticos a producción.

## Sandbox y evidencia visual

Se arrancó exclusivamente npm run dev:sandbox en 5183, tras liberarlo el usuario. Se comprobó que este checkout no tenía data/; prepareSandbox termina sin copiar cuando falta esa carpeta. No hubo cambio del lanzador.

Una primera apertura mostró material previo de .sandbox/data pese a las rutas de bloqueo de agent-browser. Se cerró sin interacción. La interceptación CLI **no se tomó como aislamiento efectivo**. La prueba se repitió con perfil nuevo y un init script que intercepta fetch antes de cargar la app: /x/store devuelve 503 y /x/ o destinos externos se rechazan. Se confirmó sesión vacía y contador de bloqueo del ping. No se leyó data/ real. No se comprobó aquí si la primera apertura produjo una escritura incidental del estado del sandbox; no se presenta ese intento como prueba aislada.

Fixture: imagen sintética 64×64; modelos del proveedor local, sin API keys; normalizePlan real, tarjeta real y clics Run/Cancel reales. No intervino un LLM. Los planes usan el proveedor local para producir imágenes de muestra; las capturas no prueban calidad generativa ni fidelidad de personaje.

Resultados observados:

1. Dos pasos con refs: s1 recibió la imagen; s2 recibió la misma y el output de s1; ambos done; biblioteca vacía.
2. Tarjeta de guardado anunció el efecto. Cancel dejó biblioteca vacía. Run creó Kai con la imagen fuente. Recargar recuperó Kai del IndexedDB del perfil de prueba.
3. Un subject desde s1 llegó a inputs.subjects de s2 como Temp; no creó entrada Temp en biblioteca (Kai, guardado explícitamente antes, permaneció).
4. Con nombre Temp ya guardado, el aviso desplegado explica que la imagen temporal tiene precedencia y no cambia la biblioteca.

Capturas y fixture reproducible se entregan fuera del repositorio en outputs/agent-contract-review/h11. Navegador y servidores propios detenidos al finalizar. Vite rechazó la fuente Inter procedente del enlace node_modules: las capturas usan la alternativa disponible; no se cambió esa configuración.

## Latencia, riesgos y trabajo posterior

No se añadió petición de red ni paso de aprobación, y la recuperación ocurre una vez al reconstruir outputs previos, no por frame. Las instrucciones sustituidas tienen distinto tamaño; **no se midió el efecto sobre tokens o latencia de un LLM real**, ni una mejora respecto a los 84 segundos del transcript. La duración de Vitest (~1,6 s focalizados) no mide rendimiento de producción.

Riesgos conservados: un modelo puede proponer persistencia sin petición; una revisión puede perder decisiones si el modelo la emite mal; modelos sin soporte visual pueden usar descripciones (jobs), fuera de esta prueba local. El desplegable sigue llamándose «adjustments to the models» incluso para este aviso de sujetos: claridad mejorable, documentada sin ampliar ahora el alcance de GUI.

Seguimiento proporcionado: al modificar referencias, biblioteca, recovery o instrucciones, ejecutar estos casos y revisar el recorrido afectado; al cambiar modelos, contrastar inputs reales con autorización y máximo de gasto separado. Las sesiones reales, comprensión del aviso y latencia siguen sin verificar hasta pruebas autorizadas. Si un test pierde identidad o detecta escritura temporal en biblioteca, detener entrega y corregir o revertir este tramo, sin añadir una excepción textual como sustituto.
