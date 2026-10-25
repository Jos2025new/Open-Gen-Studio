# Plan: proveedores de vídeo e imagen contra su doc oficial (2026-10-25)

Estado: **propuesto, sin implementar, para auditar (GPT 6.1)**. Rama `task/auto-plan-card`, worktree `ogs-auto-plan-card`, base `e7fa70d`. Nada se fusiona.

Revisión de GPT 6.1 (2026-10-25, 3 subagentes, sobre `4c605aa`): tres observaciones, comprobadas en el código y aplicadas aquí. P1 enrutamiento: F1.3 se reescribe. P1 contrato del validador: nace F0 y se reescriben F2.2 y F2.5. P2 máximo de 7: F2.3 sale del plan.

Fuentes de este plan:
- Auditorías: [OpenRouter](audits/auditoria-openrouter.md) (filas #1-#14), [verificación de Manus de OpenRouter](audits/auditoria-openrouter-manus.md), [NanoGPT](audits/auditoria-nanogpt.md) (filas 1-12 y P2-1 a P2-13) y su [segunda pasada](audits/auditoria-nanogpt-2.md).
- Evidencia del fallo: `.sandbox/data/logs/app.log`, rechazo del plan del 2026-10-25T02:40:47Z («model "openrouter::bytedance/seedance-2.0-mini" takes one start image… drop asset:… from refs»), repetido 5 veces entre el 24 y el 25. Sesión `ses_mvnqkurt4w2hudnbot` (sandbox, no versionada).
- El código se cita como `archivo:línea` del commit base.

## Qué dijo el usuario

| # | Cita | Fecha |
| --- | --- | --- |
| U1 | «Y porque no se usa openrouter?» | 2026-10-25 |
| U2 | «yo llegue a generar con openrouter y el modelo uso la imagen de inicio que creo en vez del storyboard… tampoco entiendo porque siempre usa es start frame y no image reference» | 2026-10-25 |
| U3 | «SI SACO DE LOS DOCS OFICIALES DEBE FUNCIONAR TAL CUAL… hace falta una pasada seria de la cadena que tenemos vs la doc de cada proveedor con cada uno de nuestros modelos principales» | 2026-10-25 |
| U4 | Martillo: «la formula» está bien, falla «su implementacion»; hay que usar los materiales correctos, no frágiles | 2026-10-25 |
| U5 | «Esto debe tener un freno, un storyboard no tiene sentido como imagen de inicio.» (ya hecho: `planFix.ts` `storyboardProblem`) | 2026-10-24 |
| U6 | El escritor de prompts «debe saber que settings hay activos en la card, mirar las imagenes adjuntas y actuar acorde» | 2026-10-24 |
| U7 | «No me convence del todo… ya he trabajado bastante en investigaciones… No se puede tirar por la borda» | 2026-10-24 |

## Reglas de ejecución (todas las fases)

- R1. **Un punto, un commit.** Cada commit dice el ID del punto (p. ej. `F1.2`).
- R2. **Cada campo que se toque lleva en el código la URL de la doc oficial** que lo define, y un test que compara el cuerpo enviado con el ejemplo de esa doc.
- R3. **Sin claves especulativas.** Si la doc o el catálogo no nombran el campo, no se envía; queda en «Fuera del plan» (Manus, NanoGPT §6).
- R4. **Después de cada punto:** `npm run test:related`. **Al entregar cada fase:** `npm test`, `node scripts/check-docs.mjs` y `node scripts/map.mjs --write`. Los tamaños de `scripts/size-baseline.json` no crecen. Si un test falla, no hay commit.
- R5. **Nada es «hecho» sin la prueba del usuario en el sandbox** (AGENTS.md, regla 2). Los tests solo prueban el código.
- R6. **Los envíos de pago los lanza el usuario.** El precio de Seedance 2.0 Mini en OpenRouter no está publicado en el catálogo, así que no se puede dar un coste máximo; por eso no lo lanza el agente (AGENTS.md).
- R7. **Cada fase se anota** en [historial 053](history/053-2026-10-W43.md), con lo frágil marcado.

## Decisiones que necesita el usuario antes de F1

| ID | Pregunta | Datos | Recomendación |
| --- | --- | --- | --- |
| D1 | Máximo de referencias de imagen por clip en OpenRouter | La doc de vídeo no fija máximo (auditoría OR #10, Manus §8). | **Decidido por el usuario (2026-10-25): «el maximo de referencias posibles, siempre, todas».** Sin tope de la app: el máximo del catálogo si lo da, y si no, todas las que haya. Si OpenRouter rechaza por número o tamaño (400/413), su error se muestra tal cual y no se envía nada recortado en silencio |
| D2 | Cómo nombrar las referencias en el prompt | La doc de OR no define sintaxis (OR #11, Manus §9). La regla de Seedance en `modelRules.ts:102-104` (`@Image1`) viene de Atlas y de la doc de ByteDance | **Decidido por el usuario: «Nombralas con @»**, `@Image1`, `@Image2`… en el orden de las referencias, también en OpenRouter. Además pide un selector al escribir `@` (F5) |
| D3 | Personajes en el prompt | El usuario (2026-10-25): «para eso ya hay varias investigaciones que señalan las mejores practicas». Están en `~/Descargas/Various/OpenGenStudio_VideoIA_5_Documentos_Oct2026/`: `02_Seis_mecanismos_de_prompting.md` §4 (First-frame anchoring: `first_frame_ref + inherit_attributes + do_not_inherit + … + consistency`; ejemplo «preserva rostro, ropa y encuadre») y §8 (Entity Consistency: registrar invariantes; Reference Role Contract: rol, atributos heredables y exclusiones por referencia); `03_Investigacion_repos_H3_Seedance_WAN.md:72-74` (Reference Lock con doble mapa; **Storyboard Grid to Video**: la hoja numerada fija orden y encuadres, otra referencia fija la identidad, el prompt conecta los paneles). En el código: `guides/seedance.md:19` (referencias por handle, «never re-describe them»), `:32` (storyboard grid) y `:37`; `guides/directing.md:23` (rol, heredar y excluir) | **Resuelto por la investigación existente; no hay regla nueva.** El caso del usuario es Storyboard Grid to Video: el storyboard `@Image1` da orden y encuadres, las personajes `@Image2` y `@Image3` dan la identidad, cada una con su rol, y no se redescriben. El fallo vino de forzar imagen a vídeo (F1.3), no de falta de descripción. Con solo imagen de inicio se aplica §4: decir qué atributos se heredan («preserve face, hair, outfit») y cuáles no |
| D4 | Intervalo de sondeo de vídeo en OpenRouter | La doc sugiere «e.g. 30 seconds», no obligatorio (Manus §7). Hoy son 5 s (`openrouter.ts:364`) | **Decidido por el usuario: «La mas optima»**, según cómo lo hacen OpenMontage y apps similares. Investigación encargada a Haiku; el valor se fija con su informe |

## Fase 0: contrato de entradas de vídeo (base de F1.3, F2.2 y F2.5)

Hallazgo P1 de GPT 6.1: un solo flag no expresa las reglas del último fotograma, y el validador no recibe ni `lastFrame` ni la resolución.

| ID | Qué | Dónde | Por qué (evidencia) | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| F0.1 | `InputSlots.frameRules?`, reglas por modelo que pone cada adaptador: `refsWithFirst`, `refsWithLast` y `videoWithLast` (si es `false`, no se combinan); `lastNeedsFirst` (`true`: el último fotograma necesita imagen de inicio); `firstFrameResolutions` (las resoluciones que admite con imagen de inicio). Sin `frameRules`, todo sigue como hoy | `types.ts:50-76` (`InputSlots`); el tamaño se compensa acortando comentarios (baseline 37306) | OpenRouter: precedencia de `frame_images` (guía). NanoGPT: P2-2 «End frames cannot be combined with reference media or reference-to-video mode», «Requires a start image»; P2-6 1080p solo en t2v | Test de tipos más tests de F1.3, F2.2 y F2.5 |
| F0.2 | `videoInputProblem` recibe también `lastFrame: boolean` y `resolution?: string`, y aplica `frameRules` con un mensaje por regla | `params.ts:978` | Hoy `n` solo tiene `firstFrame`, `images`, `videos` y `audios`; el último fotograma se comprueba aparte en `plan.ts:700` y la resolución no se comprueba | Tests por regla, con modelo con y sin `frameRules` |
| F0.3 | Actualizar las 5 llamadas a `videoInputProblem` para que pasen `lastFrame` y `resolution` | `jobs.ts:464`, `actions.ts:257`, `plan.ts:697`, `flow/actions.ts:289`, `agent/providerFit.ts:32` | Contrato del punto F0.2. Las 5 se cambian en el mismo commit (AGENTS.md, regla 4) | `npm run test:related`, más un test de cada llamada con un modelo que tenga `frameRules` |

## Fase 1: referencias de imagen en OpenRouter (caso del usuario: U1, U2)

Objetivo: el storyboard y las personajes llegan a Seedance como referencias, no como imagen de inicio.

| ID | Qué | Dónde | Por qué (evidencia) | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| F1.1 | Slot de referencias en vídeo: `images: { key: 'input_references', format: 'content-part', max: D1 }`, solo si la descripción del catálogo dice `reference-to-video`, `reference-based` o `reference-guided` | `providers/openrouter.ts:266-275` (`loadSchema` vídeo) | OR #1. Catálogo del 2026-10-25: Seedance 2.0, 2.0 Fast y 2.0 Mini dicen «multimodal reference-to-video», 2.5 «multimodal reference-based generation», Wan 3.0 «reference-guided». Wan 3.0 Prime solo «text-to-video and first-frame» (Manus §2), así que queda fuera | Test nuevo con las descripciones reales: los cinco tienen slot y Prime no |
| F1.2 | Enviar `body.input_references` con cada referencia como `{type:'image_url', image_url:{url}}` | `openrouter.ts:303-312` (`generate`); el formato sale de `shared.ts:11` | OpenAPI `POST /videos`: `input_references` son partes `image_url` ([referencia](https://openrouter.ai/docs/api/api-reference/video-generation/submit-a-video-generation-request.md)) | Test del cuerpo comparado con el ejemplo del [cookbook reference-to-video](https://openrouter.ai/docs/cookbook/video-generation/reference-to-video.md) |
| F1.3 | Enrutamiento y exclusión. Con `frameRules.refsWithFirst = false` (F0), `routeVideoInputs` deja **todas** las imágenes como referencias cuando el paso no fija `first_frame`; hoy la primera pasa a imagen de inicio sola (`params.ts:953`, `if (!first && slots.firstFrame && rest.length) first = rest.shift()`). Con `first_frame` explícito y referencias, el validador da un problema con su arreglo («referencias o imagen de inicio, no las dos») y no se envía `frame_images` | `params.ts:948-959` (`routeVideoInputs`), `params.ts:978` (`videoInputProblem`), `planFix.ts:7-10` | Doc: «If both fields are provided, frame_images takes precedence and the request is treated as image-to-video» (guía de vídeo; OR #5 y Manus §2). Hallazgo P1 de GPT 6.1 | Tests: (a) storyboard y personaje en `refs` sin `first_frame` llegan los dos a `input_references` y el cuerpo no lleva `frame_images`, con el mismo resultado en las 6 llamadas de `routeVideoInputs` (`plan.ts:696`, `jobs.ts:462`, `actions.ts:256` y `:294`, `flow/actions.ts:288`, `Composer.tsx:321`); (b) `first_frame` más referencias da un problema; (c) solo imagen de inicio pasa. Los tests de NanoGPT y Atlas no cambian |
| F1.4 | `acceptsImage` también es verdadero cuando el modelo acepta referencias | `openrouter.ts:212` | Hoy solo cuenta `first_frame`; el agente y el selector creen que no hay referencias | Test de `listModels` |
| F1.5 | Resolver `polling_url` con `new URL(url, 'https://openrouter.ai')` | `openrouter.ts:321` | El OpenAPI muestra la URL relativa y el cookbook la resuelve así (OR #7, Manus §7) | Test con URL relativa y con absoluta |
| F1.6 | Nombrar las referencias según D2 | `modelRules.ts:102-104` (excepción por proveedor) y el texto que lee el agente | D2 | Test de la regla que recibe el agente para `openrouter::bytedance/seedance-2.0-mini` |
| F1.7 | Comprobar que el agente y el escritor de prompts reciben esas reglas para Seedance en OpenRouter (la guía `seedance.md` y `directing.md:23`) y aplican Storyboard Grid to Video cuando hay storyboard y personajes. Sin reglas nuevas | `agent/planSettings.ts:167` (el escritor recibe la guía del modelo); `procedure.ts:130` (`VIDEO_DIRECTION_POLICY`) | D3; U6, U7 | Test: el texto del sistema del escritor para `openrouter::bytedance/seedance-2.0-mini` contiene la guía de Seedance. El juicio final es del usuario |

**Prueba del usuario al cerrar F1** (R5, R6): en el sandbox, Seedance 2.0 Mini en OpenRouter, 4 s a 480p, con el storyboard y una personaje como referencias, sin imagen de inicio. Se revisan tres cosas en el registro: (a) el cuerpo enviado lleva `input_references` y no `frame_images`; (b) OpenRouter acepta las data URL, que es la única incógnita (OR §0, Manus §1); (c) el estilo y las personajes. Si (b) falla, F1 se detiene y se reporta: con estas claves no hay forma de alojar las imágenes (OR §0).

## Fase 2: NanoGPT, lo urgente (Manus NanoGPT §6, P0 y P1)

| ID | Qué | Dónde | Por qué (evidencia) | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| F2.1 | Último fotograma de MiniMax H3 Max, H3 Max Turbo y Gemini Omni Flash 1.1: clave `lastImageUrl` con data URL cuando el catálogo la lista | `providers/nanogpt.ts:291` (hoy exige `last_image`) | P2-1: el catálogo dice «Public HTTP(S) image URL or base64 image data URI». Es el único último fotograma local documentado | Test con la entrada real del catálogo: slot presente, clave `lastImageUrl` |
| F2.2 | Exclusiones del catálogo con `frameRules` (F0): `refsWithLast: false`, `videoWithLast: false` y `lastNeedsFirst: true` para H3 Max, H3 Max Turbo y Gemini Omni Flash 1.1, solo cuando su catálogo trae la frase | `nanogpt.ts` (`videoSchema`, l. 269-310) | P2-2: «End frames cannot be combined with reference media or reference-to-video mode», «…with reference images, reference videos, or a source video», «Requires a start image» | Tests de las tres reglas con las entradas reales del catálogo |
| F2.4 | Desactivar la clave `referenceAudios` | `nanogpt.ts:304` | NanoGPT fila 5: no documentada (confirmado por Manus). R3 | Test: sin slot `refAudios`. Hoy no se activa nunca (los campos son solo URL), así que el usuario no nota cambio |
| F2.5 | 1080p de Grok Imagine Video 1.5 solo sin imagen de inicio: `frameRules.firstFrameResolutions` sin 1080p | `nanogpt.ts` (`videoSchema`), `params.ts:978` (F0.2) | P2-6: 1080p solo en t2v (catálogo; confirmado por Manus) | Test: 1080p con imagen de inicio da un problema; 1080p sin ella pasa |

## Fase 3: OpenRouter, opciones por proveedor

| ID | Qué | Dónde | Por qué (evidencia) | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| F3.1 | Opciones de imagen leídas del endpoint (`/images/models/{id}/endpoints`), no del catálogo agregado | `openrouter.ts:227-231` (hoy agregado); los endpoints ya se leen para el precio en `openrouter.ts:134` | OR #5 y Manus §5-§6: el agregado es una unión y el endpoint es la autoridad | Test con la respuesta real de los endpoints de gpt-image-2: solo se ofrecen sus valores |
| F3.2 | Passthrough de imagen: `provider.options[slug]` con claves directas, solo las de `allowed_passthrough_parameters` del endpoint | `openrouter.ts` `generate` imagen (l. 286-300) | Guía de imagen (OR #5, #13; Manus §5). Ejemplos: `moderation` en gpt-image-2; Recraft por variante | Test del cuerpo de gpt-image-2 y de Recraft V4 |
| F3.3 | Passthrough de vídeo: `provider.options[slug].parameters`, solo si el slug del proveedor está documentado | `openrouter.ts` `generate` vídeo | OR #3 y el [cookbook provider-specific](https://openrouter.ai/docs/cookbook/video-generation/provider-specific-video-options.md). Slug de Seedance: desconocido (Manus §3), así que Seedance queda fuera hasta conocerlo | Test con Veo (`google-vertex`, el del cookbook) |
| F3.4 | Referencias de audio y vídeo, solo para Seedance 2.0 Mini | `openrouter.ts` `loadSchema` y `generate` | OpenAPI: input_references acepta audio/vídeo, «honored by… BytePlus Seedance generation 2 and newer». Solo la descripción de Mini lo dice (Manus §2) | Test del cuerpo. Requiere otra prueba del usuario (R5) |

## Fase 4: NanoGPT, controles que faltan (Manus NanoGPT P1 y P2)

| ID | Qué | Dónde | Por qué (evidencia) | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| F4.1 | Kling 3.0 Pro: `multi_prompt` y `element_list` | `nanogpt.ts:271` (el filtro descarta los parámetros de texto) | NanoGPT fila 9 (confirmado por Manus §3) | Test del esquema con la entrada del catálogo |
| F4.2 | Nano Banana 2.1: `seed` y `enable_web_search` | `nanogpt.ts:191-237` (`imageSchema`) | P2-12 (confirmado por Manus §4) | Test del esquema |
| F4.3 | MiniMax H3 Max: no borrar `aspect_ratio: adaptive` | `nanogpt.ts:505` | P2-9 | Test del cuerpo |
| F4.4 | MiniMax H3: aclarar que `resolution` es para LoRA, edición y extensión | `nanogpt.ts` (`videoSchema`) | Fila 7 (confirmado por Manus §3) | Test de la etiqueta |
| F4.5 | Seedance 2.5 talking-avatar: avisar antes de enviar si el audio pasa de 4 MB | `providers/bodyBudget.ts` | P2-7 | Test con un audio grande: error claro, sin envío |

## Fase 5: selector `@` para enlazar referencias (pedido del usuario, D2)

Cita: «lo que yo quiero es que sea posible enlazarlas como lo hacen la mayoria de apps donde puedes referencias con el arroba y aparece un pequeño plegable con las opciones de enlazarla a imagen 1, imagen 2, etc.» (2026-10-25). Hoy `@Name` existe, pero se escribe a mano (`components/composer/MediaControls.tsx:381-405`, `components/assets/AssetActions.tsx:246`).

| ID | Qué | Dónde | Por qué (evidencia) | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| F5.1 | Investigar cómo lo resuelven otras apps (comportamiento, teclado, qué se lista) antes de diseñar | Informe en `docs/` | Memorias «Research pro solutions first» y «Own style, not copies» | Informe con fuentes |
| F5.2 | Maqueta antes y después, con nuestro estilo de tarjetas | `docs/mockups/` | Cambio de interfaz: AGENTS.md, reglas 3 y 6 (aprobación explícita) | Aprobación del usuario |
| F5.3 | Implementar: escribir `@` abre un desplegable con las imágenes adjuntas y los sujetos (Image 1, Image 2, @Name, con miniatura); elegir una inserta su `@`; teclado y escape. Se usa el mismo componente en el composer y en el prompt editable de la tarjeta del plan | Componentes del composer y `components/chat/PlanParts.tsx` | D2 | Test jsdom: `@` abre la lista, la flecha y Enter insertan, Escape cierra. Prueba visual del usuario |

## Fuera del plan (R3), con motivo

- **Máximo de 7 referencias de Grok Imagine reference-to-video (antes F2.3):** sin fuente verificable. El catálogo (`/api/v1/video-models?detailed=true`, id `grok-imagine-video-reference-to-video`, leído el 2026-10-25) no da máximo: solo «Requires one or more reference images». Manus citó la ficha sin URL, y las rutas de ficha probadas dan 404. Hallazgo P2 de GPT 6.1. Sigue en 4 (`nanogpt.ts:293`) hasta tener una URL.

- **Último fotograma de Wan 3 y de Seedance 2.5 en NanoGPT:** el catálogo no nombra el campo (fila 3, P2-1; Manus §3 A).
- **Calidad y 1K/2K de Grok Image, calidad y máscara de Ideogram, style ID de Recraft:** existen en NanoGPT, pero no se conoce el nombre del campo (P2-10, P2-11, P2-13; Manus §4).
- **Cambiar a `api.nano-gpt.com` o subir el tope de 4 MB:** un límite HTTP mayor no prueba que el endpoint lo acepte (fila 1; Manus §1). Se queda como está.
- **`previous_job_id` (extender vídeo en OpenRouter):** la doc no lo liga a modelos concretos (OR #4, Manus §4).
- **`imageDataUrls` en `/v1/images` de NanoGPT:** se conserva por la prueba del [historial 014](history/014-2026-09-W39.md), punto 1.
- **Referencias de NanoGPT en Seedance 2.0 y MiniMax H3:** solo enlaces y sin subida documentada (fila 8). El bloqueo actual es correcto.

## Cómo se corrobora que nada se rompió

1. **Tests nuevos por punto**, en la tabla de cada fase, en `tests/providers.test.ts` o en archivos nuevos `tests/openrouter-refs.test.ts` y `tests/nanogpt-frames.test.ts`.
2. **Red existente:** `npm test` completo (hoy 1101 tests en verde con `test:related`), en especial `tests/providers.test.ts`, `tests/storyboard-sheet.test.ts`, `tests/auto-plan-card.test.ts` y el snapshot `tests/fixtures/live/expected.txt`. Si el snapshot cambia, el diff se revisa línea por línea y se explica en el commit, no se acepta a ciegas (lección de `3dbc579`).
3. **Atlas y fal sin cambios:** `frameRules` (F0) solo lo ponen OpenRouter y NanoGPT. Sin él, `routeVideoInputs` y `videoInputProblem` dan lo mismo que hoy, y los tests actuales de Atlas y fal deben pasar sin tocarlos.
4. **Guardas del repo:** `check-docs`, `map`, tamaños de `size-baseline.json` (`types.ts` 37306 y `params.ts` 61913 no pueden crecer: se compensa acortando comentarios del mismo archivo).
5. **Prueba del usuario en el sandbox** al cerrar F1 y F3.4 (R5, R6), con el cuerpo enviado leído del registro.
6. **Revisión independiente** del diff de cada fase antes de reportarla (GPT 6.1 o un subagente), contra este documento.
