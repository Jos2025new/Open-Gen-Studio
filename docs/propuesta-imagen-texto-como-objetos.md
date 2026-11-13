# Propuesta: imagen y texto como objetos de la capa vectorial

Fecha: 2026-11-10. Estado: solo diseño, sin implementar. Rama: `task/export`. Sigue a [Objetos y Z](propuesta-objetos-y-profundidad.md).

## Índice

1. [Problema](#1-problema)
2. [Arquitectura A: nodos dentro de la capa](#2-arquitectura-a-nodos-dentro-de-la-capa)
3. [Arquitectura B: carpetas de capas como grupos](#3-arquitectura-b-carpetas-de-capas-como-grupos)
4. [Medidas](#4-medidas)
5. [Comparación](#5-comparación)
6. [Recomendación](#6-recomendación)
7. [Sin comprobar](#7-sin-comprobar)

## 1. Problema

Un grupo de objetos (`shape.groupId` + `ObjectGroup`) solo admite formas de una capa vectorial. Una imagen o un texto son capas enteras (`RasterLayer`, `TextLayer`): en modo Objeto se eligen como objeto con `id = layer.id`, pero no entran en un grupo con formas, y Ctrl+G entre capas (2026-11-10) los deja fuera. Las carpetas de capas (`DesignDoc.groups`, `layer.groupId`) sí mezclan tipos, pero no se exportan como `<g>` (`export.ts` no lee `groupId`) y no anidan (`LayerGroup` no tiene `parentId`).

Objetivo: grupos mixtos (forma + imagen + texto) que se muevan juntos, se vean en el panel como un árbol y exporten como `<g>` real con `<image>` y `<text>` dentro.

## 2. Arquitectura A: nodos dentro de la capa

La capa vectorial pasa a ser un contenedor SVG: su lista admite tres clases de nodo.

```ts
type LayerNode = VectorShape | ImageNode | TextNode;       // discriminado por `type`
interface ImageNode extends ObjectMeta { id; groupId?; type: 'image'; x; y; w; h; assetId; pxWidth; pxHeight; transform? }
interface TextNode  extends ObjectMeta, TextStyle { id; groupId?; type: 'text'; x; y; w; text; transform? }
```

- Grupos, orden de apilado, nombre, oculto, bloqueado, `z` y Ctrl+G entre capas funcionan sin cambios: ya operan sobre `id` y `groupId`.
- Export directo: `shapesSvgTree` ya escribe `<g>` anidado; solo necesita `<image>` y `<text>` por nodo.
- Coste: todo lo que hoy recorre `layer.shapes` como formas debe distinguir el tipo. Los píxeles de una imagen-nodo necesitan búfer propio (hoy el búfer va por `layer.id`), y pintar sobre una imagen deja de ser «pintar en su capa».
- Migración: las capas de imagen y texto existentes siguen siendo válidas; «meter en un grupo» convierte la capa en nodo. Dos representaciones de lo mismo conviven.

## 3. Arquitectura B: carpetas de capas como grupos

Imagen y texto siguen siendo capas. El grupo mixto es la carpeta de capas, que pasa a ser un grupo de verdad.

```ts
interface LayerGroup extends ObjectMeta { id; name; parentId?; collapsed?; keptHidden?; keptLocked? }   // + parentId
```

- Ctrl+G con una selección mixta crea una carpeta con las capas implicadas (las formas elegidas se separan antes a una capa propia si su capa tiene más formas).
- Export: las capas contiguas de una carpeta se envuelven en `<g inkscape:label>`; dentro, cada capa sigue siendo su `<g inkscape:groupmode="layer">` (o un `<g>` plano, a decidir).
- Hace falta garantizar que los miembros de una carpeta sean contiguos en `doc.layers`: hoy `groupLayers` los junta, pero `moveLayer` y `reorderLayer` intercambian sin mirar carpetas.
- No toca render, búferes, pintura ni hit test: todo sigue capa a capa.
- Límite: una forma no puede intercalarse entre dos formas de otra capa sin partir esa capa; el árbol de objetos tiene dos niveles de naturaleza distinta (carpeta de capas / grupo de formas).

## 4. Medidas

Tomadas el 2026-11-10 sobre el árbol de trabajo de `task/export`.

| Medida | A | B |
| --- | --- | --- |
| Errores de `tsc` al cambiar solo el tipo (sonda, revertida) | 143 en 37 archivos (97 en `src`, 46 en tests) | 0 (campo opcional nuevo) |
| Sitios que leen `.shapes` | 119 en 43 archivos, todos a revisar | no cambian |
| Sitios que distinguen `type === 'raster'` / `'text'` | 77 / 21: siguen, y se duplican para el nodo | no cambian |
| Archivos que leen carpetas (`layer.groupId`, `doc.groups`) | no cambian | 11 |
| Export | `<image>`/`<text>` por nodo en `shapesSvgTree` | envolver tramos en `export.ts` (hoy 0 lecturas de `groupId`) |
| Búferes de píxeles | por nodo: nuevo | por capa: igual |
| Zonas protegidas (`docs/persistencia-protegida.md`) | serialización de capas: sí | un campo opcional: mínimo |

Sonda de A: `VectorLayer.shapes` como unión de forma, imagen y texto, `npx tsc --noEmit`, y vuelta atrás. Los archivos con más errores: `objectGroupTree.ts` (13), `render.ts` (9), `transform.ts` (9), `LayersPanel.tsx` (7). La cifra mide solo lo que el compilador ve; render, hit test y export de los nodos nuevos son trabajo aparte.

## 5. Comparación

| Criterio | A | B |
| --- | --- | --- |
| Grupo mixto con orden libre entre formas, imágenes y texto | sí | solo entre capas |
| Un solo árbol en el panel | sí | dos niveles distintos |
| SVG de ida y vuelta con Inkscape | fiel | fiel si las carpetas son contiguas |
| Riesgo para datos y pintura | alto: búferes y serialización | bajo |
| Base para Z por objeto | directa (el nodo lleva `z`) | `z` en la capa (ya existe en `LayerBase`) |
| Tamaño | grande, varias fases | pequeño |

## 6. Recomendación

B primero, A después y solo si hace falta.

1. **B**: `parentId` en `LayerGroup`, contigüidad garantizada al reordenar, Ctrl+G mixto crea carpeta, export de carpetas como `<g>`. Da grupos mixtos y `<g>` real sin tocar render ni datos.
2. Vivir con ello. Si el límite («no puedo intercalar una imagen entre dos formas del mismo grupo») molesta en uso real, abordar **A** como proyecto propio, con el modelo de nodos de la propuesta de Z, empezando por el texto (no tiene búfer).

Decisiones que tocan al usuario: si las capas dentro de una carpeta exportan como capa de Inkscape o como `<g>` plano; y si Ctrl+G mixto debe separar las formas a una capa propia sin preguntar.

## 7. Sin comprobar

- Cómo lee Inkscape un `<g>` normal que contiene `<g inkscape:groupmode="layer">` (capas dentro de grupo).
- Coste de render de A con muchos nodos de imagen en una capa.
- PDF: sigue plano en ambas (punto 5 del diagnóstico).
