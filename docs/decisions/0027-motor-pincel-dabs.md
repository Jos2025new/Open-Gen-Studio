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

## Seguimiento 2026-11-02: Tooth v2 y leadHardness

- **Tooth v2.** `applyTooth(cobertura, textura, fuerza) = max(0, cobertura − 1,5·fuerza·(1 − textura))` es la única resta y la usan los dos motores. Cápsula: igual que antes, sobre la cobertura máxima (resultado idéntico byte a byte). Dabs: los sellos se acumulan SIN tooth y la resta se aplica una vez por píxel a la cobertura acumulada al pasar el plano a la máscara RGBA (vivo, repintado y repetición). Así el 4H ya no pierde sus sellos de alfa ≈ 0,002 uno a uno y el grano solo recorta el resultado. `BrushTip.toothVersion?: 2` lo graba `tipFor` en los trazos nuevos con tooth; sin versión se conserva el escalado por sello (D45), así que los trazos viejos se repintan idénticos. Desviación D45 de «Tooth escala» resuelta para los trazos nuevos.
- **leadHardness (0–1, opcional).** Da forma a la curva presión → densidad existente con `pencilDensityCurve(p, minDensity, leadHardness) = minDensity + (1 − minDensity)·p^γ`, `γ = 0,6 + 1,6·leadHardness`. Lead blando (γ < 1) deposita más con presión baja y media; duro (γ > 1) exige más presión; extremos fijos (minDensity en p = 0, 1 en p = 1), monótona y sin saltos. Sin `leadHardness` la curva es la lineal de siempre. Solo actúa en `atPressure`: lo que se graba son las densidades por segmento (`tip.densities`), no el valor, y la repetición las lee tal cual. No se multiplica en `stampSegment` ni en los dabs. El exponente es el punto de partida propuesto; el rango 0,6–2,2 mantiene la curva razonable y se afinará en uso.
- **Presets.** 2H 0,34 · HB 0,26 · 4B 0,15, y los tres con `minDensity` 0,3 (antes 0,3 / 0,35 / 0,25, que hacía que HB depositara más que 4B a la misma presión). Opacidad y demás sin tocar; el resto de presets, intactos.
- **Fuente y límites.** Sousa y Buchanan, «Observational Models of Graphite Pencil Materials», tabla de composición del fabricante (grafito/arcilla/cera): 2H 60/34/5, HB 68/26/5, 4B 79/15/5. Los valores son índices relativos tomados de la fracción de arcilla, no medidas universales de dureza, y el estudio no publica valores calibrados de transferencia por grado. La calibración visual sigue siendo del usuario (D44).
- Pruebas: `tests/brush-graphite.test.ts` (huellas de trazos v1 tomadas antes del cambio, v2, curva, presets, acumulación entre pasadas).
