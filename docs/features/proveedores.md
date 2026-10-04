# Proveedores

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| El registro incluye los adaptadores local, OpenRouter, fal, NanoGPT y Atlas. | [src/engine/providers/registry.ts](../../src/engine/providers/registry.ts) | sin test |
| Los esquemas describen entradas y parámetros; el enrutamiento adapta imágenes a fotogramas o referencias según las capacidades. | [src/engine/params.ts](../../src/engine/params.ts) | [tests/providers.test.ts](../../tests/providers.test.ts) |
| La cotización de Atlas usa modelo y parámetros del envío; una cotización fallida mantiene la estimación. | [src/engine/quotes.ts](../../src/engine/quotes.ts) | [tests/quotes.test.ts](../../tests/quotes.test.ts) |
