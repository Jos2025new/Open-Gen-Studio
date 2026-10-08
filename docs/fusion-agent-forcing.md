# Fusión de `task/agent-forcing` en `task/modelo-general`: comparación y decisiones

Fecha: 2026-10-08. Comparación hecha con git en ese momento. La fusión no se ha hecho: la decide el usuario.

## Comparación

- `task/modelo-general` (`ba46a7c`) está contenida entera en `task/agent-forcing`: le faltan 0 commits de ella. Ninguna otra rama local ni de GitHub (`main`, `better-worflows-xyz765`, `claude/stoic-*`, `origin/task/*`) tiene commits que falten en `task/agent-forcing`.
- **No hay conflictos posibles.** La fusión es un avance directo (fast-forward) de 27 commits: 89 archivos, +2924 / −1660 líneas (recontado el 2026-10-08 tras el commit `a05e5af`).
- Fusionar no revierte nada de `modelo-general`. Lo que esta rama cambió de decisiones anteriores está en la tabla «Enmiendas»; cada cambio fue pedido o aprobado por el usuario.

## Decisiones tomadas en esta rama

Cada decisión con su origen, su commit y lo que impide revertirla sin darse cuenta: un test o un contrato del [mapa](map.md). Si alguien quita la protección, `npm test` falla.

| Decisión | Origen | Commit | Protección |
| --- | --- | --- | --- |
| Direct ejecuta el modelo del compositor y recibe su guía | Usuario (ADR 0007, 1 y 9) | `c1d74be` | contrato `direct-guides`; [agent-direct-model.test.ts](../tests/agent-direct-model.test.ts) |
| Las palabras clave **dirigen** al agente con una señal; no enrutan ni devuelven planes | Usuario: «el forceo es dirigir al agente hacia una tool call, no es un ruteo determinista» | `187ca48`, `ae4c86d` | contrato `keyword-route`; [agent-force.test.ts](../tests/agent-force.test.ts) |
| **Nunca** se envía al proveedor un `tool_choice` con nombre | Usuario: «¿Quién te pidió que enviaras un comando nuestro a los proveedores?» | `631f5e9` | contrato `no-forced-tool-choice`; test «tool_choice stays auto» |
| El umbral de 0,50 USD vuelve a pedir la tarjeta en planes caros o de coste desconocido | Usuario: «ese umbral estaba puesto para evitar sobrecargos» (ADR 0004, 0006) | `df2dff5` | contrato `automation-policy` (ancla `LOW_COST_USD = 0.5`); [general-model-gate.test.ts](../tests/general-model-gate.test.ts) |
| Confirmar la tarjeta en la misma petición cubre el coste: sin bucle de tarjetas | Sesión del sandbox del usuario (4 tarjetas para un vídeo) | `3f551d1` | contrato `cost-recheck`; test «no loop of cards» |
| Guided pregunta antes de cada plan; Auto pregunta lo esencial una vez y hereda los ajustes; Direct no pregunta | Usuario | `631f5e9`, `95eab99` | contrato `guided-asks`; [agent-mode.test.ts](../tests/agent-mode.test.ts) |
| Una operación con modelo de imagen confirma su modelo: Auto una vez por sesión, Guided siempre, Direct usa el compositor | Usuario («en Auto primero se piden confirmar settings… en Guided siempre») | `454d721`, ADR 0009 | contrato `ops-confirm-model` |
| La señal abre el mensaje y descarta cargar guías para esas operaciones | Observación del usuario (el agente pensaba 33 s antes de seguir la ruta) | `b2f8cde` | [agent-force.test.ts](../tests/agent-force.test.ts) (posición de la señal) |
| La app recorta `preserve` a 200 caracteres en vez de rechazar el plan | Sandbox | `b444bd6`, `b2f8cde` | [agent-procedure.test.ts](../tests/agent-procedure.test.ts) |
| Hoja de referencia: solo se rechaza si el lugar es el sujeto | Revisiones (F2, P2) | `1306849`, `95eab99` | contrato `reference-sheet-subject` |
| El aviso de upscale nombra el factor que se ejecuta; si no llega a lo pedido, se ve sin plegar | Revisión (P3), usuario: «promete cosas que no cumple» | `95eab99` | contrato `upscale-note` |
| Notas de trabajo y `.claude/` fuera del repositorio | Usuario | `5b2a722` | `.gitignore` |
| Mapa del código obligatorio antes de cambiar código (AGENTS.md, regla 4) | Usuario | `440d3fe` | `npm test` ejecuta `scripts/map.mjs` |
| `/x/store` solo responde al propio ordenador | Usuario, tras la revisión de Haiku | `97a1c21` | contrato `store-local-only`; [store-server.test.ts](../tests/store-server.test.ts) |
| Las operaciones con modelo de imagen confirman su modelo: rige lo más nuevo | Usuario: «rige lo más nuevo» | `2dde4db` (documentación) | contrato `ops-confirm-model` |
| Tests fiables con carga: reloj simulado, esperas por condición y 20 s de margen; cobertura por riesgo | Usuario: «escoge lo mejor y documenta por qué» ([ADR 0010](decisions/0010-estrategia-de-pruebas.md)) | `a61d3a5` | los tests mismos; regla para tests nuevos en el ADR |
| Voz y efectos con los modelos elegidos; por defecto Gemini 3.8 Flash TTS y ElevenLabs Sound Effects v2 | Usuario (selección y «más nada») | `a05e5af` | contrato `audio-defaults`; [nanogpt-speech.test.ts](../tests/nanogpt-speech.test.ts) |
| Precio de voz por 1000 caracteres, nunca redondeado a gratis | Asistente: una línea gratis se saltaría la aprobación (ADR 0004) | `a05e5af` | test «a short paid line never rounds to free» |

## Enmiendas a decisiones anteriores

| Antes | Ahora | Quién lo decidió |
| --- | --- | --- |
| ADR 0007-9: las operaciones heredan el modelo de su origen, sin tarjeta | Las operaciones con modelo de imagen confirman su modelo (ADR 0009). Las operaciones locales y las de modelo dedicado siguen sin tarjeta. | El usuario, al describir el flujo completo (historial 021, sección 11, 06:55). En otra sesión de la misma madrugada (≈01:00) el usuario había dicho que las operaciones heredan el modelo de su origen, sin tarjeta. **Resuelto el 2026-10-08: rige lo más nuevo**, la confirmación (palabras del usuario). |
| Descripción de `reference_sheet`: «character, object or place» | Sin lugares | Revisión; coherente con ADR 0007 |

## Decisiones retiradas: no reintroducir

| Retirado | Por qué | Commit |
| --- | --- | --- |
| Suelo determinista con 5 disparadores que devolvía el plan si faltaba la operación | El usuario no lo pidió; forzar es dirigir, no enrutar | Retirado en `187ca48` |
| `tool_choice` con `propose_plan` en la primera llamada | El usuario no autorizó enviar órdenes propias al proveedor | Retirado en `631f5e9` |
| Quitar el umbral de 0,50 USD al leer «no se vuelve a preguntar» | El umbral protege contra sobrecargos | Restaurado en `df2dff5` |

## Estado de los ADR

| ADR | Estado | Nota |
| --- | --- | --- |
| 0005, 0006, 0008, 0009 | Propuesto | Implementados y en uso. Falta la aprobación formal del usuario. |
| Resto | Aceptado | — |

## Antes de fusionar

1. `npm test` en `task/agent-forcing` (2026-10-08, tras `a05e5af`: 977 aprobados, 5 omitidos).
2. Prueba en el sandbox de lo que el usuario dijo que probaría: bucle de tarjetas, P2, P3 y P4, y la voz y los efectos con gasto real.
3. **Notas locales:** la carpeta de la app real aún tiene versionados `PROGRESS.md`, `TRAZABILIDAD.md`, `PLAN_*` y los demás. Al fusionar, git los borrará de esa carpeta. La copia está en `../ogs-notas-locales/`; hay que restaurarla después.
