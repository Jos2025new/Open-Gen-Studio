# Persistencia

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| El guardado diferido inicia una escritura como máximo tras 2 s de cambios continuos. | [src/store/store.ts](../../src/store/store.ts) | [tests/save-max-wait.test.ts](../../tests/save-max-wait.test.ts) |
| El servidor serializa guardados de estado y rechaza una base obsoleta con 409. | [server/local-store.js](../../server/local-store.js) | [tests/store-server.test.ts](../../tests/store-server.test.ts) |
| La cabecera X-OGS-Automated: 1 rechaza escrituras de estado, medios, logs y borrado con 403. | [server/local-store.js](../../server/local-store.js) | [tests/store-server.test.ts](../../tests/store-server.test.ts) |
| Las copias se conservan antes de reducir sesiones y cada 10 minutos al guardar; perder más de la mitad de al menos dos sesiones aparta el intento. | [server/local-store.js](../../server/local-store.js) | sin test |
