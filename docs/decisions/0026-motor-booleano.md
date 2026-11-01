# 0026 — Motor de booleanas y de corte por área: Clipper2 (clipper2-ts), con ajuste de curvas propio

## Estado

Aceptado

Implementado en `task/gui-compact` (commits `a341e124`, `5778b426`, `f26a5ecd`, `015eb834`, `d2ba3496`), sin fusionar. Sin verificar en pantalla: lo prueba el usuario en el sandbox. La licencia BSL-1.0 la aprobó el usuario el 2026-11-01.

## Fecha

2026-11-01

## Contexto

El Designer necesitaba unir, restar, intersecar y excluir formas; cortar y borrar sobre el área de un trazo cerrado con relleno (como el borrador en modo corte de Inkscape o el cuchillo de Illustrator); y un constructor de formas (Shape Builder). Hacerlo a mano con geometría de polígonos da huecos de un píxel, agujeros mal asignados y resultados con miles de segmentos.

Antes de elegir, la investigación comparó Clipper2, PolyBool v2, polygon-clipping, Paper.js y Skia PathOps. Esa investigación no tiene documento en el repositorio, así que aquí consta la decisión y sus razones verificables en el código, no las puntuaciones de la comparación.

Las ideas de estructura vienen de vectorcraft (MIT OR Apache-2.0): el corte con banda estrecha, el borrador con banda, el overlay incremental de caras y el ajuste posterior. Se siguen como ideas; no se copió código. Inkscape y Illustrator son referencias de comportamiento.

## Decisión

- **Motor de booleanas:** `clipper2-ts` 2.0.1-18 (port de Clipper2 de Angus Johnson), dependencia de `package.json`. Se usa en `src/engine/design/pathBoolean.ts`.
- **Rejilla entera:** las curvas se aplanan con tolerancia de 0,1 px y se pasan a una rejilla entera de 1000 unidades por píxel. El resultado es exacto y no deja líneas de un píxel entre piezas.
- **Huecos:** Clipper2 devuelve un árbol (`PolyTree`); cada contorno exterior va con sus agujeros, y la regla de relleno de la forma se respeta.
- **Vuelta a curvas:** el resultado se reajusta con curvas cúbicas por el algoritmo de Schneider (1990), en `src/engine/design/curveFit.ts`, con las esquinas conservadas como esquinas. Así un resultado es unas pocas curvas y no cientos de segmentos.
- **Cortes y borrado por área:** la misma canalización. El cuchillo es una banda de 0,05 px; el borrador, un trazo redondeado de radio real aplicado al soltar.
- **Licencia:** BSL-1.0 (Boost Software License). Es permisiva: no obliga a publicar el código propio y pide conservar el aviso solo en las copias de fuente del paquete. El aviso del paquete debe conservarse en copias de fuente; no hace falta reproducirlo en binarios. Aprobada por el usuario el 2026-11-01.

## Alternativas

- **PolyBool v2, polygon-clipping, Paper.js y Skia PathOps:** compararon en la investigación y no se eligieron. El repositorio no guarda la razón de cada descarte, así que no se inventa aquí. Lo que sí consta es el criterio que cumple Clipper2 y que el código usa: aritmética entera exacta, árbol de contornos con agujeros y una sola dependencia.

## Consecuencias

- Una dependencia nueva (`clipper2-ts`, con su entrada en `package-lock.json`). Su licencia BSL-1.0 queda aprobada; si cambia la versión, revisar el aviso.
- Las operaciones devuelven curvas reajustadas: el resultado no es exacto al píxel de la curva original, sino dentro de la tolerancia de reajuste (0,25 px por defecto).
- Hay límites de coste: más de 64 áreas, o demasiados vértices o caras, dan «demasiado complejo» en vez de bloquear la app (`pathBoolean.ts:30-32`).
- Pruebas: `tests/path-boolean.test.ts`, `tests/curve-fit.test.ts`, `tests/shape-boolean.test.ts`, `tests/path-area-tools.test.ts`. El gesto real del puntero no está probado: la prueba visual la hace el usuario en el sandbox.
- Detalle de uso: [booleanas](../designer-controles/booleanas.md) y [nodos-modos](../designer-controles/nodos-modos.md).

## Actualización (2026-11-01): reconstrucción exacta con etiquetas Z

La decisión de motor no cambia. Cambia la vuelta a curvas de Union, Subtract, Intersect, Exclude y Fix overlaps (`157985f1`, `src/engine/design/exactRebuild.ts`).

- **Etiquetas en Z:** cada punto del polígono aplanado guarda en Z el tramo de origen y su `t`. Clipper conserva la etiqueta al pasar por el punto y avisa de cada cruce con las etiquetas de los dos tramos.
- **Curvas originales:** los puntos seguidos de un mismo tramo se vuelven un subtramo exacto de la curva original (de Casteljau). Las rectas siguen siendo rectas.
- **Nodos nuevos:** solo los cruces, afinados con Newton. Las curvas que no se tocan quedan iguales; esto sustituye la frase de «Consecuencias» sobre el reajuste dentro de tolerancia para esas operaciones.
- **Respaldo:** un punto sin etiqueta se reajusta desde su polilínea con Schneider. El resultado nunca falla.
- **Alcance:** cuchillo y borrado por área siguen con el reajuste aproximado.
- **En corrección:** un único cúbico que se cierra sobre sí mismo, los T-junctions y la guarda de trazados grandes (pendiente D43 en [pendientes-designer](../pendientes-designer.md)).

Detalle de uso: [booleanas](../designer-controles/booleanas.md), sección «Reconstrucción exacta de curvas».
