# Evidencia del contrato operativo del agente

Estado: propuesta para revisión, sin implementación. Complemento del [ADR 0005](decisions/0005-contrato-operativo-agente.md). Base: task/price-auth, 4f137ce60230203ccee33ffa75bebb737f3ce224, 2026-10-05. Las líneas apuntan a esa revisión; revalidar al cambiar HEAD. Hechos, inferencias y sugerencias se distinguen en cada hallazgo.

### 5. Hallazgos, respaldo, matices y sugerencia concreta

#### H01. Confirmación de ajustes y aprobación son políticas distintas

Evidencia: [context.ts:40](../src/engine/agent/context.ts#L40) exceptúa operaciones sobre resultados existentes; [context.ts:44](../src/engine/agent/context.ts#L44) dice confirm_settings «always». [tools.ts:154](../src/engine/agent/tools.ts#L154) también exceptúa operaciones y Nodes. [runtime.ts:1719–1725](../src/engine/agent/runtime.ts#L1719) exige ajustes solo si hay kind image/video, fuera de Nodes y en planes nuevos. Un plan solo op no activa ese filtro. [runtime.ts:559–589](../src/engine/agent/runtime.ts#L559) muestra el plan y aprueba automáticamente únicamente en Auto cuando needsSpendCheck es falso; [pricing.ts:111](../src/engine/pricing.ts#L111) considera gasto positivo, desconocido o lowerBound. No se confirmó una omisión universal de aprobación para op.

Conclusión: contradicción textual confirmada; el filtro de ajustes tiene autoridad efectiva por kind, no por el hecho de generar una salida nueva. Inferencia: esto puede producir vacilación o tarjetas innecesarias. Sugerencia: expresar una sola política de ajustes, separada de autorización de gasto y aprobación del plan, y hacer que prompt y herramienta la reflejen. No imponer una tarjeta a toda op ni eliminar tarjetas sin una decisión de producto. La excepción actual se toma como línea base provisional, no como intención aprobada.

#### H02. Quién puede elegir un modelo

Evidencia: [context.ts:85–87](../src/engine/agent/context.ts#L85) permite elegir modelos por tarea si el usuario no eligió; [context.ts:128](../src/engine/agent/context.ts#L128) permite un modelo cuando encaja mejor. [tools.ts:260](../src/engine/agent/tools.ts#L260) describe model como «only when the user names a model». La tabla por tarea solapa edición, ilustración e identidad, sin resolver ese cruce.

Conclusión: contrato y prompt discrepan; la tabla requiere arbitraje en casos como edición de personaje ilustrado. No se demuestra qué modelo creativo es mejor. Sugerencia: distinguir elección explícita, recomendación creativa y resolución mecánica de variante. Alinear campo model con la política aceptada; no conservar la tabla duplicada como si fuera un algoritmo inequívoco. Revisar si la elección creativa necesita prioridades mínimas por capacidad o si debe quedar como recomendación, evitando una taxonomía creciente de excepciones.

#### H03. Resolución mecánica ya existente y significado de omitir model

Evidencia: [plan.ts:781–825](../src/engine/plan.ts#L781) valida entrada, normaliza campos y admite modelo explícito para edit/video; [plan.ts:97](../src/engine/plan.ts#L97) resuelve nombres de familia, pero deja refs concretas para validar. [catalog.ts:352–366](../src/engine/catalog.ts#L352) usa modelo fuente o variante compatible. [catalog.ts:392–399](../src/engine/catalog.ts#L392) sigue generación fuente cuando puede y después modelo del motor. [catalog.ts:442–448](../src/engine/catalog.ts#L442) contempla override de operaciones y defaults. [jobs.ts:1046](../src/engine/jobs.ts#L1046) aplica precedencia: nodeChoice, _modelRef, input.modelRef o elección por fuente/motor.

Conclusión: el agente no necesita rededucir compatibilidad ni variantes; omitir modelo no equivale necesariamente al visible en el compositor. Matiz: no toda referencia incompatible se corrige automáticamente; algunas se rechazan. Sugerencia: comunicar fielmente la resolución existente y reutilizarla para preparación/estimación/ejecución cuando sea necesario. No crear otra herramienta resolver ni arquitectura paralela sin demostrar una carencia del contrato actual.

#### H04. OPS conoce el motor, pero el resumen del agente lo omite

Evidencia: [ops.ts:13–30](../src/engine/ops.ts#L13) distingue motor edit/local y entradas/salidas; [ops.ts:107–151](../src/engine/ops.ts#L107) define angle como edit, con instrucción de preservar identidad. [context.ts:24–28](../src/engine/agent/context.ts#L24) deriva líneas desde OPS, pero muestra solo id, campos, entrada/salida y descripción. [executor.ts:241–259](../src/engine/executor.ts#L241) prepara y ejecuta una generación para op.

Conclusión: hay una fuente común parcial aprovechable. image→image no informa si hay proveedor ni autorización. Sugerencia: enriquecer ese resumen con semántica derivada del motor y efectos relevantes, de forma compacta. Mantener op como representación interna si conviene; describir la capacidad por resultado para el operador. No equiparar local con ausencia de efectos de estado ni proveedor con un precio conocido.

#### H05. Proporción, resolución y estilo no tienen la misma herencia

Evidencia: [jobs.ts:1092–1105](../src/engine/jobs.ts#L1092) aplica opciones «match input» o proporción soportada más cercana a la fuente. La resolución parte de coerceSettings; en esa ruta no se copia explícitamente la resolución de la generación fuente. [plan.ts:906–908](../src/engine/plan.ts#L906) añade style solo a image/video. [context.ts:132](../src/engine/agent/context.ts#L132) pide no repetir estilo; angle usa su instrucción/note, no ese bloque global.

Conclusión: conservación de proporción puede ser aproximada y style global no se añade a op. No se acredita pérdida visual concreta por esto. Sugerencia: explicar estas diferencias en contratos y resultados resueltos. No prometer herencia universal ni cambiar todas las ops para aplicar style: eso podría alterar una edición que debe conservar el original. Especializaciones como [minimax.md:37](../src/engine/guides/minimax.md#L37) piden estilo al inicio y al final; delimitar técnica específica frente al bloque global, sin afirmar un fallo de proveedor no probado.

#### H06. Identidad descrita frente a identidad referenciada

Evidencia: [context.ts:100](../src/engine/agent/context.ts#L100) prohíbe parafrasear referencias y [context.ts:129](../src/engine/agent/context.ts#L129) redescribir identidad. [catalog.ts:24](../src/engine/skills/catalog.ts#L24) exige repetir anchors. [product.md:4–6](../src/engine/guides/product.md#L4) describe la foto y repite literalmente la ficha. [archviz.md:5](../src/engine/guides/archviz.md#L5) sí delimita el caso de imagen del usuario; [directing.md:17–21](../src/engine/guides/directing.md#L17) delimita identidad sin imagen.

Conclusión: personajes/productos contienen un conflicto; hay precedentes internos para distinguir los casos. Inferencia: duplicar una descripción puede introducir rasgos divergentes; no se midió deriva de identidad. Sugerencia: una política común según si la referencia realmente llega al modelo; las skills enseñan cómo indicar rol, restricciones y cambios, y cómo describir identidad cuando no existe entrada visual. No prohibir toda descripción en todas las circunstancias.

#### H07. Preguntas de Auto y decisiones creativas

Evidencia: [context.ts:37](../src/engine/agent/context.ts#L37) asigna decisiones creativas al agente, salvo Guided; [context.ts:261](../src/engine/agent/context.ts#L261) limita Auto a datos del usuario. [staged.md:12](../src/engine/guides/staged.md#L12) manda preguntar look también en Auto. [runtime.ts:1510](../src/engine/agent/runtime.ts#L1510) limita rondas, pero no decide semánticamente qué pregunta es dato imprescindible.

Conclusión: las preguntas creativas en Auto tienen políticas opuestas. Sugerencia para revisión: conservar el principio de que el agente decide lo creativo en Auto y pregunta datos imprescindibles o elecciones con efecto material sobre alcance/gasto; Guided ofrece opciones creativas dentro del límite. Retirar de staged la obligación universal sobre look. Si el producto quiere otra conducta, debe decidirse una vez y reflejarse en todos los contratos. La preferencia de eficiencia del usuario respalda reducir arbitraje, pero no constituye aprobación de este cambio exacto.

#### H08. Vistas separadas y ficha compuesta

Evidencia: [workflows.ts:85–96](../src/engine/skills/workflows.ts#L85) define character-sheet con frontal + angle. [staged.md:19–20](../src/engine/guides/staged.md#L19) pide reference_sheet y prohíbe angle para construir la ficha. Ambos pueden cargarse juntos (sección 4).

Conclusión: conflicto confirmado, especialmente relevante para el transcript, aunque el pedido allí especifica imágenes separadas. Sugerencia: definir entregables distintos: N vistas solicitadas, cada una una salida; o ficha compuesta, una imagen con layout. Adaptar/describir el workflow existente según el entregable, sin añadir una vista frontal, una ficha o una etapa no pedida por similitud verbal. La referencia aportada debe poder servir como fuente canónica, sin regenerarla por ritual.

#### H09. Etapas, piloto y generaciones adicionales

Evidencia: [staged.md:8](../src/engine/guides/staged.md#L8) establece test de 5 s para final ≥10 s o varios clips; [staged.md:24](../src/engine/guides/staged.md#L24) define piloto como ficha + clip 1 y lo excluye para un solo clip. [workflows.ts:147](../src/engine/skills/workflows.ts#L147) UGC habla de varios planes tras revisión, pero [workflows.ts:154–156](../src/engine/skills/workflows.ts#L154) presenta ficha y vídeo juntos. [guides.ts:63](../src/engine/skills/guides.ts#L63) manda seguir esa estructura.

Conclusión: test y piloto podrían ser procedimientos distintos; no se declara su relación ni prioridad. No se afirma que un workflow se ejecute automáticamente como plantilla: lo interpreta el agente. Sugerencia: definir cuándo una etapa es requisito por una dependencia real, cuándo recomendación y cuándo elegida por el usuario. Unificar la representación de etapas del workflow con su texto. No generar tests, candidatos o fichas adicionales sin el alcance/autorización correspondiente; no usar «expensive» o «modelo nuevo» como umbrales indefinidos que obliguen al agente a inventar política.

#### H10. Continuidad de identidad y continuidad de toma

Evidencia: [staged.md:32](../src/engine/guides/staged.md#L32) exige continuación mediante último frame/key still de misma escena. [workflows.ts:192–197](../src/engine/skills/workflows.ts#L192) story define beats cerrados y no conecta firstFrame en sus pasos. [directing.md:3](../src/engine/guides/directing.md#L3) recomienda un movimiento por clip, mientras story permite varios shots temporizados.

Conclusión: ámbito operativo ambiguo; no toda continuidad narrativa pide continuidad física de cámara. Las técnicas de una toma tampoco deben imponerse sin ámbito a un clip multi-shot. Sugerencia: distinguir toma continua, montaje de escenas y personaje recurrente; usar último frame solo cuando se continúa la toma. Las referencias de identidad se mantienen donde el modelo las admite. No forzar todos los relatos a una cadena visual ni retirar la dependencia de flujos que sí continúan una toma.

#### H11. Sujeto temporal, biblioteca y mensajes de reparación

Evidencia: [tools.ts:235](../src/engine/agent/tools.ts#L235) promete guardar subjects, incluso desde un paso. [context.ts:125](../src/engine/agent/context.ts#L125) distingue asset guardado y sujeto de paso temporal. [executor.ts:273–284](../src/engine/executor.ts#L273) guarda asset y mantiene paso en local; [executor.ts:363–366](../src/engine/executor.ts#L363) escribe biblioteca. [reference-sheet.test.ts:35–55](../tests/reference-sheet.test.ts#L35) prueba que el sujeto generado no se guarda. [plan.ts:1005](../src/engine/plan.ts#L1005) recomienda añadir subjects para corregir @Name desconocido sin explicar el posible guardado.

Conclusión: el contrato promete un efecto que el test/ejecutor niegan para un caso; el arreglo propuesto por el validador puede tener un efecto de persistencia cuando usa asset. No se observó guardado indebido en una sesión real. Sugerencia: mantener explícita la diferencia entre alias temporal y biblioteca; corregir descripción y repair message. Antes de cambiar estructura de subjects, decidir si su efecto dependiente de from es el contrato deseado; considerar primero una corrección compatible, no una migración. La normalización no dispone aquí de una prueba independiente de que el humano pidió guardar: es una frontera que hay que evaluar, no declarar como permiso demostrado.

#### H12. Recarga de guías y compactación

Evidencia: [context.ts:52](../src/engine/agent/context.ts#L52) permite releer; [context.ts:92](../src/engine/agent/context.ts#L92) dice nunca recargar en la conversación. [attachments.ts:120–149](../src/engine/agent/attachments.ts#L120) compacta referencias a partir de 40.000 caracteres; [runtime.ts:294](../src/engine/agent/runtime.ts#L294) actualiza historial; [runtime.ts:300](../src/engine/agent/runtime.ts#L300) comprueba texto presente; [runtime.ts:1692–1705](../src/engine/agent/runtime.ts#L1692) devuelve guía completa si ya no está.

Conclusión corregida: no se confirmó bloqueo de recuperación; la contradicción es textual. El mensaje «ya cargada» no implica contenido perdido cuando la función comprueba presencia. Sugerencia: sustituir prohibición por no duplicar contenido que aún está disponible y releer cuando fue compactado. Conservar umbral/cache existentes hasta medir; no eliminar compactación por este hallazgo.

#### H13. Respuesta breve y texto como entregable

Evidencia: [context.ts:58](../src/engine/agent/context.ts#L58) limita texto fuera de tools a dos frases; [social.md:19](../src/engine/guides/social.md#L19) exige copy listo para pegar con campos/variantes. [context.ts:119](../src/engine/agent/context.ts#L119) ya admite pasos text.

Conclusión: incompatibilidad de presentación, no error demostrado de generación. Sugerencia: delimitar mensajes de estado frente a entregables de texto; usar el mecanismo existente adecuado al pedido. No aplicar una excepción verbosa a toda respuesta ni inventar otra UI para copy.

### 6. Latencia y evidencia de tests

Del transcript: 27 + 33 = 60 s de pensamiento visible, aproximadamente 71,4 % de 84 s. Los otros 24 s no pueden repartirse entre red, lectura, validación, UI o sobrecarga. El registro permite observar reconsideración repetida, no probar que el prompt explique todo el tiempo. No hay medición de latencia de generación, coste real, p50/p95, tasa de conflicto ni comparación de modelos. No hay promesa de ahorro temporal.

Auditoría previa: comando npm test -- --maxWorkers=2 tests/history-trim.test.ts tests/reference-sheet.test.ts tests/settings-phase.test.ts tests/guides.test.ts. Resultado: 4 archivos / 23 tests aprobados; duración Vitest 1,60 s; safeguards y check-docs aprobados. Son tests existentes, con mocks en los casos de agente/persistencia; no se llamó a proveedores. No se ejecutó la suite completa en esa auditoría. Véanse [history-trim.test.ts](../tests/history-trim.test.ts), [reference-sheet.test.ts](../tests/reference-sheet.test.ts), [settings-phase.test.ts](../tests/settings-phase.test.ts), [guides.test.ts](../tests/guides.test.ts).

Esos tests confirman comportamientos concretos; no prueban coherencia semántica del prompt ni eficiencia de un LLM. Las aserciones de preservación textual de skills protegen regresiones de un refactor, pero no convierten texto conflictivo en una política correcta. Un test puede tener que cambiar tras aceptar esta propuesta; no se borrará cobertura funcional para hacer pasar una modificación.
