# Open Gen Studio

**Un estudio creativo con IA que corre en tu ordenador.** Le dices lo que quieres, una foto de producto, la hoja de un personaje, un vídeo corto o un póster, y un agente lo convierte en un plan: qué se va a generar, con qué modelo y cuánto cuesta. Tú lo apruebas y la app lo ejecuta.

Imagen, vídeo, música, voz, efectos de sonido y 3D, con tus propias claves de **OpenRouter, fal.ai, NanoGPT y Atlas Cloud**. Sin claves también arranca: trae modelos de demostración para conocerla gratis.

---

## Empezar en tres pasos

```bash
npm install
npm run dev
```

1. Abre <http://localhost:5173>.
2. En **Settings** (el engranaje), pega la clave de al menos un proveedor.
3. Escribe en el cuadro de abajo lo que quieres crear y pulsa **Enter**.

Necesitas Node.js 22.

---

## Tres espacios, una misma sesión

Cada sesión tiene tres lienzos. Pasas de uno a otro sin perder nada, y el agente sabe lo que hiciste en los demás.

| Espacio | Para qué sirve |
| --- | --- |
| **Chat** | Conversar con el agente. Ves sus preguntas, el plan, el coste y los resultados como tarjetas. |
| **Node** | Ver el trabajo como un flujo de tarjetas conectadas: cambiar un ajuste, volver a ejecutar un paso, ramificar. Cada nodo guarda sus propios ajustes. |
| **Designer** | Componer con capas raster, vectoriales y de texto, y con capas de filtros y efectos no destructivas (botón FX). Exporta en PNG, JPG, SVG o PDF. |

Puedes pedirle al agente que se mueva por ti: «llévalo a nodos», «mándalo al Designer», «vuelve al chat». Los resultados viajan contigo y no se generan de nuevo.

---

## El agente, en tres modos

Eliges el modo junto al cuadro de texto. Cambia cuánto te pregunta, nunca lo que se gasta sin tu permiso.

| Modo | Cómo trabaja | Cuándo usarlo |
| --- | --- | --- |
| **Auto** | Decide por ti. Solo pregunta si falta algo que cambia el resultado, como la foto de tu producto. Confirma el modelo una vez por sesión. | El día a día. |
| **Guided** | Siempre te hace unas preguntas antes del plan y te ofrece opciones creativas. Confirmas los ajustes en cada petición. | Cuando quieres decidir los detalles. |
| **Direct** | No pregunta nada: usa los modelos que elegiste en el selector. Lo único que apruebas es el plan. | Cuando ya sabes exactamente qué quieres. |

### Cómo avanza una petición

```
Tu mensaje
  → preguntas (solo si falta algo tuyo: tu producto, tu personaje, tu texto)
  → tarjeta de ajustes (modelo, resolución, duración, formato)
  → plan con su coste
  → apruebas
  → resultados
```

**El dinero nunca se gasta solo.** Todo plan con coste espera tu aprobación, también en Auto. Ajustas un límite de gasto en Settings, y si un paso se va a encarecer antes de enviarse, la app se detiene y te pregunta.

---

## Herramientas sobre tus resultados

Sobre cualquier imagen o vídeo puedes pedir, con palabras o desde el menú, una de estas operaciones. Las que dicen «gratis, local» no llaman a ningún proveedor. Si pides algo que una herramienta no alcanza, por ejemplo 8K con upscale, la tarjeta del plan te lo dice antes de aprobar.

<!-- tools:start -->
| Herramienta | De → a | Qué hace |
| --- | --- | --- |
| Relight | imagen → imagen | Cambia la luz y conserva el sujeto. |
| Change angle | imagen → imagen | La misma escena vista desde otra cámara: de frente, de perfil, desde arriba… |
| Upscale | imagen → imagen | Más resolución y más detalle (×2 o ×4). |
| Remove background | imagen → imagen | Recorta el sujeto sobre fondo transparente. |
| Reframe | imagen → imagen | Amplía la escena a otro formato: vertical, cuadrado, panorámico. |
| Reference sheet | imagen → imagen | Hoja de referencia de un personaje u objeto (vistas, expresiones o vestuario) para mantenerlo igual después. |
| Variations | imagen → imagen | Otras versiones con el mismo sujeto y estilo. |
| Edit with prompt | imagen → imagen | Describe el cambio y se aplica a la imagen. |
| Animate | imagen → vídeo | Convierte la imagen en un vídeo. |
| Extract frame | vídeo → imagen · gratis, local | Guarda un fotograma del vídeo como imagen. |
| Continue shot | vídeo → vídeo | Un clip nuevo que arranca donde terminó el anterior. |
| Contact sheet | imagen → imagen | Hoja de contacto: la misma escena desde 9 o 6 ángulos. |
| Grid-split | imagen → imagen · gratis, local | Corta una imagen en cuadrícula en imágenes sueltas. |
| Join clips | vídeo → vídeo · gratis, local | Une clips en un solo vídeo, con música de fondo si quieres. |
| Upscale video | vídeo → vídeo | Más resolución y detalle para un clip. |
| Edit video | vídeo → vídeo | Describe un cambio y se aplica a todo el clip. |
| Extend video | vídeo → vídeo | Alarga el clip con acción nueva. |
| Edit region | imagen → imagen | Pinta una zona y cambia solo esa parte. |
| Remove object | imagen → imagen | Pinta un objeto y desaparece; el fondo se rellena. |
| Create Kling voice | audio → texto | Crea una voz reutilizable a partir de 5–30 s de habla limpia. |
| Transcribe | audio → texto | Convierte una grabación de voz en texto. |
| Filters & effects | imagen → imagen · gratis, local | Un filtro (brillo, saturación, tono, blanco y negro, desenfoque…) o un efecto (glow, sombra, destello) en una imagen nueva; en el Designer son capas FX editables. |
<!-- tools:end -->

## Flujos listos

Encargos completos que el agente sabe organizar paso a paso. Pídelos con tus palabras («hazme un tour de esta casa») o elígelos en el compositor.

<!-- flows:start -->
| Flujo | Qué produce |
| --- | --- |
| Image → Video | Diseña la imagen clave y después la anima. |
| Product photoshoot | Sesión de producto: principal, en uso, detalle y características; o un formato concreto (packshot, banner, carrusel, anuncios, try-on, CGI). |
| Character sheet | Vistas de un personaje, sueltas o en una hoja. |
| Storyboard · 4 shots | Cuatro fotogramas seguidos de una escena. |
| Social format set | Una imagen adaptada a 1:1, 4:5 y 9:16. |
| UGC video | Vídeo vertical estilo creador: reseña, unboxing, prueba o tutorial. |
| Shot sequence | Imagen clave, un primer clip y su continuación. |
| Story / series | Una historia corta o un episodio con un personaje que se repite, unido en un vídeo. |
| Archviz render | Renders de arquitectura: una vista principal o varias del mismo edificio. |
| Archviz walkthrough | Un render convertido en recorrido de cámara. |
| Archviz tour | Tour completo de una propiedad: un clip por vista, unidos con música opcional. |
| Sketch to render | De boceto, maqueta o plano a render fotorrealista que respeta el diseño. |
| Poster layout | Póster por capas: fondo, titular y acentos editables. |
<!-- flows:end -->

## Voz y efectos de sonido

En el modo **Audio** del compositor, o pidiéndoselo al agente:

- **Voz:** escribe exactamente lo que se dice. Elige la voz y, con Gemini o GPT-4o mini, describe el tono en **Delivery** («cálida, pausada»). Si no eliges modelo, se usa **Gemini 3.8 Flash TTS**, uno de los mejor valorados, a 0,05 USD por cada 1000 caracteres. También están GPT-4o mini TTS (el más barato), ElevenLabs v4 y MiniMax Speech 2.8.
- **Efectos:** describe el sonido («olas suaves en la orilla»). Se usa **ElevenLabs Sound Effects v2**. Como la duración la decide el modelo, el coste se presupuesta a su máximo, 22 s.

Funcionan con una clave de **NanoGPT**. La música sigue con MiniMax en Atlas Cloud.

## Tus personajes y productos, siempre iguales

Guarda un personaje, un producto o un lugar en la **biblioteca** con un nombre y llámalo con `@Nombre` en cualquier sesión. La app envía su imagen a cada paso que lo menciona, para que no cambie de un plano a otro. Una imagen que solo usas como referencia no se guarda en la biblioteca si no lo pides.

---

## Atajos de teclado

También están en **Settings → Shortcuts**. «Mod» es Ctrl, o ⌘ en Mac. Mientras escribes en un campo, los atajos no se activan.

<!-- shortcuts:start -->
**Testing**

| Teclas | Acción |
| --- | --- |
| Mod + Alt + P | Start or stop a performance trace (logs/trace-…jsonl) |

**Prompt and chat**

| Teclas | Acción |
| --- | --- |
| Enter | Send or generate |
| Shift + Enter | New line |

**Viewer**

| Teclas | Acción |
| --- | --- |
| ← → | Previous / next result |
| Esc | Close |

**Nodes**

| Teclas | Acción |
| --- | --- |
| Mod + Z | Undo |
| Mod + Y | Redo (also Mod + Shift + Z) |
| Mod + C / X / V | Copy, cut, paste nodes (paste also takes images) |
| Mod + G | Group the selected nodes |
| Mod + Shift + G | Ungroup |
| Delete or Backspace | Delete the selection |

**Designer**

| Teclas | Acción |
| --- | --- |
| V | Edit |
| H | Pan |
| M | Select pixels |
| I | Eyedropper |
| B | Brush |
| G | Fill |
| U | Gradient |
| P | Lineart |
| E | Eraser |
| R | Rectangle |
| O | Ellipse |
| L | Line |
| T | Text |
| K | Ruler |
| Space (hold) | Pan |
| Alt-click (Brush, Fill) | Pick a color from the canvas |
| Ctrl+A / Ctrl+D | Select all pixels / deselect |
| Ctrl+Shift+I | Invert the selection |
| Ctrl+J | Selected pixels to a new layer |
| Ctrl+G | Group the selected layers |
| Shift+R | Show or hide rulers and guides |
| Delete (with a selection) | Erase the selected pixels |
| Mod + Z | Undo |
| Mod + Shift + Z | Redo |
| Delete | Delete the active layer |
| Mod + C / V | Copy a layer's pixels, paste images |
| Alt (while moving) | Move without snapping |
| Alt + drag (Lineart) | Bend a stroke |

**Sketch**

| Teclas | Acción |
| --- | --- |
| Mod + Z | Undo |
| Mod + Shift + Z | Redo |
| Esc | Close |
<!-- shortcuts:end -->

---

## Dónde quedan tus datos

La app se ejecuta en tu navegador. Mientras corre `npm run dev`, el servidor local guarda además una copia en la carpeta **`data/`**:

- `data/state.json`: sesiones, ajustes y generaciones. **Incluye tus claves**, así que no la compartas.
- `data/asset/`: tus imágenes y vídeos como archivos normales.
- `data/raster/`: las capas del Designer.

Si borras el almacenamiento del navegador, todo vuelve desde `data/` al recargar. Para hacer una copia de seguridad, copia esa carpeta, o descárgala desde **Settings → Download all as ZIP** (sale sin tus claves). «Wipe all data» no la borra: la aparta como `data.bak-<fecha>`. La app también guarda copias automáticas y rechaza un guardado que perdería de golpe gran parte de tus sesiones.

`data/` está fuera de git.

---

## Probar sin tocar tus datos

```bash
npm run dev:sandbox
```

Arranca una copia aislada en <http://localhost:5183> con su propia carpeta, `.sandbox/data`. Es el lugar para probar cambios y automatizaciones: lo que pase ahí no llega a tus sesiones reales.

---

## Para quien lee o cambia el código

| Comando | Qué hace |
| --- | --- |
| `npm test` | Salvaguardas, documentación, tamaños, mapa del código y la suite completa. |
| `npm run test:related` | Solo los tests que alcanzan los archivos que cambiaste. |
| `npm run typecheck` | Comprueba los tipos. |
| `npm run build` | Compila; `npm run preview` sirve la versión compilada. |

Por dónde empezar:

- [**Mapa del código**](docs/map.md): qué depende de qué y qué lugares deben decir lo mismo. Léelo antes de cambiar nada.
- [**Documentación**](docs/README.md): cada función con su código y su test, las decisiones tomadas y el historial.
- [**AGENTS.md**](AGENTS.md): las reglas para agentes de IA que trabajan en este repositorio.

Hecho con React 19, Vite, TypeScript, zustand, @xyflow/react, IndexedDB, zod y Vitest.

## Seguridad, en corto

- **Tus claves están en texto plano** en `data/state.json` y en el navegador. Es tu ordenador: no compartas esa carpeta.
- **Otra web que visites no puede leer ni borrar tus datos**, y con `--host` ningún otro dispositivo de tu red puede tocarlos: el almacén solo responde a tu propio ordenador.
- El detalle, con la prueba de cada punto, está en [docs/seguridad.md](docs/seguridad.md).

## Limitaciones conocidas

- **Pensada para uso local y para una sola persona.** No tiene usuarios ni contraseña; publicada como web estática perdería la copia en disco y las rutas auxiliares `/x/*`.
- **Precios de Atlas Cloud:** antes de generar, la app pide a Atlas el precio exacto de esa petición. Si esa consulta falla, muestra un mínimo (`≥`) y el plan sigue esperando tu aprobación: nunca se toma un mínimo como precio cerrado.
- **Vídeos de entrada grandes:** fal y NanoGPT los reciben embebidos y pueden superar su tamaño máximo.

## Licencia

[Apache License 2.0](LICENSE). Puedes usar, modificar y distribuir la app, también con fines comerciales, si conservas el aviso de copyright y el archivo [`NOTICE`](NOTICE) e indicas los cambios. La licencia no permite usar el nombre del proyecto ni del autor para promocionar derivados.

Copyright 2026 Samuel.
