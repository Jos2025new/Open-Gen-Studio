# Open Gen Studio

Estudio de generación de imagen y vídeo con IA que corre en tu navegador. Un agente convierte peticiones en planes ejecutables, y puedes trabajar en tres espacios: **Chat**, **Node** (flujos de nodos conectados) y **Designer** (capas raster, vectoriales y de texto).

Usa tus propias claves de **OpenRouter, fal.ai, NanoGPT y Atlas Cloud**. Incluye además modelos demo locales para probarla sin claves.

## Qué hace

- **Agente**: planifica y ejecuta trabajos de varios pasos. Muestra el coste antes de gastar y pide aprobación. Modos Auto y Guiado; tiers de modelo Normal y Top.
- **Generación**: imagen y vídeo con modelos de cada proveedor, leyendo en vivo sus catálogos y parámetros.
- **Herramientas sobre resultados**: Relight, cambio de ángulo, upscale, quitar fondo, reframe/panorama, Nine-grid, Grid-split, animar, continuar plano, extraer fotograma, Sketch (pintar encima), y upscale y edición de vídeo. Cuando varios proveedores ofrecen lo mismo, elige automáticamente uno disponible.
- **Canvas de nodos**: tarjetas centradas en el resultado, prompt y ajustes bajo el nodo, menús con clic derecho.
- **Presupuesto y saldo**: límite de gasto en USD y saldo unificado de los proveedores conectados.

## Requisitos

- Node.js 22 (probado con 22.23).
- Claves de los proveedores que quieras usar (opcional: sin claves funcionan los modelos demo).

## Uso

```bash
npm install
npm run dev
```

Abre <http://localhost:5173> y añade tus claves en **Ajustes** (icono de engranaje).

Otros comandos: `npm test` (tests), `npm run typecheck`, `npm run build` y `npm run preview` (sirve la versión compilada).

## Dónde quedan tus datos

La app **no tiene backend**: se ejecuta en el navegador. Mientras corre `npm run dev` o `npm run preview`, el servidor local guarda además una copia en la carpeta **`data/`** del proyecto:

- `data/state.json`: sesiones, ajustes y generaciones. **Incluye tus claves** en texto plano (permisos solo para tu usuario).
- `data/asset/`: tus imágenes y vídeos como archivos normales.
- `data/raster/`: capas del Designer.

Si se borra el almacenamiento del navegador, al recargar todo se recupera desde `data/`. Para hacer una copia de seguridad basta con copiar esa carpeta. "Wipe all data" (en Ajustes) no borra la copia: la mueve a `data.bak-<fecha>`.

`data/` está excluida de git. No la subas a ningún sitio: contiene tus claves.

## Limitaciones conocidas

- **Pensada para uso local.** Publicada como web estática perdería la copia en disco y las rutas auxiliares `/x/*` (esquemas de fal y Atlas, descarga de resultados de Atlas). Las opciones de despliegue están en [`PROPUESTAS.md`](PROPUESTAS.md).
- **Claves en el navegador**: las llamadas a proveedores salen directamente desde él.
- **Costes de Atlas**: se muestran como mínimo (`≥`), porque el proveedor solo publica su tramo más barato.
- **Vídeos de entrada grandes**: fal y NanoGPT los reciben como data URL y pueden superar su tamaño máximo de petición.

## Stack

React 19, Vite 8, TypeScript, zustand, @xyflow/react, IndexedDB (idb-keyval), zod, Vitest.

## Documentación del proyecto

- [`PROGRESS.md`](PROGRESS.md): estado actual y registro de cambios con sus razones.
- [`AGENTS.md`](AGENTS.md): guía para agentes y plan paso a paso de cada tarea.
- [`PROPUESTAS.md`](PROPUESTAS.md): ideas en discusión (despliegue, acceso, herramientas pendientes).

## Licencia

[Apache License 2.0](LICENSE). Cualquiera puede usar, modificar y distribuir la app, también con fines comerciales, siempre que conserve el aviso de copyright y el archivo [`NOTICE`](NOTICE) con la atribución al autor e indique los cambios que haga. La licencia no da derecho a usar el nombre del proyecto ni del autor para promocionar derivados.

Copyright 2026 Samuel.
