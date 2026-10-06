# Contrato del operador: corrección del recorrido

Fecha: 2026-10-06. Base: task/price-auth, 98a990a. Alcance autorizado por Samuel: «Resuelve eso. YA», continuado con «Continua». Esta entrega amplía la implementación de P0/P1a al recorrido transversal; no autoriza proveedores de pago, migraciones ni merge.

## Por qué se hizo

P1a corrigió biblioteca y recuperación de sujetos temporales, pero no corregía la deliberación del pedido original de tres vistas. El nuevo transcript aportado mostraba 73 s, frente a los 84 s del primero. Esos tiempos son evidencia del reporte, no una medición propia ni una comparación controlada. El error de alcance fue tratar un prerrequisito de persistencia como avance suficiente sobre el problema UX. Esta corrección une productores y consumidores del mismo procedimiento.

La lectura confirmó mecanismos existentes de validación, compatibilidad, resolución de variantes y autorización; no hacía falta un resolver nuevo. Sí coexistían contratos distintos: ajustes incondicionales frente a un gate por tipo de paso; elección creativa de modelos frente a campos reservados a elecciones humanas; operaciones sin motor visible; templates que imponían preparación, estilo y etapas adicionales. El respaldo histórico completo permanece en [evidencia H01–H13](agent-contract-evidence.md). Lo siguiente describe el cambio actual, sin convertir aquel historial en una garantía del presente.

## Qué cambió y dónde

| Tramo | Cambio y respaldo |
| --- | --- |
| Ajustes y aprobación | [procedure.ts](../src/engine/procedure.ts) contiene SETTINGS_POLICY y missingSettingsKind. [context.ts](../src/engine/agent/context.ts), [tools.ts](../src/engine/agent/tools.ts) y [runtime.ts](../src/engine/agent/runtime.ts) consumen la misma política: image/video necesitan tarjeta fuera de Nodes; op no. Aprobación del plan y autorización económica siguen siendo límites distintos. Una revisión confirma un tipo nuevo; reutiliza los ya confirmados. |
| Capacidades y modelos | OP_LINES deriva motor local/proveedor de OPS. OP_RESOLUTION explica la precedencia vigente, variantes, rechazo incompatible, proporción aproximable, resolución por modelo y ausencia de estilo global en op. Se eliminó la tabla de recomendaciones solapadas; una elección humana se conserva y una alternativa se ofrece mediante los ajustes existentes. No cambiaron routing, tarifas ni proveedor. |
| Pedido y especialización | WORKFLOW_CONTRACT limita templates a dependencias y pide adaptar salidas e inputs. [staged.md](../src/engine/guides/staged.md), [workflows.ts](../src/engine/skills/workflows.ts), [catalog.ts](../src/engine/skills/catalog.ts) y [product.md](../src/engine/guides/product.md) distinguen vistas separadas/ficha, identidad/toma continua e imagen/texto. Auto decide lo creativo pendiente; pilotos/candidatos necesitan una razón y alcance aceptado. La referencia aportada reemplaza preparación innecesaria. El formateador común de workflows deja de ordenar preguntar todos los campos: en Auto pregunta datos humanos faltantes y en Guided permite opciones creativas; los formatos del template son defaults que respetan una elección explícita. Product-pack también conserva la foto como identidad sin repetir su descripción. |
| Sesiones existentes | refreshLoadedGuides en [guides.ts](../src/engine/skills/guides.ts) sustituye respuestas exitosas obsoletas de skills/workflows, conserva IDs y errores/compactación. Antes del nuevo pedido, retira instrucciones de snapshots históricos app_context y conserva sus selecciones, referencias y el mensaje humano. El contexto actual vuelve a suministrar las guías vigentes. Sin migración de biblioteca ni borrado de conversaciones. |
| Comprensión visible | [PlanCard.tsx](../src/components/chat/PlanCard.tsx) reutiliza las autorizaciones de la estimación existente para mostrar modelo, proporción y resolución de op antes de Run. Si la fuente todavía no existe lo marca provisional. Los avisos dicen ajustes del plan, no del modelo. [SettingsCard.tsx](../src/components/chat/SettingsCard.tsx) dice Images per step incluso con valor 1. |
| Recuperación y entregables | El prompt permite recuperar una guía cuyo contenido completo ya no está disponible; mantiene el límite breve para explicaciones pero permite el texto solicitado como entregable. |

Los tres frentes siguen siendo eliminar políticas duplicadas, distinguir conceptos que producen acciones diferentes y hacer fiel la comunicación al comportamiento. Se ejecutaron juntos en este recorrido porque una corrección de prompt aislada dejaba las guías antiguas y la aprobación sin la información correspondiente.

No se creó un nuevo estado universal «listo/pendiente/imposible»: normalización/reparación, ajustes pendientes y aprobación siguen siendo las rutas existentes. Se aclararon sus condiciones y se exponen las elecciones efectivas/provisionales. La compatibilidad y el coste de fuentes futuras siguen revalidándose antes de dispatch; no se presentan como definitivos ni se omite el gate económico.

## Evidencia y procedimiento

1. Se comprobaron rama, estado y reglas; se preservaron precios, datos reales y Designer.
2. Se añadieron regresiones del contexto ensamblado, normalización de tres operaciones, aprobación y sesión antigua. Los tests de contrato, información visible y guías obsoletas fallaron antes de las correcciones respectivas. La normalización de tres operaciones ya pasaba: caracteriza una ruta reutilizada, no demuestra una corrección nueva.
3. Una regresión adicional demostró que un workflow antiguo podía persistir en app_context. Se corrigió esa conexión y se comprobó que referencias y elecciones previas se conservan. [agent-contract-journey.test.ts](../tests/agent-contract-journey.test.ts) recoge ambos canales; [settings-phase.test.ts](../tests/settings-phase.test.ts) comprueba revisiones que introducen vídeo.
4. Se adaptaron expectativas de cambios deliberados. La captura histórica anterior a la división de skills permanece intacta; su test exceptúa únicamente el encabezado común, los campos de brief/defaults y la corrección de identidad autorizados. [history-trim.test.ts](../tests/history-trim.test.ts) añade padding controlado porque las guías cortas ya no alcanzaban el umbral; el umbral de producción no cambió.
5. Sandbox mediante npm run dev:sandbox, puerto 5183, perfil nuevo propio, disco y proveedores bloqueados antes de navegar. Run real sobre fixture normalizada: tres generaciones local::studio-image, fuente original compartida, 9:16, un asset por paso y biblioteca vacía. LLM ausente: el plan se suministró como fixture. Se inspeccionaron las tarjetas de fuente futura y contador. Navegador y servidor propios detenidos.

Las capturas y runtime-state.json se entregan fuera del repositorio en outputs/agent-contract-review/operator. La captura del contador se repitió porque la primera no mostraba su etiqueta. En esa repetición un fixture incompleto falló al renderizar; se corrigió el mapa de catálogo del fixture y se volvió a comprobar. No se atribuyó ese fallo a la app ni se modificó producción para ocultarlo. El sandbox usó fuente fallback por un aviso de acceso a la fuente Inter a través del enlace node_modules; no se amplió la configuración.

Validación final: npm test -- --maxWorkers=2 aprobó 706 tests y omitió 5 (125 archivos aprobados, 5 omitidos), en 27,39 s. Incluye salvaguardas y check-docs. npm run typecheck y git diff --check aprobaron. Es tiempo de la suite local, no latencia del agente. El commit se informa en la entrega. Los cinco tests omitidos no equivalen a casos verificados.

## UX, riesgos y latencia

Mejora concreta disponible: un procedimiento coherente para el pedido, elecciones visibles antes de ejecutar y actualización de instrucciones en conversaciones existentes. Una vista solicitada no implica frontal, ficha, pose neutra, piloto o guardado adicionales. Esto es un contrato y una ruta comprobada con fixtures; la obediencia de un LLM y la calidad visual de un proveedor siguen pendientes de prueba real.

No se añadieron llamadas de red, herramienta nueva, telemetría ni trabajo por frame. La actualización de guías ocurre al iniciar un pedido, recorre el historial y calcula cada guía distinta una vez. Ese trabajo local tiene coste de CPU; no se midió su latencia en sesiones largas. OPS ahora añade información al contexto; staged y reglas antiguas se redujeron. Tamaño de texto por sí solo no mide latencia ni tokens efectivos. No se afirma coste cero ni reducción de los 73/84 s.

Riesgos que deben seguirse: que un modelo ignore el contrato, que el template offline fijo no adapte el pedido como el LLM, que una fuente futura cambie coste/modelo y reabra revisión, que retirar instrucciones históricas necesite una nueva lectura de guía, y que el texto visible sea insuficiente en una sesión larga. No se endureció consentimiento de biblioteca con una barrera semántica nueva: sigue el límite documentado de P1a.

## Qué comprobar después

Para cada cambio de este dominio: pedido → contexto efectivo → plan → ajustes/aprobación → dispatch → resultado/reutilización. Reutilizar estos tests; revisar productores y consumidores afectados, sin auditar mil archivos. Probar el caso original con referencia y modelo explícito, tanto en sesión existente como nueva, y contrastar número de salidas, conservación de referencia, decisiones y guardado. Ficha compuesta y escenas independientes sirven de casos vecinos para detectar una adaptación excesiva.

La comparación del LLM requiere proveedor/modelo/presupuesto y aprobación específicos. Registrar tiempos individuales hasta plan válido, preguntas, lecturas, rechazos y generaciones extra; separar espera humana, agente y proveedor. No se abre automáticamente una prueba pagada. Si aparece una regresión, conservar contexto y plan reproducibles, localizar su autoridad existente y corregirla o revertir este commit; no sumar una regla particular sin causa comprobada.
