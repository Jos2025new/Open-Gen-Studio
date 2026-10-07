# Conservación entre resultados: alcance y verificación

Estado: implementado en contrato y validación; mejora del LLM y fidelidad visual sin verificar.

## Qué, por qué y respaldo

El usuario pidió formalizar y ejecutar una corrección transversal en la rama de integración. Su General Generative Project Model separa recursos, operaciones, ejecuciones y recorrido UX; masters y proyectos son opcionales. No se implementa toda esa arquitectura.

Caso observado en el sandbox: el plan «El cuento de Pili y las galletas» generó cuatro ilustraciones independientes, sin una referencia común; cada vídeo usó su escena como primer fotograma. El workflow recibido exigía una fuente común, pero permitía repetir rasgos textuales cuando faltaba imagen; sus ejemplos tampoco mostraban las conexiones entre escenas. Terminar los pasos no demostró continuidad visual. Es evidencia de una conexión ausente, no prueba de que toda deriva visual provenga de las instrucciones.

## Tres frentes implementados

1. **Qué conservar y de dónde:** política compartida en [procedure.ts](../src/engine/procedure.ts), comunicada en [context.ts](../src/engine/agent/context.ts) y [workflows.ts](../src/engine/skills/workflows.ts). Identidad, geometría, etiqueta, estilo u otras propiedades dependen de la tarea. Cambios explícitos quedan fuera del alcance de conservación. No impone masters, fichas ni generaciones adicionales.
2. **Cómo conectar y comprobar:** relación opcional `continuity: [{source, preserve, steps}]` en el contrato existente de plan. Una fuente puede ser un asset, capa o resultado de paso; varias relaciones permiten varias fuentes. [tools.ts](../src/engine/agent/tools.ts) conserva esa declaración; [plan.ts](../src/engine/plan.ts) valida la fuente y sus conexiones de contenido mediante [continuity.ts](../src/engine/continuity.ts). Texto repetido, `after` y `prompt_from` no equivalen a una referencia visual. Una escena derivada puede alimentar un clip sin duplicar referencias incompatibles. [runtime.ts](../src/engine/agent/runtime.ts) revalida las conexiones disponibles antes de ejecutar, también con IDs de Nodes.
3. **Qué ve y cómo se verifica:** [PlanCard.tsx](../src/components/chat/PlanCard.tsx) muestra propiedad y fuente junto al resumen, antes de aprobar. El ejemplo de historia enlaza escenas antes de clips; guías compartidas, de dirección, personajes y producto eliminan la alternativa textual como garantía equivalente. No guarda, regenera ni llama a proveedores por declarar continuidad.

## Pruebas y aceptación

- [continuity.test.ts](../tests/continuity.test.ts): personaje, edificio y producto; referencias comunes, escena→clip, texto/orden insuficientes, sujetos temporales, resultados independientes, cambios explícitos y candidato incorrecto.
- [continuity-plan.test.ts](../tests/continuity-plan.test.ts): parsing→normalización conserva el contrato, rechaza conexiones ausentes y fuentes desconocidas; la reparación no añade pasos ni guardados. Planes antiguos sin declaración siguen funcionando. Los workflows de los tres dominios reciben la política común.
- Typecheck, suite completa, salvaguardas, check-docs y diff-check se ejecutan antes del commit. El resultado exacto se informa en la entrega.

## Cómo medir mejora después

Con los mismos pedidos, modo, modelo y recursos, comparar: presencia de fuentes en los pasos necesarios, planes válidos al primer intento, reparaciones, preguntas redundantes, generaciones o guardados no pedidos y tiempo hasta plan válido. Comparar resultados con sus fuentes por identidad, geometría o detalles del producto. Separar planificación, ejecución, revisión visual y cargos. Una sesión rápida no demuestra causalidad; tampoco basta una suite verde para demostrar fidelidad.

Reutilizar estos casos cuando cambien instrucciones, contratos, entradas o modelos. No se añade telemetría, monitor periódico, nueva llamada LLM ni análisis visual en producción. La validación es local y acotada al tamaño máximo del plan; instrucciones y metadata sí añaden contexto, por lo que no se promete impacto de latencia nulo sin medirlo.

## Límites y riesgos

- Declaración opcional: el sistema no infiere automáticamente toda intención de conservación de texto libre. Si el agente omite `continuity`, no hay una garantía nueva de rechazo; los planes antiguos se conservan. La comparación real del LLM debe comprobar que la declare cuando corresponda.
- Conexión no equivale a fidelidad ni a relevancia de la fuente. Las capacidades y validadores existentes controlan las entradas compatibles; propiedades físicas o visuales requieren revisar resultados. Una cadena derivada puede introducir deriva aunque sus referencias sean correctas.
- Sujetos de pasos temporales se reconocen. Para declarar una fuente existente, usar sus refs explícitas; el checker no reconstruye todos los aliases de biblioteca. No se modifica biblioteca ni consentimiento.
- Campos, fuentes y relaciones expresan un propósito; no crean soporte nuevo para voz, 3D o modelos que no aceptan esas entradas. Debe explicarse cualquier limitación antes de aprobación.
- Sin prueba visual en sandbox ni nuevas ejecuciones de proveedor en esta intervención. No se regeneró ni alteró la sesión de Pili. No se comparó aún el comportamiento real del LLM antes/después.
- Reversión: revertir el commit de esta intervención. El campo es opcional y no cambia assets ni su serialización; conservar versiones y datos antes de cualquier migración futura.
