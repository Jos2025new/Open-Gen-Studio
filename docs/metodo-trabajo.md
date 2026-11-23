# Método de trabajo con agentes

Fecha: 2026-10-31. Estado: **en prueba** (principio 0). Origen: retrospectiva de las sesiones del 2026-09-19 al 2026-10-31, acordada con el usuario.

## Principio 0: lo que se comprueba se queda

Cada regla, check o plantilla de este documento es una hipótesis. Lo que demuestra servir se queda; lo que estorba se ajusta, se quita o se sustituye, también sobre la marcha.

- Un check nuevo empieza en «prueba»: avisa y no bloquea. Bloquea solo cuando el usuario lo marca «confirmada».
- Lo nacido de incidentes reales (pérdida de datos, gasto no autorizado) ya está confirmado: ver [persistencia protegida](persistencia-protegida.md) y ADR 0004.
- Cuando una regla atrapa algo real o estorba, el agente añade una línea a [Observaciones](#observaciones), sin preguntar.
- Al cerrar cada fase, el agente propone con esa evidencia qué se queda, cambia o se quita. Decide el usuario. Lo retirado se anota con su motivo.

## Carriles

El agente clasifica la petición y lo anuncia en una línea al empezar. Pregunta solo si es ambiguo de verdad.

| Carril | Qué entra | Cómo se trabaja |
|---|---|---|
| **Rápido** | Ajustes y pruebas de GUI, textos, bugs con causa clara | Sin specs ni preguntas: se implementa, el usuario prueba, se ajusta, se acepta o se descarta. |
| **Estructura** | Rediseños de layout, toolbox, reorganizaciones | Las funciones pueden moverse, recolocarse o ampliarse; **nunca desaparecer ni romperse**. |
| **Delicado** | Dinero, proveedores, zonas protegidas, flujo de producción de un área, reemplazar una decisión firme | Documento de feature con criterios de aceptación, y revisión antes de darlo por hecho. |

**Identidad compartida en todos los carriles.** Botones, sliders, popovers, colores y radios salen de los componentes y tokens compartidos. Cambiar el estilo compartido se hace en un solo sitio. Lo radicalmente nuevo y los experimentos de estilo quedan fuera solo cuando el usuario lo dice.

**Decisión firme:** un ADR «Aceptado» con fundamento. Reemplazarlo exige la palabra explícita del usuario y un ADR que diga «Sustituye a NNNN». Lo dicho de pasada en el chat no ata.

## Orquestación: no repetir (sesión 8, [historial 076](history/076-2026-11-W47-master-dinero-dplus.md))

Valen para quien orquesta y para cada worker:

1. **Parar a las 2 rondas:** si el 2.º ataque halla un crítico de la misma causa o no bajan los hallazgos, nada de 3.er parche: auditoría de diseño.
2. **Fusionar lo verde al momento:** con `npm test` verde y reataque limpio se pide el sí enseguida; como mucho una rama lista en cola.
3. **Techo de piloto:** declarar antes el tope de archivos y líneas netas en `src/` y qué se borra; si crece sin borrar, frenar.
4. **`npm test` temprano y una vez:** tras la 1.ª implementación; ante fallos puntuales se repiten solo esos archivos, no la suite.
5. **Comprobar que cada worker arrancó** (cuota, memoria, timeout); el informe se abre antes de editar y todo veredicto lleva `archivo:línea`, también «de acuerdo».
6. **Roles:** Neon, Sol y Opus diseñan y arreglan causas; Hydrogen y Haiku atacan y prueban el sandbox.
7. **Estado al usuario:** cada parte abre con `Objetivo | En main | Listo sin fusionar | Bloqueo | Siguiente`.

## Checks en prueba

| ID | Script | Qué comprueba | Estado |
|---|---|---|---|
| G1 | `scripts/check-gui.mjs` | Ningún `type="range"` fuera de `InlineSlider` | prueba |
| G2 | `scripts/check-gui.mjs` | Ningún `confirm`/`alert`/`prompt` nativo | prueba |
| F1 | `scripts/check-functions.mjs` | Cada etiqueta de control (`aria-label`, `title`) de la línea base sigue existiendo en `src/` | prueba |

Los checks miran estructura, nunca píxeles: cambiar un estilo no obliga a reescribir tests. F1 deja pasar los movimientos y avisa si una etiqueta falta. Tras una eliminación o un cambio de nombre aprobados por el usuario, `node scripts/check-functions.mjs --update` actualiza la línea base. Las excepciones de G1 y G2 (`allow`) solo se añaden si el usuario lo pide.

## Documento de feature (carril delicado)

Un archivo por feature con: objetivo; problema; alcance y archivos; qué no hacer y sobreingeniería prohibida; tareas; criterios de aceptación como escenarios; checks; lo que ya fallaba antes; progreso; evidencia.

## Evidencia y revisión

- Evidencia = comando + resultado + commit. Si los archivos del alcance cambian después, la evidencia caduca.
- La revisa quien esté disponible: subagentes en contexto limpio por defecto, y GPT u otro auditor cuando el usuario lo diga. El encargo es siempre el mismo (modelo: [encargo al auditor externo](audits/encargo-auditor-externo.md)). Nunca se espera a un auditor que no está.

## Pendientes, de aquí en adelante

Uno general, uno por área y un índice que enlaza todo. Cada ítem vive en un solo sitio con su ID; los demás lo enlazan. Si dos sitios se contradicen, decide el usuario. Los archivos viejos quedan como están hasta una migración aprobada.

## Observaciones

| Fecha | Regla | Qué pasó | Señal |
|---|---|---|---|
| 2026-10-31 | G1 | Primera ejecución: 2 sliders en `ColorChannels.tsx` (34, 41), pistas con degradado de canal | por decidir: ¿excepción o `InlineSlider`? |
| 2026-10-31 | F1 | Línea base: 234 etiquetas | — |
| 2026-11-21 | AGENTS 4 (`test:related` tras cada cambio) | Con la máquina cargada tarda 13–24 min; Hydrogen murió dos veces esperándolo sin commit | Workers: vitest dirigido + `tsc` + `npm run check`; `test:related`/`npm test` una vez al integrar |
| 2026-11-21 | Delicado / dos lados del contrato | Salidas por nombre implementadas solo en lectura; `connect` guardaba `out` y un puerto retirado caía en silencio a `out` (GPT, antes de fusionar) | Todo brief de contrato: tabla escritura↔lectura↔persistencia, ciclo de vida del puerto y consumidor real en la misma tanda |
| 2026-11-21 | AGENTS 2 (evidencia del caso) | El orquestador resumió a Haiku de memoria (Y en Nodes en vez de X en omnicanvas) y dio una rama por lista sin sandbox | Leer el informe completo del bus; un fallo visto en pantalla se re-prueba en sandbox antes de «listo» |
