# Ejecución del plan de proveedores

2026-10-25. Rama aislada `task/provider-plan`, base `696bd6c`, worktree `ogs-provider-plan`. Se conserva el [plan](plan-proveedores-2026-10-25.md) y sus decisiones D1-D4. No se fusiona con la app original. Tres roles Luna realizaron contrato, OpenRouter y NanoGPT; el coordinador revisa e integra sus commits.

## Cambios por fase

- **F0, contrato:** `frameRules` opcional; `lastFrame`, `sourceVideo` y resolución llegan al validador. Se comprueba la combinación final con sujetos y vídeo fuente. Sin `frameRules` se conserva la ruta anterior. Cobertura: [reglas](../tests/video-frame-rules.test.ts), [llamadas](../tests/video-frame-callers.test.ts), [ejecutor](../tests/video-frame-executor.test.ts).
- **F1, OpenRouter:** imágenes como referencias cuando el catálogo lo permite; sin promoción automática a inicio en esa ruta. Fotogramas y referencias incompatibles se rechazan. `acceptsImage`, guía Seedance y URL de sondeo coherentes, también al reanudar. Cobertura: [referencias](../tests/openrouter-refs.test.ts), [escritor](../tests/seedance-openrouter-guide.test.ts).
- **F2, NanoGPT:** último fotograma documentado, exclusiones por catálogo, retirada de `referenceAudios` especulativo y resolución de Grok con inicio. Cobertura: [fotogramas](../tests/nanogpt-frames.test.ts).
- **F3, OpenRouter:** intersección de valores/rangos entre endpoints; passthrough desde los ajustes reales y sus allowlists por slug; Veo solo con slug documentado; audio y vídeo de referencia para Mini. Cobertura: [opciones y cuerpos](../tests/openrouter-options.test.ts).
- **F4, NanoGPT:** controles y cuerpos se comprueban en [controles](../tests/nanogpt-controls.test.ts). El audio conserva el límite HTTP y no se recomprime para ocultarlo. F4.4 ya lo resolvía el parser: se probó la etiqueta real de MiniMax H3 sin añadir otra regla. F4.1 sigue excluido, como decidió el plan.
- **F5:** exclusivamente autocompletado en los campos existentes. El usuario retiró la aprobación de maqueta: no hay rediseño ni otra tarjeta. Se reutiliza `Popover`; no se añade CSS. Cobertura: [teclado, cursor, sujetos y editor del plan](../tests/reference-mentions.test.ts).

## Evidencia y límites

Los tests de envío usan respuestas simuladas y no gastan créditos. El escritor se prueba capturando su mensaje de sistema con transporte simulado; esto no prueba la calidad de un vídeo real.

Se probó el autocompletado en el navegador contra el sandbox vacío de este worktree: dos imágenes y un sujeto sintéticos, selección de la segunda imagen con flecha/Enter, Escape sin borrar texto. Navegador y sandbox detenidos al acabar. Se usaron fuentes de sistema de reserva porque los archivos de fuentes del directorio de dependencias enlazado recibían 403; no se cambió la configuración de la app por ello.

Quedan al usuario los envíos de pago de R5/R6: aceptación de data URL por OpenRouter, resultado de storyboard/personajes y referencias de audio/vídeo de Mini. No hay prueba real de proveedor ni se declara cerrado ese resultado.

La primera ejecución completa encontró un test de precios que asumía el acceso anterior al endpoint y una expectativa antigua de la guía Seedance. Ahora se prueba por separado que una carga de capacidades fallida se rechaza y reintenta, y que un fallo de precio no queda cacheado. La guía no se cambió: el test incorpora exactamente las dos sustituciones del commit previo `cf1f286`. El snapshot conserva únicamente la retirada de audio especulativo y la regla de resolución nueva, con su valor concreto en lugar de `undefined`.

## Granularidad

Los cambios del contrato incluyen firma y llamadas juntas. F1 y F3 se agruparon en commits por fase, en lugar de uno por subpunto de R1; sus pruebas se ejecutaron por separado. Los ajustes posteriores tienen commits propios. No se elevaron los tamaños permitidos ni se alteró persistencia protegida.

Verificación integrada sobre `0e64260`: `npm test -- --maxWorkers=2` pasa (381 archivos, 2623 tests; 5 omitidos existentes), junto con `npm run typecheck`, aislamiento, protección, documentación, tamaños y mapa. El [historial 053](history/053-2026-10-W43.md) registra el cierre; el commit posterior solo actualiza esta documentación.
