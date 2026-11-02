# 0027 — Motor del pincel raster: cápsula de cobertura máxima y modo dabs (estilo MyPaint)

## Estado

Aceptado

Implementado en `task/gui-compact` (`2ff0d640` bordes vivos, `c2202b4c` modo dabs), sin fusionar. Pruebas automáticas hechas; el usuario vio los presets, Tooth, Edge y dabs en el sandbox y los juzgó un gran avance. La precisión física de los presets sigue sin calibrar (D44).

## Fecha

2026-11-01

## Contexto

El pincel raster pinta cada segmento como una cápsula y se queda con la cobertura **máxima** por píxel (`stampSegment`, `brushEngine.ts`). Eso da trazos limpios y baratos, pero un lápiz de verdad se acumula: pasar dos veces oscurece, el 4H es casi invisible por pasada y el borde del grafito es irregular. Se estudiaron los pinceles de lápiz y acrílico de MyPaint (`deevad`, `tanda`, `ramon`, `classic`) y el algoritmo de libmypaint. Krita y los demás programas no aportaron valores numéricos verificables, solo descripciones cualitativas.

## Decisión

- **Dos motores, elegidos por el trazo.** Sin `tip.dabs` el trazo usa la cápsula de siempre; con `tip.dabs` pasa por `brushDabs.ts`. Los campos nuevos de `BrushTip` (`tooth`, `edge`, `dabs`) son opcionales y solo se graban si están activos (`tipFor`): los trazos guardados antes se repintan igual (compatibilidad por puerta de campos opcionales, sin migrar datos).
- **Fase 1, bordes vivos en la cápsula.** *Tooth*: la textura **resta** cobertura (como el Subtract de Krita), así los trazos suaves solo toman las crestas del papel. *Graphite*: textura de grano propia. *Edge*: el radio del borde ondula con ruido fijo por píxel.
- **Dabs:** el trazo es una fila de sellos pequeños cada `spacing` del radio, cada uno con dispersión (*Scatter*), tamaño (*Size jitter*) y ángulo (*Angle jitter*) propios y un `flow` por sello. Presets: «2B dabs», «4H dabs» y «Acrylic».
- **Se acumulan, no se maximizan.** Cada sello se compone en un plano `Float32Array` con src-over (a' = a + (1 − a)·w). Se eligió Float32 porque un 4H tiene sellos de alfa ≈ 0,002, por debajo de 1/255: una máscara de 8 bits los perdería y el lápiz claro saldría vacío. Se cuantiza a la máscara RGBA solo al escribir.
- **Determinismo, en vivo = repetición.** Nada usa `Math.random` ni un generador con estado compartido. El ruido es un hash de contador de (semilla, índice de sello, canal); la semilla se genera una vez al empezar el trazo y se guarda en `tip.dabs.seed`. Las posiciones se calculan en píxeles de la capa (el origen del búfer en vivo solo elige la celda que se escribe). El vivo, la repetición y el repintado del remate final pliegan los mismos segmentos por el mismo recorredor, así que dan máscaras idénticas.
- **Acotado.** La variable gaussiana es la suma de tres uniformes, limitada a ±3, para que el margen de las cajas sucias sea exacto. El plano cubre la caja del trazo más 48 px de holgura para no copiar en cada movimiento.

## Alternativas

- **Cápsula con más ruido, sin acumulación:** descartada para el lápiz claro, no puede dar sellos por debajo de 1/255 ni oscurecer al repasar.
- **Máscara de 8 bits con dabs:** descartada, rompe el 4H y el 2B suaves.
- **Importar `.myb` o paridad con libmypaint (smudge, entradas de velocidad, seguimiento lento, pigmento):** fuera de alcance; el smudge exigiría leer la capa.
- **Generador con estado (semilla 1000 como MyPaint):** descartado, el vivo y la repetición divergirían al segmentar distinto.

## Consecuencias

- Rendimiento medido en las pruebas: un trazo de 1000 px tarda unos 3 ms con radio 3 y unos 21 ms con radio 60.
- Desviaciones conocidas de MyPaint (pendiente D45): el espaciado no se mide en el marco elíptico, Tooth escala el sello en vez de restar, no hay linealización de la opacidad y el plano es la caja del trazo + 48 px.
- Los dabs ensanchan el alcance de las cajas sucias (dispersión y variación de tamaño); `segmentBox` y el relleno de `raster.ts` deben seguir contándolo.
- `raster.ts` ronda los 30 000 bytes (D46): el próximo cambio ahí va a otro archivo.
- Pruebas: `tests/brush-dabs.test.ts` (vivo = repetición con segmentaciones distintas, acumulación, semilla), `tests/brush-living-edge.test.ts`, `tests/brush-presets.test.ts`.
- Detalle de uso: [pincel](../designer-controles/pincel.md) y [pincel-avanzado](../designer-controles/pincel-avanzado.md).
