# Plan: proveedores de vídeo e imagen contra su doc oficial (2026-10-25)

Estado: **propuesto, sin implementar, para auditar (GPT 6.1)**. Rama `task/auto-plan-card`, worktree `ogs-auto-plan-card`, base `e7fa70d`. Nada se fusiona.

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
| D1 | Máximo de referencias de imagen por clip en OpenRouter | La doc de vídeo no fija máximo (auditoría OR #10, Manus §8). La de imagen dice 16. Atlas da 9 para el mismo Seedance 2.0 Mini (historial 053, punto 15) | 9, marcado frágil. El caso del usuario usa 3 |
| D2 | Cómo nombrar las referencias en el prompt en OpenRouter | La doc de OR no define sintaxis y el cookbook pide lenguaje natural (OR #11, Manus §9). La regla de Seedance en `modelRules.ts:102-104` (`@Image1`) viene de Atlas | Para OpenRouter, lenguaje natural por orden y rol («image 1 is the storyboard…»), sin `@`. Atlas no cambia |
| D3 | Describir a las personajes en el prompt | `peopleLook.ts:11` dice: si una referencia o imagen de inicio muestra a la persona, «cite it, do not describe or change it». En el fallo, la imagen de inicio era un plano general con figuras diminutas y el prompt cortaba a planos cercanos sin describirlas (prompt en la sesión del sandbox) | Con referencias se mantiene «citar». Con solo imagen de inicio y cortes a otros planos, describir los rasgos visibles (pelo, ojos, piel, ropa) |
| D4 | Intervalo de sondeo de vídeo en OpenRouter | La doc sugiere «e.g. 30 seconds», no obligatorio (Manus §7). Hoy son 5 s (`openrouter.ts:364`). Prioridad del usuario: sin latencia (memoria «User priorities») | Mantener 5 s. Se anota la desviación |

## Fase 1: referencias de imagen en OpenRouter (caso del usuario: U1, U2)

Objetivo: el storyboard y las personajes llegan a Seedance como referencias, no como imagen de inicio.

| ID | Qué | Dónde | Por qué (evidencia) | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| F1.1 | Slot de referencias en vídeo: `images: { key: 'input_references', format: 'content-part', max: D1 }`, solo si la descripción del catálogo dice `reference-to-video`, `reference-based` o `reference-guided` | `providers/openrouter.ts:266-275` (`loadSchema` vídeo) | OR #1. Catálogo del 2026-10-25: Seedance 2.0, 2.0 Fast y 2.0 Mini dicen «multimodal reference-to-video», 2.5 «multimodal reference-based generation», Wan 3.0 «reference-guided». Wan 3.0 Prime solo «text-to-video and first-frame» (Manus §2), así que queda fuera | Test nuevo con las descripciones reales: los cinco tienen slot y Prime no |
| F1.2 | Enviar `body.input_references` con cada referencia como `{type:'image_url', image_url:{url}}` | `openrouter.ts:303-312` (`generate`); el formato sale de `shared.ts:11` | OpenAPI `POST /videos`: `input_references` son partes `image_url` ([referencia](https://openrouter.ai/docs/api/api-reference/video-generation/submit-a-video-generation-request.md)) | Test del cuerpo comparado con el ejemplo del [cookbook reference-to-video](https://openrouter.ai/docs/cookbook/video-generation/reference-to-video.md) |
| F1.3 | Referencias e imagen de inicio no van juntas: si hay referencias, no se envía `frame_images` y el plan explica por qué. Flag nuevo en `InputSlots` (`framesOrRefs`), lo pone solo OpenRouter | `types.ts` (InputSlots, l. 50-76), `params.ts:978` `videoInputProblem`, `planFix.ts:7-10` | Doc: «If both fields are provided, frame_images takes precedence and the request is treated as image-to-video» (guía de vídeo; OR #5 y Manus §2) | Tests: referencias más imagen de inicio da un problema con su arreglo; solo referencias pasa; solo imagen de inicio pasa. Los tests de NanoGPT y Atlas no cambian |
| F1.4 | `acceptsImage` también es verdadero cuando el modelo acepta referencias | `openrouter.ts:212` | Hoy solo cuenta `first_frame`; el agente y el selector creen que no hay referencias | Test de `listModels` |
| F1.5 | Resolver `polling_url` con `new URL(url, 'https://openrouter.ai')` | `openrouter.ts:321` | El OpenAPI muestra la URL relativa y el cookbook la resuelve así (OR #7, Manus §7) | Test con URL relativa y con absoluta |
| F1.6 | Nombrar las referencias según D2 | `modelRules.ts:102-104` (excepción por proveedor) y el texto que lee el agente | D2 | Test de la regla que recibe el agente para `openrouter::bytedance/seedance-2.0-mini` |
| F1.7 | Descripción de personajes según D3 | `peopleLook.ts:11`; el escritor de prompts en `agent/planSettings.ts:167` usa `VIDEO_DIRECTION_POLICY` (`procedure.ts:130`) | D3; U6 | Test del texto del sistema del escritor. El juicio final es del usuario |

**Prueba del usuario al cerrar F1** (R5, R6): en el sandbox, Seedance 2.0 Mini en OpenRouter, 4 s a 480p, con el storyboard y una personaje como referencias, sin imagen de inicio. Se revisan tres cosas en el registro: (a) el cuerpo enviado lleva `input_references` y no `frame_images`; (b) OpenRouter acepta las data URL, que es la única incógnita (OR §0, Manus §1); (c) el estilo y las personajes. Si (b) falla, F1 se detiene y se reporta: con estas claves no hay forma de alojar las imágenes (OR §0).

## Fase 2: NanoGPT, lo urgente (Manus NanoGPT §6, P0 y P1)

| ID | Qué | Dónde | Por qué (evidencia) | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| F2.1 | Último fotograma de MiniMax H3 Max, H3 Max Turbo y Gemini Omni Flash 1.1: clave `lastImageUrl` con data URL cuando el catálogo la lista | `providers/nanogpt.ts:291` (hoy exige `last_image`) | P2-1: el catálogo dice «Public HTTP(S) image URL or base64 image data URI». Es el único último fotograma local documentado | Test con la entrada real del catálogo: slot presente, clave `lastImageUrl` |
| F2.2 | Exclusiones del catálogo: el último fotograma no va con referencias ni con vídeo fuente, y necesita imagen de inicio. Usa el mismo mecanismo que F1.3 | `nanogpt.ts` (`videoSchema`), `params.ts:978` | P2-2: «End frames cannot be combined with reference media…», «Requires a start image» | Tests de las tres combinaciones |
| F2.3 | Máximo de referencias de Grok Imagine reference-to-video: 7 | `nanogpt.ts:293` (`upTo(…, 4)`) | Manus NanoGPT §3 B: la ficha de NanoGPT anuncia hasta 7. URL exacta de la ficha: pendiente de que la aporte Manus | Test: `max` = 7 para ese id |
| F2.4 | Desactivar la clave `referenceAudios` | `nanogpt.ts:304` | NanoGPT fila 5: no documentada (confirmado por Manus). R3 | Test: sin slot `refAudios`. Hoy no se activa nunca (los campos son solo URL), así que el usuario no nota cambio |
| F2.5 | 1080p de Grok Imagine Video 1.5 solo sin imagen de inicio | `nanogpt.ts` (`videoSchema`), `params.ts:978` | P2-6: 1080p solo en t2v (catálogo; confirmado por Manus) | Test: 1080p con imagen de inicio da un problema |

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

## Fuera del plan (R3), con motivo

- **Último fotograma de Wan 3 y de Seedance 2.5 en NanoGPT:** el catálogo no nombra el campo (fila 3, P2-1; Manus §3 A).
- **Calidad y 1K/2K de Grok Image, calidad y máscara de Ideogram, style ID de Recraft:** existen en NanoGPT, pero no se conoce el nombre del campo (P2-10, P2-11, P2-13; Manus §4).
- **Cambiar a `api.nano-gpt.com` o subir el tope de 4 MB:** un límite HTTP mayor no prueba que el endpoint lo acepte (fila 1; Manus §1). Se queda como está.
- **`previous_job_id` (extender vídeo en OpenRouter):** la doc no lo liga a modelos concretos (OR #4, Manus §4).
- **`imageDataUrls` en `/v1/images` de NanoGPT:** se conserva por la prueba del [historial 014](history/014-2026-09-W39.md), punto 1.
- **Referencias de NanoGPT en Seedance 2.0 y MiniMax H3:** solo enlaces y sin subida documentada (fila 8). El bloqueo actual es correcto.

## Cómo se corrobora que nada se rompió

1. **Tests nuevos por punto**, en la tabla de cada fase, en `tests/providers.test.ts` o en archivos nuevos `tests/openrouter-refs.test.ts` y `tests/nanogpt-frames.test.ts`.
2. **Red existente:** `npm test` completo (hoy 1101 tests en verde con `test:related`), en especial `tests/providers.test.ts`, `tests/storyboard-sheet.test.ts`, `tests/auto-plan-card.test.ts` y el snapshot `tests/fixtures/live/expected.txt`. Si el snapshot cambia, el diff se revisa línea por línea y se explica en el commit, no se acepta a ciegas (lección de `3dbc579`).
3. **Atlas y fal sin cambios:** F1.3 y F2.2 solo actúan con el flag nuevo, que ponen OpenRouter y NanoGPT. Sus tests actuales deben pasar sin tocarlos.
4. **Guardas del repo:** `check-docs`, `map`, tamaños de `size-baseline.json` (`types.ts` 37306 y `params.ts` 61913 no pueden crecer: se compensa acortando comentarios del mismo archivo).
5. **Prueba del usuario en el sandbox** al cerrar F1 y F3.4 (R5, R6), con el cuerpo enviado leído del registro.
6. **Revisión independiente** del diff de cada fase antes de reportarla (GPT 6.1 o un subagente), contra este documento.
