# Ejecución del plan de proveedores

2026-10-25. Rama aislada `task/provider-plan`, base `696bd6c`, worktree `ogs-provider-plan`. Se conserva el [plan](plan-proveedores-2026-10-25.md) y sus decisiones D1-D4. No se fusiona con la app original. Tres roles Luna realizaron contrato, OpenRouter y NanoGPT; el coordinador revisa e integra sus commits.

## Cambios por fase

Estado de F0–F5: código implementado y comprobado con tests; pendiente de prueba del usuario en el sandbox. Ninguna fase se declara entregada bajo R5. F2–F5 se implementaron antes de esperar esa prueba de F1: desviación del orden del plan, no aprobación implícita.

- **F0, contrato:** `frameRules` opcional; `lastFrame`, `sourceVideo` y resolución llegan al validador. Se comprueba la combinación final con sujetos y vídeo fuente. Sin `frameRules` se conserva la ruta anterior. Cobertura: [reglas](../tests/video-frame-rules.test.ts), [llamadas](../tests/video-frame-callers.test.ts), [ejecutor](../tests/video-frame-executor.test.ts).
- **F1, OpenRouter:** imágenes como referencias cuando el catálogo lo permite; sin promoción automática a inicio en esa ruta. Fotogramas y referencias incompatibles se rechazan. `acceptsImage`, guía Seedance y URL de sondeo coherentes, también al reanudar. Cobertura: [referencias](../tests/openrouter-refs.test.ts), [escritor](../tests/seedance-openrouter-guide.test.ts).
- **F2, NanoGPT:** último fotograma documentado, exclusiones por catálogo, retirada de `referenceAudios` especulativo y resolución de Grok con inicio. Cobertura: [fotogramas](../tests/nanogpt-frames.test.ts).
- **F3, OpenRouter:** intersección de valores/rangos entre endpoints; passthrough desde los ajustes reales y sus allowlists por slug; Veo solo con slug documentado; audio y vídeo de referencia para Mini. Cobertura: [opciones y cuerpos](../tests/openrouter-options.test.ts).
- **F4, NanoGPT:** controles y cuerpos se comprueban en [controles](../tests/nanogpt-controls.test.ts). El audio conserva el límite HTTP y no se recomprime para ocultarlo. F4.4 ya lo resolvía el parser: se probó la etiqueta real de MiniMax H3 sin añadir otra regla. F4.1 sigue excluido, como decidió el plan.
- **F5:** exclusivamente autocompletado en los campos existentes. El usuario aclaró en este chat que solo quería referencias con @, sin rediseño: no hay rediseño ni otra tarjeta. Se reutiliza `Popover`; no se añade CSS. Cobertura: [teclado, cursor, sujetos y editor del plan](../tests/reference-mentions.test.ts).

## Evidencia y límites

Los tests de envío usan respuestas simuladas y no gastan créditos. El escritor se prueba capturando su mensaje de sistema con transporte simulado; esto no prueba la calidad de un vídeo real.

Se probó el autocompletado en el navegador contra el sandbox vacío de este worktree: dos imágenes y un sujeto sintéticos, selección de la segunda imagen con flecha/Enter, Escape sin borrar texto. Navegador y sandbox detenidos al acabar. Se usaron fuentes de sistema de reserva porque los archivos de fuentes del directorio de dependencias enlazado recibían 403; no se cambió la configuración de la app por ello.

Quedan al usuario los envíos de pago de R5/R6: aceptación de data URL por OpenRouter, resultado de storyboard/personajes y referencias de audio/vídeo de Mini. No hay prueba real de proveedor ni se declara cerrado ese resultado.

La primera ejecución completa encontró una regresión real: el acceso nuevo a endpoints bloqueaba la carga de modelos de imagen. Cambiar el test para aceptar el error fue incorrecto; C1 restaura el catálogo como respaldo cuando falla la consulta o llega vacía, sin cachear el fallo. La guía no se cambió: el test incorpora exactamente las dos sustituciones del commit previo `cf1f286`, marcado para revisar; no se atribuye aprobación del usuario a ese cambio previo. El snapshot conserva únicamente la retirada de audio especulativo y la regla de resolución nueva, con su valor concreto en lugar de `undefined`.

## Granularidad

Los cambios del contrato incluyen firma y llamadas juntas. Los commits `79cf4ed`, `8ca32f8`, `c4597f4` y `ffc4669` agruparon puntos, incumpliendo la granularidad R1; no se reescribe ese historial. Los ajustes posteriores tienen commits propios. No se elevaron los tamaños permitidos ni se alteró persistencia protegida.

Verificación integrada sobre `0e64260`: `npm test -- --maxWorkers=2` pasa (381 archivos, 2623 tests; 5 omitidos existentes), junto con `npm run typecheck`, aislamiento, protección, documentación, tamaños y mapa. El [historial 053](history/053-2026-10-W43.md) registra la implementación pendiente de aceptación; el commit posterior solo actualiza esta documentación.

## Correcciones C1–C6 tras revisión de Claude

Dos subagentes Luna y revisión del coordinador. C1 restaura el respaldo del catálogo de imagen; C2 exige data URI/base64 explícito para el último fotograma (H3 Max, Turbo y Gemini Omni sí; Kling 4.0 no); C3 corrige el enlace de envío de vídeo; diez URLs públicas verificadas con HTTP 200. C4 añade el caso Mini con inicio/final soportados, storyboard/personaje como referencias, sujetos con último fotograma que llegan al guard final y cobertura de las siete llamadas de enrutamiento. C5 identifica los 4 MB de audio como presupuesto del cuerpo de la app (`NANOGPT_BODY_LIMIT`), no límite documentado del modelo. C6 corrige estados y registra las desviaciones anteriores.

La frase de F5 sí procede del usuario en este chat: «no quiero ningun cambio de GUI, solo que se referencien», seguida de la selección con arroba. Autoriza ese comportamiento en los campos actuales; no acredita la aceptación visual R5. No hubo nuevos envíos de pago, prueba de proveedor ni acceso a datos reales.

Verificación de C1–C6 sobre `4a017fa`: `npm test -- --maxWorkers=2` pasa, 382 archivos y 2627 tests; 5 omitidos existentes. Pasan typecheck y guardas de aislamiento, datos protegidos, documentación, tamaños y mapa. Tests relacionados por corrección: C1 17, C2 5, C3 1154, C4 17 y C5 5; C6 solo documentación, sin tests relacionados. Esta anotación posterior solo registra el resultado; la prueba del usuario sigue pendiente.

## C7 — Endpoints de imagen con capacidades desconocidas

Revisión de `4f5ff03` sobre `ecf6296`, en `task/provider-plan`. En `src/engine/providers/openrouterOptions.ts`, `commonImageParameters` excluye endpoints sin `supported_parameters`; si ninguno declara, devuelve `undefined`. `src/engine/providers/openrouter.ts` usa entonces `raw.supported_parameters` del catálogo. Un objeto declarado `{}` sigue participando y una intersección vacía sigue devolviendo `{}`: no recupera opciones incompatibles del catálogo.

La intersección entre endpoints declarados conserva el algoritmo anterior: enums comunes, máximo de mínimos y mínimo de máximos para rangos; se omiten rangos incompatibles y parámetros ausentes o con tipos distintos. `imageProviderOptions` y su llamada de envío no cambiaron; el filtro es local a la intersección y no altera los endpoints ni sus allowlists de passthrough. La búsqueda de llamadores encontró únicamente `loadSchema`, actualizado en el mismo commit: ningún otro llamador dependía del `{}` anterior. No se encontraron fallos concretos en esta revisión.

Los dos tests nuevos de `tests/openrouter-options.test.ts` comprueban un endpoint sin declaración junto a uno declarado y el respaldo del catálogo cuando ninguno declara. Los tests existentes comprueban enum común, rango intersectado y passthrough por slug/allowlist. Revisión de código y tests simulados: sin prueba visual ni ejecución de proveedor. F0–F5 siguen pendientes de la prueba del usuario en sandbox (R5); no se tocaron datos reales ni se gastaron créditos de proveedor.

Evidencia ejecutada sobre `4f5ff03`: `npm run test:related -- src/engine/providers/openrouterOptions.ts src/engine/providers/openrouter.ts tests/openrouter-options.test.ts` pasa (168 archivos / 1156 tests; 4 omitidos), incluidos los dos casos nuevos y las regresiones de intersección/passthrough. `npm test -- --maxWorkers=2` pasa (382 archivos / 2629 tests; 5 omitidos existentes), junto con las guardas de aislamiento, protección, documentación, tamaños y mapa. `npm run typecheck` pasa. `node scripts/map.mjs --write` no produjo cambios. Solo se añade documentación de verificación; el código de C7 permanece intacto.
