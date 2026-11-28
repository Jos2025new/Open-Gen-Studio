# Guía práctica: Kits de marca, tokens en vivo y flujo con Inkscape

Guía pensada para **usuarios nuevos** (estilo Canva), **operadores que migran diseños externos** y **agentes**. Para la ficha técnica de código y tests, ver [biblioteca-kits](features/biblioteca-kits.md).

---

## 1. Para empezar en 3 pasos (estilo Canva)

### Paso 1 · Suelta toda tu marca de una sola vez
1. Pulsa **Brand → + New** (o abre **Library → Brand kits**) para crear o abrir un kit.
2. Haz clic en la barra superior de arrastre (*«Drop `tokens.json`, fonts, logos, or photos — or click to import»*) o en el icono de importar —o **arrastra y suelta** todos tus archivos juntos sobre la portada del kit.
3. Open Gen Studio clasifica cada archivo automáticamente:
   - `*.json` (W3C Design Tokens / Penpot) → se importan, mezclan y guardan al instante en **Tokens** (también puedes importar `tokens.json` directamente dentro de **Colors** con **Import tokens.json**).
   - `.ttf`, `.otf`, `.woff`, `.woff2` → se cargan en **Fonts**.
   - Imágenes cuyo nombre incluya `logo`, `marca`, `isotipo`, `logotipo`, `wordmark` o `icono` → van a **Logos** (el resto a **Photos** o **References**).

### Paso 2 · Vincula cualquier diseño o SVG importado en 1 clic
1. Deja activo tu Brand Kit con **Use** (`In use`; un kit recién creado queda activo automáticamente si no había otro).
2. Importa un `.svg` (arrastrándolo al lienzo o desde **File → Import image / SVG**) o abre cualquier diseño en el Designer.
3. Verás una tarjeta discreta en la esquina superior derecha del lienzo indicando cuántas coincidencias hay con tu marca:
   > *«Matches "Tu Marca": X colors, Y fonts, Z radii, W widths and N logos.»* → **[Link all]**
4. También puedes pulsar **Link (N)** dentro del Brand Kit o pedírselo al agente en el chat (*«vincula este diseño a mi marca»*).
5. Todo queda en **un solo paso de deshacer (`Ctrl+Z`)**.

### Paso 3 · Cambia una vez, se actualiza todo
- **Cambiar un logo**: abre **Logos** en el kit, abre el menú de la tarjeta del logo y pulsa **Replace image**. Todos los diseños que usan ese logo actualizan sus píxeles conservando posición y ancho (ajustando la altura proporcionalmente).
- **Cambiar un token**: edita cualquier color (incluso con transparencia `#rrggbbaa`), fuente, tamaño, radio de esquina o ancho (`320px`) en **Tokens** y todos los diseños enlazados se actualizan al instante.
- **Cambiar un componente** (por ejemplo, una firma completa): edita el grupo en el documento del kit y guarda una nueva versión; todas las instancias insertadas en otros diseños se actualizan conservando su posición `(x, y)` y su `tokenMode` (si solo cambiaste un token no relacionado, las instancias no se sobrescriben).

---

## 2. Control y seguridad: aviso en esquina y modo «On demand»

- Por defecto, la sincronización es **automática** (`Settings → Data → Library → Auto-sync brand changes`).
- Cada vez que un cambio del Brand Kit actualiza tus diseños, aparece un aviso no bloqueante en la esquina superior derecha del Designer indicando **qué cambió** (mientras sigues en la sesión actual; al recargar la página el aviso se limpia), con dos botones directos:
  - **Revert**: revierte quirúrgicamente solo los valores que dejó el sync (si ya editaste una propiedad después, se respeta tu edición) y registra un paso de historial para que incluso esa reversión se pueda deshacer con `Ctrl+Z`.
  - **On demand**: cambia al modo manual. En modo manual los diseños no cambian solos; el aviso te muestra cuántos cambios pendientes hay con el botón **Update now**.

---

## 3. Flujo con Inkscape (`vigente/` + `tokens.json`)

Si trabajas también con `.svg` abiertos a mano en Inkscape:
1. En el Designer, abre **Export → formato SVG → engranaje de opciones** y activa **Link brand logos**.
2. Antes de generar el SVG, la app sincroniza la carpeta local de disco:
   - `<DATA_DIR>/brand-exports/<kit>/assets-<versionId>/` con las imágenes vigentes (todas las imágenes raster se normalizan a `.png` para que reemplazar PNG↔JPG nunca cambie el nombre ni rompa SVGs anteriores; los SVG conservan `.svg`).
   - `<DATA_DIR>/brand-exports/<kit>/tokens.json` (mezclando `marca.logo` sin pisar subárboles de usuario y conservando modos en `$extensions['ogs.modes']`).
   - `<DATA_DIR>/brand-exports/<kit>/vigente` → enlace simbólico atómico a `assets-<versionId>`.
3. Solo las capas cuyo archivo quedó verificado en disco se escriben como `href="vigente/<slug>.png"` (o `<kit>/vigente/<slug>.png` si el diseño mezcla varios kits); si falla la sincronización local o falta un blob, el logo se incrusta automáticamente en el SVG para nunca entregar un enlace roto. PDF siempre incrusta las imágenes.
4. Guarda tus `.svg` exportados dentro de `<DATA_DIR>/brand-exports/<kit>/` (junto a `vigente/`). Cuando mañana cambies un logo en OGS y pulses **Sync Inkscape** en el kit, el symlink `vigente/` apunta a la nueva versión y los `.svg` en Inkscape toman el logo nuevo al recargar o reexportar.

---

## 4. Qué pedirle a un operador externo que migra archivos a OGS

1. `tokens.json` en formato W3C Design Tokens (colores `#rrggbb` o `#rrggbbaa`, familias de fuente y dimensiones en `px`/`rem`).
2. Archivos de fuentes propias (`.ttf`, `.otf`, `.woff`, `.woff2`).
3. Variantes de logo con nombres claros que incluyan `logo` (p. ej. `logo-horizontal-oscuro.png`).
4. Archivos `.svg` base (al importarlos en Designer se vinculan con **Link all** en 1 clic).

---

## 5. Referencia rápida para agentes (`library.item.*`)

| Acción | Comando | Cuándo usarlo |
| --- | --- | --- |
| Ver kits / leer contenido | `library.item.list`, `library.item.read` | Antes de diseñar o modificar un kit. |
| Añadir activos, textos o fuentes | `library.item.add` | Llenar secciones (`Logos`, `Photos`, `Guidelines`…) o guardar fuentes adjuntas. |
| Colocar logo enlazado | `library.item.place_asset` | Colocar una imagen/logo del kit en un doc del Designer enlazado a su slot estable. |
| Reemplazar logo en el sitio | `library.item.replace_asset` | Actualizar la imagen de un slot manteniendo su `nodeId` para propagar a todos los diseños. |
| Insertar componente | `library.item.insert` | Insertar un grupo del kit recordando su origen (`from`). |
| Vincular diseño existente en 1 paso | `library.item.auto_link` | Enlazar colores, fuentes, tamaños, radios, anchos y logos de un doc/SVG ya creado. |
| Sincronizar cambios pendientes | `library.item.sync` | Propagar logos, componentes y tokens en la sesión (útil en modo manual). |
| Sincronizar carpeta Inkscape | `library.item.export_folder` | Escribir `brand-exports/<kit>/assets-<ver>/`, `tokens.json` y actualizar symlink `vigente/`. |
| Tokens `{token}` al dibujar | `designer.layer.add_text`, `designer.layer.add_shapes` | Usar `"{nombre.token}"` en `color`, `fill`, `stroke`, `fontFamily`, `fontSize`, `radius`/`rx` y `width`/`w`. |
