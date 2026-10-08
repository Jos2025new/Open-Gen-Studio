# 0010 — Estrategia de pruebas: tests fiables con carga y cobertura por riesgo

## Estado

Aceptado

## Fecha

2026-10-08

## Contexto

El usuario delegó la elección el 2026-10-08: «Escoge lo mejor y documenta por qué».

- **Falsas alarmas.** Con la máquina ocupada por otros procesos, `npm test` fallaba en tests correctos: hasta 8 con una carga de 34, y ninguno sin carga. Se midieron tres causas distintas:
  1. **Tiempo real simulado con esperas reales.** `save-max-wait` esperaba 3,5 s de verdad. Los reintentos de Atlas (`atlas-developer`) usaban un reloj falso que avanzaba con el reloj real (`shouldAdvanceTime`) y tardaban 5,3 s.
  2. **Pausas fijas que compiten con una escritura.** `state-conflict` esperaba 150 ms y daba por hecha la escritura en disco: con carga, `ENOENT`.
  3. **Trabajo real de CPU.** Renderizar React e importar la app entera. El primer test de cada archivo paga la carga de módulos y pasaba de los 5 s por defecto. Con un reloj falso activo durante esas importaciones, el test se colgaba.
- **Cobertura.** El [mapa](../map.md) muestra que 129 de 199 módulos no tienen ningún test que los importe directamente. Muchos son componentes de interfaz.

## Decisión

### Tests fiables con carga

1. **Lo que simula tiempo corre con reloj falso, sin esperas reales.**
   - `save-max-wait`: de 3,5 s a 14 ms. El reloj se instala antes de hidratar el store, para que sus temporizadores usen el mismo reloj.
   - `atlas-developer`: de 5,3 s a 13 ms. Usa `onFakeClock`, que avanza el reloj simulado hasta que el trabajo termina.
   - Los temporizadores de `window` en los tests delegan en los globales, para que el reloj falso también los gobierne.
2. **Una escritura esperada se espera por su condición, no con una pausa fija** (`until` en `state-conflict`).
3. **El reloj falso se activa después de las importaciones**, nunca durante (`import-safety`).
4. **20 s de margen global** (`testTimeout` en `vite.config.ts`) para el trabajo real de CPU, y **60 s** para los dos archivos que cargan la app entera (`import-safety` y `composer-variant`). Como el tiempo simulado ya no depende del reloj real, este margen solo cubre CPU: un test colgado sigue fallando.

### Cobertura por riesgo, no por porcentaje

5. **El porcentaje de módulos con test no es la meta.** Se exige test en lo que más daño haría si fallara: dinero (precio, aprobación y umbral), datos (guardado, conflictos y copias), el flujo principal (petición → plan → aprobación → resultado) y las decisiones del usuario (contratos del [mapa](../map.md)).
6. **Siguiente paso: unas pocas pruebas de recorrido completo** en el navegador, sobre el sandbox, con el LLM y los proveedores simulados (sin gasto). Cubrirían enviar una petición, ver la tarjeta, aprobar y recibir el resultado en Chat, y pasarlo a Nodes y al Designer. Protegen al usuario de fallos de interfaz que los tests del motor no ven. La base ya existe: Playwright (`npm run stress`).

## Alternativas

- **Subir solo el tiempo de espera de los tests afectados.** No se adopta como solución única: tapa las esperas reales en vez de quitarlas, cada test que use tiempo real vuelve a fallar con carga y la suite sigue siendo lenta.
- **Limitar los procesos paralelos (`maxWorkers`).** No se adopta: hace la suite más lenta siempre, y no protege de la carga de otros programas.
- **Fijar un porcentaje mínimo de cobertura.** No se adopta: empuja a escribir tests fáciles sobre código de poco riesgo, no los que protegen al usuario.

## Consecuencias

- **Comprobado:** con 24 procesos saturando 8 núcleos (carga entre 25 y 39), 4 de 4 ejecuciones completas pasaron (967 tests). Antes, con una carga de 34, fallaban hasta 8.
- **Regla para tests nuevos:** si el comportamiento depende del tiempo, se usa reloj falso; si se espera una escritura o una respuesta, se espera por su condición; no se usan pausas fijas para dar algo por hecho.
- **Sigue abierto:** las pruebas de recorrido completo del punto 6, en [pendientes](../pendientes.md).
