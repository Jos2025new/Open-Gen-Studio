# Contrato operativo: recorridos, UX y validación sostenida

Estado: Propuesto, pendiente de revisión. Complementa el [ADR 0005](decisions/0005-contrato-operativo-agente.md) y su [evidencia H01–H13](agent-contract-evidence.md); no constituye otro plan ni autoriza implementación. Base de código: task/price-auth, 4f137ce60230203ccee33ffa75bebb737f3ce224. Incorporación de la discusión con Astra y de las indicaciones posteriores de Samuel, 2026-10-05.

## 1. Qué incorpora y por qué

Lectura de decisión: sección 3 (qué, por qué, cómo y resultado esperado), 4 (alcance de cada corrección), 5 (UX/GUI), 6 (comprobación sostenida), 7 (riesgos) y 8 (criterio de cierre). Beneficios todavía propuestos, no resultados medidos. El orden ejecutable permanece en P0–P4 del ADR, sincronizado con estas prioridades.

Samuel pide sincronizar una corrección entre consumidores, comprobar dependencias anteriores/posteriores y preservar decisiones, adjuntos y conexiones. También pide evaluar el recorrido habitual de un usuario, aunque no elija un workflow explícito, sin obligar a revisar toda la app. Las diferencias entre etapas pueden ser intencionales; un modelo que las resuelve por sí solo no demuestra un defecto visible ni una política coherente. UX agradable, GUI clara y avisos próximos a su acción deben comprobarse, no asumirse.

Procedencia: el nuevo adjunto Texto pegado.txt (7320f456-b840-4bcd-8b23-3447f6e06b16) contiene una discusión con Astra y respuestas previas. Se leyó como material de análisis, no como instrucciones de otro agente ni pruebas independientes. Se verificaron sus referencias históricas y el tramo de PlanCard pertinente. Astra matizó su afirmación sobre impacto GUI: hay motivo para inspección, no evidencia de imperceptibilidad en pantalla.

Qué se hizo en esta ampliación: lectura de los fragmentos históricos citados abajo, PlanCard y su clase CSS, y métricas existentes; actualización documental. No se abrió navegador/sandbox ni datos reales. No se implementaron cambios o telemetría. La propuesta no atribuye a un autor o commit el origen de cada inconsistencia.

## 2. Patrón histórico y su grado de respaldo

| Evidencia comprobada | Lo que permite concluir | Lo que no permite concluir |
| --- | --- | --- |
| [Historial 013, líneas 12–22](history/013-2026-09-W39.md#L12): políticas fragmentadas, etapas sin mecanismo y recorrido no probado; subjects de paso descritos como guardados. | Existió desajuste entre intención, instrucciones y recorrido; el contrato tuvo una semántica anterior. | Que todo ese comportamiento siga vigente o que todo el desarrollo sea incorrecto. |
| [Historial 006, líneas 86–93](history/006-2026-10-W40.md#L86): referencias sin guardado automático, contrato de tarjeta temporal/persistente y pruebas sin LLM real. | Se documentó un cambio de política y una distinción de persistencia. El contrato actual de herramienta todavía promete guardar ambos casos (H11). | Que el texto histórico por sí solo pruebe ejecución actual o que hubiera guardado indebido en la sesión aportada. |
| [Historial 004, líneas 6–15](history/004-2026-10-W40.md#L6): reconoce parches por incidente; procedimiento autónomo y traslado de look obligatorio a staged. | El intento de unificar conservó una obligación especializada que hoy choca con Auto (H07). | Que el dato histórico «78 modificaciones» haya sido contado de nuevo en esta revisión. |
| Git 3445ac9 (procedimiento/staged) y 2e9ecfa (separación conservando texto), consultados en la revisión anterior. | Hay reorganización y preservación textual documentadas. | Que separar archivos introdujera las contradicciones: pudo conservarlas. No se hizo bisect ni atribución completa. |

Inferencia transversal respaldada: hay cierres incompletos de cambios de política entre sus consumidores. La presencia de varias capas es normal; el problema es que prometan efectos distintos para la misma condición. Se corrige reconciliando contratos y ámbitos, no eliminando capas útiles.

## 3. Qué cambiar, por qué y cómo, dentro de los tres frentes

Se conservan F1 políticas generales, F2 distinciones operativas y F3 contratos/resolución del ADR. La validación del recorrido atraviesa los tres desde el primer arreglo; no se agrega una cuarta infraestructura.

| Prioridad | Qué y por qué | Cómo propuesto | Qué debería verse después |
| --- | --- | --- | --- |
| 1. Persistencia y consentimiento (F1/F2/F3, H11) | Promesa de subjects y efecto real discrepan; reparación puede inducir guardado. | Alinear herramienta, contexto, validador, tarjeta y ejecutor; separar uso temporal de guardado autorizado. Preservar serialización salvo decisión explícita. | Usar referencia no altera biblioteca por sorpresa; el plan explica qué se guardará; el sujeto temporal funciona en pasos posteriores. |
| 2. Ajustes y aprobación (F1/F3, H01–H05) | El usuario debe comprender selección/efectos y aprobar lo que corresponda. | Separar ajuste de aprobación; describir precedencia y variantes; verificar lo conocido entre plan, aprobación y spec; pendientes de fuente futura explícitos. | Tarjetas necesarias y consistentes; elección humana conservada; incertidumbre de coste comprensible. No garantía nueva de máximo. |
| 3. Etapas adicionales (F1/F2, H08–H10) | Pilotos, fichas y candidatos pueden ampliar resultado/gasto. | Distinguir requisito, recomendación y elección; vistas/ficha y toma/montaje; alinear pasos y texto del workflow. | Pedido directo conserva alcance; no etapas adicionales por una regla ambigua; excepciones justificadas. |
| 4. Coherencia/eficiencia (F2/F3, H06–H07/H12–H13) | Preguntas y textos contradictorios hacen al operador deducir. | Retirar duplicaciones, delimitar referencia/texto, Auto/Guided, guía presente/compactada y estado/entregable. | Menos preguntas redundantes y rechazos evitables; copy completo cuando se pidió; guías recuperables. Mejoras aún no medidas. |
| Avisos, según consecuencia (F3) | La GUI comunica esas decisiones. Un aviso puede requerir atención sin necesitar un rediseño. | Inspección visual proporcional dentro del recorrido de cada prioridad; corregir solo problemas observados. | Usuario identifica qué cambió, cuál paso requiere actuar y cómo continuar/cancelar. |

La prioridad visual no queda siempre al final: si un bloqueo de consentimiento no es comprensible, forma parte del primer recorrido afectado. No reordenar ni recolorear toda la app por un hallazgo textual.

## 4. Ficha breve de impacto, dentro del trabajo existente

Cada cambio incorpora en su descripción o documentación existente: recorrido afectado → productores y consumidores → invariantes → cambio intencional → evidencia y límites. No crear fichas duplicadas, otro sistema de planes o un inventario de mil archivos.

El recorrido mínimo se describe en pocas líneas: qué aporta el usuario; qué interpreta/pregunta la app; qué muestra para decidir; qué aprueba; qué ejecuta/guarda; qué recibe y puede reutilizar. Ampliar con revisión/cancelación/recuperación cuando consuman el contrato cambiado.

Revisar en ambas direcciones: origen de entradas y estado; transformación modificada; consumidores y dependencias de salida. Incluir referencias/adjuntos, ids/candidato elegido, settings, sujetos, edges/dependencias, pendientes y efectos persistidos solo donde apliquen. El check es selectivo por contrato: un arreglo de biblioteca no exige auditar pinceles, pero sí su reutilización en Nodes si cambia un contrato compartido.

Límite de inspección: detener la expansión donde se justifique que entradas, salidas y efectos siguen iguales. Si aparece una nueva conexión afectada, ampliar el recorrido y dejar constancia; no fijar una cantidad arbitraria de archivos. Esta ficha acompaña el primer cambio, no queda como una fase de prevención futura.

Ejemplo inicial H11: adjunto → refs/subjects → normalización y repair → tarjeta → aprobación → sujeto local o biblioteca → paso dependiente → resultado/reutilización. Invariantes propuestos: misma referencia; dependiente recibe identidad; biblioteca no cambia para uso temporal; guardado explícito coincide con lo anunciado; cancelar antes de ejecutar no guarda; revisión conserva elecciones ajenas al cambio. Especificar antes/después y comprobarlo con fixtures/mocks. No afirmar que la cancelación deshace una ejecución ya realizada.

Una excepción intencional registra condición, motivo y resultado esperado. Que paso 1 y paso 5 difieran puede ser correcto si uno recomienda un modelo y otro resuelve variante compatible; sería incorrecto si cambia la elección humana de familia sin la ruta correspondiente. No convertir toda diferencia en bug.

## 5. UX y GUI: beneficios y comprobación

| Objetivo para usuario | Beneficio esperado | Cómo corroborarlo |
| --- | --- | --- |
| Decisiones conservadas | No repetir datos/modelo/alcance al revisar un paso. | Historial y estado antes/después, casos de revisión, observación del recorrido. |
| Preguntas pertinentes | Auto avanza ante petición clara; pregunta lo que falta y cambia el resultado. | Clasificar necesidad de cada pregunta; no optimizar su número sacrificando datos imprescindibles. |
| Consentimiento comprensible | Diferenciar generar, usar temporalmente y guardar. | Tarjeta y estado real coinciden; usuario puede explicar qué pasará antes de actuar. |
| Aviso junto a su acción | Relacionar coste/bloqueo con el paso afectado. | Sandbox: avisos con detalle abierto/cerrado, planes cortos/largos, scroll y tamaños de ventana pertinentes. |
| Jerarquía visual | Distinguir bloqueo, advertencia y consejo sin ruido. | Captura e interacción; contraste legible, texto/icono además de color, foco/teclado. No depender solo de saturación. |

Dato actual: [PlanCard.tsx:187–194](../src/components/chat/PlanCard.tsx#L187) coloca revisión de precio en el paso, con Continuar/Cancelar, y reutiliza step-script del guion (línea 186). [chat.css:23](../src/styles/chat.css#L23) define esa clase con texto secundario y fondo de superficie. [PlanCard.tsx:200–204](../src/components/chat/PlanCard.tsx#L200) ya explica temporal/persistente. Esto respalda revisar fidelidad y jerarquía; no demuestra que el usuario no perciba el aviso ni que hagan falta colores nuevos. No se verificó visualmente en esta ampliación.

Bloqueo que exige decisión: persistente en su contexto mientras esté pendiente y accionable. Advertencia: consecuencia visible antes de actuar. Sugerencia/tip: secundaria, sin competir con bloqueos. Información progresiva: detalles técnicos desplegables; consecuencias que cambian consentimiento visibles. Son criterios propuestos, no una auditoría de accesibilidad completa ni un rediseño aprobado.

## 6. Comprobación inmediata y a largo plazo

Usar C01–C12 del ADR como banco pequeño y ampliarlo solo con una regresión concreta o un contrato nuevo. No iniciar un monitor o automation: esta sección propone momentos de revisión.

Antes de editar, conservar baseline del caso, revisión Git, modo/modelo, referencias sintéticas y contexto/tool schemas pertinentes. Una reproducción determinista con mocks puede preceder a una medición real; si falta esta última, no afirmar mejora de comprensión o latencia. Registro mínimo por caso: versión, entrada, esperado/observado, evidencia, tamaño de muestra cuando corresponda y limitación. Reusar [la línea base existente](agent-baseline.md) cuando cubra la métrica; no interpretar valores desconocidos o sin muestras como cero.

Responsables propuestos: quien implementa prepara caso y evidencias; quien revisa contrasta consumidores y recorrido; Samuel acepta diferencias materiales de producto y autoriza pruebas pagadas. No cambia AGENTS.md ni asigna trabajo a otra conversación. La revisión mensual de la tabla es opcional y pendiente; los checks ligados a cambios/versiones constituyen el seguimiento mínimo propuesto.

| Momento | Comprobación proporcional | Evidencia de cierre |
| --- | --- | --- |
| Cada cambio | Ficha de impacto; contrato/estado; contexto ensamblado; recorrido afectado y fronteras compartidas. | Tests pertinentes, diferencias previstas y límites. Cero regresiones conocidas fuera de cambios aceptados. |
| Cambio visible | Prueba en sandbox del trayecto y decisiones; capturas y acciones, no solo DOM. | Usuario ve consecuencia y puede actuar; estado confirma efecto. Detener sandbox/browser al terminar. |
| Cierre del bloque / antes de integrar | Suite completa, safeguards/docs y typecheck según código; banco de contratos afectados. | Sin fallos sin explicar; no fusionar/push por esta propuesta. |
| Cambio de modelo LLM, catálogo, modo, prompt/skill o routing | Repetir casos que consumen el contrato; separar diferencias de proveedor/modelo. | Compatibilidad y conducta conservadas o cambio documentado; mocks no sustituyen comprensión del LLM. |
| Primeras sesiones tras habilitarlo | Revisión acordada de casos autorizados y feedback, sin acceso implícito a sesiones reales. | Preguntas redundantes, vueltas de corrección, efectos inesperados, bloqueos y éxito del objetivo. |
| Revisión periódica propuesta | Al siguiente hito de entrega; si hay uso activo, revisión mensual durante los primeros tres meses, sujeta a decisión de Samuel. | Tendencias y recurrencias por dominio; mantener solo controles que aportan evidencia. |

Si no hay acceso/autorización a uso real o volumen suficiente, la eficacia a largo plazo permanece sin verificar. La ausencia de reportes no demuestra ausencia de bugs. No leer data/ real, registrar contenido sensible ni crear tareas recurrentes por esta propuesta.

La app ya registra [metrics.ts:37–49](../src/engine/agent/metrics.ts#L37) llamadas, rondas, revisiones y rechazos; [metrics.ts:76–120](../src/engine/agent/metrics.ts#L76) incluye tiempos. Reusar esas métricas cuando sean suficientes. Clasificaciones semánticas como «pregunta innecesaria» requieren evaluación del pedido/recorrido; no existen por sumar contadores. No añadir telemetría permanente sin necesidad concreta.

Medir tiempo a plan válido y primer contenido útil, preguntas justificadas/redundantes, revisiones para corregir intención, rechazos, conservación de selección/refs y efectos de guardado. Separar espera humana, pensamiento/red, herramientas y generación. Comparar muestras equivalentes por modelo/modo/versiones/caché; reportar cantidad de observaciones y dispersión. No atribuir mejora al prompt si cambió el modelo. No hay porcentaje objetivo de ahorro ni p95 fiable prometido con pocas muestras. LLM real de pago requiere selección, alcance, máximo y aprobación separados; no se autorizó aquí.

## 7. Riesgos y señales de largo plazo

| Riesgo | Cómo detectarlo | Respuesta propuesta |
| --- | --- | --- |
| Otra capa conserva política anterior | Mismo caso produce tarjetas/efectos distintos al cambiar workflow/mode. | Revisar consumidor omitido; eliminar definición incompatible en el responsable existente. |
| Eliminar excepción útil | Casos especializados empeoran aunque el caso base pase. | Recuperar condición/motivo; test del ámbito y reversión acotada. |
| Sobreautomatizar para reducir preguntas | Se inventan datos propios del usuario o se generan extras. | Reponer decisión humana necesaria; no usar latencia como único éxito. |
| Demasiadas confirmaciones | Abandono, vueltas sin cambio material, usuario repite elecciones. | Corregir política común; no quitar controles de gasto por conveniencia. |
| Promesa de coste/guardado incorrecta | Tarjeta y ejecución/estado discrepan. | Prioridad alta; reproducir con fixtures y proteger frontera. No afirmar cobro real a partir de estimación. |
| Avisos poco claros o excesivos | Usuario no sabe qué pasó o qué botón corresponde; mensajes compiten. | Prueba visual del caso; jerarquía y ubicación contextual, sin rediseño global. |
| Buen resultado gracias al modelo oculta contrato débil | Otro modelo/ronda falla en el mismo contexto; razones cambian sin política. | Revisión semántica + pruebas reales autorizadas, además de mocks. |
| La prevención se convierte en maquinaria | Crece tiempo de revisión sin hallar regresiones; listas copiadas sin pertinencia. | Reducir al contrato/trayecto; usar infraestructura existente y quitar comprobaciones redundantes. |

Una regresión de datos/consentimiento o ejecución fuera del alcance acordado impide cerrar ese tramo. Una diferencia intencional no es regresión si fue aceptada, comunicada y probada. Una diferencia histórica no es un bug actual hasta corroborarla.

Si se incumple una invariante protegida, corregir o revertir el cambio aislado preservando trabajo ajeno; no normalizar el fallo actualizando únicamente la expectativa del test. Una señal aislada de latencia requiere repetir y diagnosticar bajo condiciones comparables. La ausencia de sesiones disponibles deja pendiente el beneficio en uso; no invalida las comprobaciones funcionales ya realizadas, pero tampoco las convierte en prueba de UX real.

## 8. Condición de cierre y primer tramo

Comenzar por H11, con la ficha y validación desde el primer cambio: intención aceptada → contratos de subjects/repair coherentes → referencias y consumidor posterior preservados → efecto de biblioteca comprobado → comunicación en tarjeta verificada si cambia → informe de límites. No implementar resto de frentes antes de comprobar que este procedimiento acotado aporta valor.

Para declarar mejora: comportamiento acordado cumplido, consumidores consistentes, decisiones anteriores conservadas, excepciones justificadas y ninguna regresión conocida fuera de cambios aceptados en recorridos probados. La comprensión por LLM, calidad visual y latencia se reportan separadamente y pueden seguir pendientes. El documento permanece Propuesto; no supone aprobación de GUI, cambios económicos, migraciones ni llamadas reales.
