---
type: rastreo
title: Rastreo de Studio (2/2): regresiones, respuestas y contradicciones
description: Arreglos de Studio que dejaron regresiones, preguntas de los inventarios que la historia ya responde, contradicciones entre documentos y código, y los diez puntos de mayor impacto.
tags: [studio, rastreo, regresiones, promesas]
updated: 2026-10-28
---
# Rastreo de Studio (2/2)

Continúa [studio.md](studio.md) (secciones 1 y 2). Mismas reglas: solo lectura; el código manda sobre los documentos. Promesas del producto: **P1** el modelo o proveedor no cambia sin que el usuario pulse Cambiar; **P2** no se gasta por encima de lo mostrado; **P3** una alerta nunca afirma algo falso ([dependencias](../studio-controles/dependencias.md)). «Demostrado» = leído en el código, el fallo se sigue de la lógica; «sospechado» = plausible, sin caso real visto.

## 3. Regresiones y contradicciones con lo decidido

### 3.1 Estado actual que contradice una promesa

| N.º | Hallazgo | Evidencia | Prueba | Impacto real |
| --- | --- | --- | --- | --- |
| R1 | **«Proveedor que encaja» cambia el proveedor del paso en Auto sin Cambiar y sin comparar precio**, también el del Composer o el elegido antes. Un proveedor nombrado en una petición anterior no se protege. La divulgación es una nota que el agente debe repetir | `6d97221` (2026-10-24); `providerFit.ts:41-55` (sin ninguna comparación de precio; `providersIn(request)` solo mira la petición actual); `autoSettings.ts:44-54` (`notes.push(better.note)`); 053 Frágil 2 | Demostrado (cambio y falta de precio); si el aviso llega al usuario depende del LLM, sin verificar | Alto. Rompe P1 según el criterio de [pendientes.md](../pendientes.md); el precio sí se ve en la tarjeta antes de aprobar, así que P2: se ve un precio estimado antes de aprobar; no es un máximo de cobro garantizado |
| R2 | El cambio por falta de crédito del agente fija `modelPinned: true`, como si el usuario hubiera fijado el Director, y el estado sobrevive a la recarga | `credit.ts:211`; comentario del campo `store.ts:57`; `4cf18aa` (2026-10-02) | Demostrado | Medio. El aviso es veraz (`credit.ts:216`); el efecto es que Tier no vuelve solo al modelo previo |
| R3 | `credit.ts:206` usa `Infinity` si falta el precio: con dos precios desconocidos `cost(m) <= cost(cur)` es verdadero y el aviso dice «same price or less» | `credit.ts:204-207`, `:216` | Demostrado por lógica; frecuencia desconocida | Medio-bajo. Alerta falsa (P3) solo con modelos sin precio de tokens |
| R4 | En la generación con crédito agotado, las opciones con unidad de precio distinta no tienen tope ni marca «pricier»; el texto de la alerta dice que las más caras van marcadas | `credit.ts:124-128`, `:135-137` (la etiqueta marca solo `ratio > 1`) | Demostrado por lógica | Bajo-medio. P3 y P2 en la elección manual |
| R5 | **A2**: tras pasar de Atlas a NanoGPT por crédito, `Generation.provider` queda con el proveedor viejo | `credit.ts:158-160`; `jobs.ts:108`; `jobs.ts:677` lo usa en el registro | Demostrado el campo viejo; efectos en pantalla, sin verificar | Medio. Etiqueta falsa (P3) |
| R6 | El cambio automático de variante por adjuntos marca `userPicked[kind]=true`; `515dceb` evitó solo el recuerdo de sesión | `catalog.ts:235`; `Composer.tsx:374` | Demostrado | Bajo-medio. Después `composerChosen` lo trata como elección del usuario (`llmTurn.ts:281`); el cambio sí se avisa con un toast |
| R7 | El tooltip del límite dice que una ejecución que lo pasa pregunta antes; `overLimit` ignora precios desconocidos | `SettingsPanel.tsx:460` frente a `budget.ts:24-27` | Demostrado | Medio-alto. P2 y P3; solo en ejecuciones sin precio conocido |
| R8 | Aprobar por encima del límite apaga la pregunta para todas las ejecuciones siguientes | `budget.ts:38-39`; el texto lo avisa (`budget.ts:34`) y la nota de `SettingsPanel.tsx:516` | Demostrado, documentado | Medio. No es falso, pero deja sin tope hasta Reset |
| R9 | «The agent revises the plan; nothing is spent» es falso en dinero: cada revisión es un turno LLM que suma gasto `agent` | `PlanParts.tsx:112,126`; `llmTurn.ts:218` | Demostrado | Coste no medido; crítico en promesa (P3) |
| R10 | «Ajustar prompt» (activo por defecto) llama al LLM del agente y cobra sin mostrar el precio antes | `planSettings.ts:188` | Demostrado | Coste no medido |
| R11 | Cancelar un plan en marcha aborta en local y conserva el trabajo remoto sin aviso; el propio texto de «Dejar de seguir» dice que el proveedor seguirá cobrando | `PlanCard.tsx:189`; `jobs.ts:666-668,688-690`; `StopFollowing.tsx:13` | Demostrado la falta de aviso; el cobro, sin verificar | Medio-alto, ligado a B1 |
| R12 | Con el límite superado, «Check status» solo muestra un toast con el texto del límite y no hay forma de continuar, aunque consultar no cuesta | `RecoveryActions.tsx:23-30`; `planRun.ts:388` | Demostrado | Medio. Fricción (callejón sin salida) |
| R13 | Escribir en el Composer con preguntas abiertas envía solo `{note}`; con la tarjeta de ajustes abierta la cierra como `skipped` sin confirmar | `conversation.ts:51-54`, `:57-58` | Demostrado | Medio. Pérdida de selecciones en pantalla |
| R14 | `FollowUpCard` y su plumbing (`switchedTo`, `followUpProblem`) siguen en el código sin llegar a tarjetas nuevas | `SettingsCard.tsx:60,295`; `llmTurn.ts:280`; `plan.ts:562`; `types.ts:911` | Demostrado | Bajo. Deuda; riesgo si una sesión vieja trae `switchedTo` |
| R15 | `tools.ts:169` sigue declarando `required: ['kind','user_requested']` para `confirm_settings`, y `:260` dice «Required with model», aunque 054 afirma que el esquema ya no la exige | `tools.ts:169,260` frente a `:379,403` (zod `optional()`) | Demostrado la diferencia entre esquema del LLM y validador | Bajo. El LLM sigue empujado a escribirlo; ya no pierde el plan |

### 3.2 Arreglos que dejaron regresión, ya corregidos (cadenas de fallout)

| Cadena | Secuencia | Evidencia |
| --- | --- | --- |
| Auto una tarjeta (2026-10-24) | `cd15ef0` → `8fc96c0` → `9226ed8` → `d2eb4ef` → `965daf5` → `5bcbc6c` → `97db747` → `931c95c` → `943f4e7` → `6d97221`. «El pedido real del vídeo falló tras cada cambio hasta `5bcbc6c`»; la app recibía las imágenes y no se las decía al agente; el reescritor escribió 4006 caracteres en español para 7 s | [053](../history/053-2026-10-W43.md) «Evidencia» y puntos 6 y 8. La velocidad subió de unos 10 s a unos 70 s y sigue sin medirse (Frágil 6) |
| Resolución cobrada | El interruptor Borrador/Alta calidad sustituía la resolución más baja por la más alta: la tarjeta mostraba 480p y el precio era el de 1080p ($1,6 en lugar de $0,40). Corregido en `8772f19` (2026-10-26) | [agente-auto-tarjeta.md](../features/agente-auto-tarjeta.md) «Resolución elegida en la tarjeta»; prueba `tests/auto-plan-card.test.ts` (f2). Era P2 roto entre el 2026-10-24 y el 26 |
| Modelo restaurado a uno anterior | Pedido y aprobado Seedream; el siguiente plan volvió a Nano Banana Pro. Era P1 roto. `95f81d8` (respuestas a tarjetas forman parte de la petición) y `fdb3bf8` (aprobar confirma lo que corre), 2026-10-25 | Mensajes de commit |
| Sesión del modelo (2026-10-27) | `210cb6b` → `515dceb` + `8ebc736` + `4fbf59f` + `e90a067`. El rechazo duro perdió un plan de seis pasos y el reconocimiento por nombre completo no entendía «seedream 5» | [054](../history/054-2026-10-W44.md); memoria del proyecto «lock a prueba: no debe bloquear nunca». Riesgo residual: la inferencia por palabras (`userChoice.ts`) puede equivocarse en nombres parecidos, sin verificar |
| Respuesta a una tarjeta | `fa8480e`/`aa5d236` (2026-10-26): cada mensaje cancelaba el plan y lo contestaba el planificador local aunque hubiera LLM; la ruta dependía del enlace de la tarjeta, no del motor | 054 «El bucle del final de sesión»; prueba en `tests/plan-revision.test.ts` |
| Cambio ordinario de modelo | `143fef4` (F-01) deshacía la elección del usuario en el Composer; `e5c7d53` (2026-10-21) | 048 «Auditorías», punto 4 |
| Tarjeta del plan y reescritura | `1f063e3` desactivaba también la elección de modelo y Haiku la ignoraba en silencio; `a6f1ea8` lo corrigió el mismo día | 054 A25 |
| Studio y el tablero | `9858765` (2026-10-15) hizo que el canvas del tablero fijara el del agente; corregido el 2026-10-24 (`924eacf`, `965daf5`) | 053 punto 3. Frágil 7: una tarjeta de Nodes contestada desde Studio continúa en el chat |
| Catálogo de OpenRouter | El acceso a endpoints bloqueaba la carga de modelos de imagen; C1 restauró el catálogo como respaldo | [proveedores-ejecucion](../proveedores-ejecucion-2026-10-25.md) línea 24 |
| Intermitentes | `writer-lock` 15c y `save-guard-banner` 13 fallan con la máquina cargada; causa de 15c corregida en `71d5c1b` | 053 «Evidencia», 054 |

## 4. Preguntas de los inventarios que la historia ya responde

### 4.1 [huecos.md](../studio-controles/huecos.md)

| N.º | Respuesta | Fuente |
| --- | --- | --- |
| G1 Cancelar un plan con trabajo remoto en curso, ¿sigue cobrando? | **Parcial.** El código aborta en local y guarda `remoteJob` (`jobs.ts:666-668`, `keptJob` `:688`); el texto de la propia app dice que el proveedor «keeps generating this and will charge the estimate» (`StopFollowing.tsx:13`). Que el proveedor cobre de verdad no consta: es B1, sin verificar | `jobs.ts`, [pendientes-agente.md](../pendientes-agente.md) B1 |
| G2 ¿El aviso de crédito coincide con el cambio? | **Generación: sí por construcción** (`auto = options.find(o => o.same)`, y `same` exige misma unidad y `p.usd <= price.usd`, `credit.ts:126,155`). **Agente: con el hueco R3.** Alertas «costs N× more» salen del `ratio` real (`credit.ts:172`) | `credit.ts`; regla C de [ADR 0025](../decisions/0025-revision-sesion-house-party.md) |
| G3 ¿Qué parte del estilo y la continuidad fija el usuario y cuál el agente? | **Parcial.** El agente escribe `propose_plan.style` una vez y la app lo añade a cada paso (`continuity.ts:103`, [video-quality.md](../video-quality.md) 9-16); una revisión conserva estilo y continuidad si no los reescribe (`72329e3`, ADR 0025 B). Las líneas «Keep» ya no se muestran (`7e9accb`, `da49864`). Lo que fija el usuario es solo lo que pide o adjunta (imagen de estilo como ancla) | `72329e3`, `7e9accb` |
| G4 ¿`betterProvider` puede subir el precio? | **Sí puede**: no compara precios (`providerFit.ts:41-55`). Lo ve el usuario en la tarjeta del plan antes de aprobar | R1 |

### 4.2 [hallazgos.md](../studio-controles/hallazgos.md)

| N.º | Respuesta |
| --- | --- |
| H1 ¿Fue deliberado el cambio automático de proveedor? | **Crédito: sí.** Decidido el 2026-10-02 (`4cf18aa`) y acordado con el usuario como regla C de ADR 0025 el 2026-10-20; 049 punto 5: «funcionó como está decidido». **Capacidad (`betterProvider`): documentado como diseño pero sin cita de decisión del usuario** (no encontrar la cita no demuestra que nunca se autorizara; hay que preguntarlo): nace en `6d97221` (2026-10-24, Claude Opus, 053 punto 5) y se amplía el 2026-10-25 en `ec679f7` con el origen «el usuario: sugerir otro modelo en vez de proceder con un modelo incompleto» ([agente-auto-tarjeta.md](../features/agente-auto-tarjeta.md)); ese origen cubre *sugerir*, no *cambiar solo* |
| H2 | Corregido a medias por `515dceb` (solo el recuerdo de sesión); `userPicked` sigue marcado (R6) |
| H3 | Confirmado (R2). El comentario de `store.ts:57` y `credit.ts:211` siguen en conflicto |
| H4 | Es un diseño avisado (`budget.ts:34`, `SettingsPanel.tsx:516`), no un error oculto |
| H5 | Confirmado (R7) |
| H6, H7 | Confirmados (R9, R10). La cifra del gasto del reescritor sí llega a Spending (`planSettings.ts:188`) |
| H8 | Confirmado el aviso ausente (R11) |
| H9 | Confirmado (R12) |
| H10, H11 | Confirmados (R13). A28 (`bf64252`) arregló la respuesta al LLM, no la selección en pantalla |
| H14 | Confirmado y explicado: se retiró en Auto con `cd15ef0` (2026-10-24), el código quedó (R14) |
| H18 | Confirmado en el código: `SpaceBoard.tsx:34` usa `tileSize`; `studio.md:16` aún dice «Large/Small» (5.3). La sustitución fue petición del usuario (054) |
| H19 | Los textos en español vienen de las peticiones del usuario («Borrador (como antes) · Cambiar», [050](../history/050-2026-10-W43.md)); la única decisión pendiente registrada es «Look» → «Apariencia» (G7) |
| H12, H13, H15, H16, H17 | La historia no los menciona; siguen sin respuesta |

### 4.3 [dependencias.md](../studio-controles/dependencias.md)

| Pregunta | Respuesta |
| --- | --- |
| «Price margin»: 5/25/50 % cumple | Confirmado por `5eaa8ec` (2026-10-23) y pendiente de prueba en sandbox (050) |
| Sin crédito de generación | Excepción documentada (ADR 0025 C) con tope de 1,5× (`credit.ts:80`) |
| Precio: Reset | Sin mención en la historia |
| Reescritura: «un modelo elegido durante la reescritura se aplica» | Correcto: `a6f1ea8` (revierte la parte de `1f063e3`) |
| Continuidad: texto del error de `continuityErrors` | A13 «falso positivo de continuidad» sigue abierto; no hay arreglo |

## 5. Documentos que se contradicen o contradicen el código

| N.º | Documento | Dice | Código u otro documento | Gravedad |
| --- | --- | --- | --- | --- |
| C1 | [agente.md:21](../features/agente.md), ADR 0009 (4, Auto), ADR 0004/0006 | En Auto la tarjeta vuelve si el coste es desconocido o supera 0,50 USD | `procedure.ts:68-70,93` y `2120c71` (2026-10-15): en Auto un tipo confirmado nunca vuelve a preguntar por coste; el plan muestra el precio | Alta: describe una garantía que ya no existe. [G1 de pendientes-sistema](../pendientes-sistema.md) pide aprobar formalmente la regla del umbral |
| C2 | ADR 0009 (5), «Auto exige la tarjeta de imagen una vez por sesión» | Tarjeta una vez por sesión | `cd15ef0`: en Auto los ajustes se confirman sin tarjeta; `procedure.ts:93` | Media |
| C3 | [pendientes.md](../pendientes.md) (A1 a A24, B1 a B12; A1 «hecho en código, falta LLM real») | Lista parcial | [pendientes-agente.md](../pendientes-agente.md): A1 a A28, B13; A1 «hecho y luego sustituido» (`8fc96c0`) | Media: el índice no incluye A25 a A28 ni B13 |
| C4 | ADR 0025 D / ADR 0009 «Actualización» | «Nunca se sustituye en silencio» | `6d97221`/`providerFit.ts`: sustitución automática de proveedor en Auto, avisada por el agente | Alta (R1) |
| C5 | [agente-auto-tarjeta.md:34](../features/agente-auto-tarjeta.md) | «Un proveedor nombrado por el usuario en la petición nunca se cambia» | 053 Frágil 2 y `providerFit.ts:43`: uno nombrado en una petición anterior sí puede cambiarse | Media |
| C6 | [features/studio.md:16](../features/studio.md) | «Large/Small funciona también en Studio» | `SpaceBoard.tsx:34` y `tests/tile-size.test.ts`: deslizador «Tile size» (054) | Baja |
| C7 | 054 («el esquema ya no la exige, también en `confirm_settings`») | | `tools.ts:169,260` (R15) | Baja |
| C8 | ADR 0009, 0005, 0006, 0008 | Estado «Propuesto» | Implementados y en uso ([pendientes-sistema.md](../pendientes-sistema.md) G1) | Baja |
| C9 | [agente.md:52](../features/agente.md) | `userPicked` de `plan.ts` aún lee el historial | `plan.ts` ya no contiene `userPicked` | Baja |
| C10 | `store.ts:57` | `modelPinned`: «True only when the user pinned this exact director model» | `credit.ts:211` lo fija sin el usuario (R2) | Media |
| C11 | `SettingsPanel.tsx:460` | La ejecución que pasa el límite pregunta antes | `budget.ts:24-27` (R7) | Media |
| C12 | `PlanParts.tsx:126` | «nothing is spent» | `llmTurn.ts:218` (R9) | Media |
| C13 | [pendientes.md](../pendientes.md) «Lo más crítico» punto 3 | Lista a probar «A1 con un LLM real» | A1 se sustituyó el 2026-10-24: lo que hay que probar es la tarjeta única del plan (053) | Media |

## Los diez puntos de mayor impacto para el usuario

1. R1/C4: el proveedor cambia solo en Auto, sin comparar precio, incluso el elegido en el Composer.
2. 053 «frágil»: toda la tarjeta única de Auto sin verla con el agente real, y la velocidad (~70 s frente a ~10 s) sin medir.
3. R7/C11 y B3: el límite de gasto no pregunta con precios desconocidos y su tooltip afirma lo contrario.
4. R11/B1: Cancelar un plan sin aviso, con el cobro del proveedor sin comprobar.
5. R5/A2: etiqueta de proveedor falsa tras cambiar por crédito.
6. R12: «Check status» sin salida con el límite superado.
7. R13: texto escrito con una tarjeta abierta descarta la selección en pantalla.
8. A5: el bucle de plan roto sin corte (DeepSeek); el modelo del agente no se cambia solo.
9. C1: documentación que promete la reconfirmación a 0,50 USD que ya no existe.
10. R2/R3: el cambio de Director por crédito fija `modelPinned` y puede afirmar «mismo precio» sin precio conocido.
