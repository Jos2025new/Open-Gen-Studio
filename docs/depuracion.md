# Depurar y medir

Cómo grabar qué hace la app mientras pruebas algo, y cómo leerlo después (tú o un agente). Decisión: [ADR 0012](decisions/0012-registro-de-rendimiento.md).

## Protocolo

Para agentes y para quien mida. Se aplica **solo a lo que ya tiene sondas**: los dominios de la tabla «[Qué se mide hoy](#qué-se-mide-hoy-dominios)» y los casos de `npm run fx:check`. Para cualquier otra cosa, primero se añade la sonda ([Añadir una sonda](#añadir-una-sonda)) y su fila en esa tabla, en el mismo commit; después se mide.

1. **Cuándo.** El usuario pide medir, o una afirmación sobre rendimiento («va lento», «aguanta 100 capas») necesita cifras. Sin registro no se afirma nada de rendimiento: se dice «sin medir».
2. **Dónde.** Solo en el sandbox (`npm run dev:sandbox`, puerto 5183), y se detiene al terminar. Si el usuario grabó en su app real, se lee el archivo que él indique, sin abrir la app ni tocar `data/`.
3. **Cómo.**
   - Un caso reproducible: `FX_BENCH=n npm run fx:check -- -g bench`, o un escenario propio con `window.__OGS_TRACE__.start(etiqueta, { domains })`.
   - Un marcador antes de cada paso (`.mark('…')`).
   - `deep: true` mide la espera con lectura sincronizada de un píxel; altera el render y no separa exactamente CPU y GPU.
4. **Leer.** `npm run trace:report` (o `--json`). Comparar tramos entre marcadores, no cifras sueltas. Para porcentaje FX activar tanto `fx` como `render`: sin fotogramas atribuidos no hay denominador. Comprobar el origen antes de comparar; un export no es un fotograma del editor.
5. **Informar.** Cada cifra va con:
   - navegador, núcleos, tamaño del documento y zoom;
   - cuántas veces se midió;
   - lo que no llegó a medirse.
   
   Las cifras quedan en el documento de pruebas de la función (por ejemplo, [fx-pruebas.md](fx-pruebas.md), sección 5) y, si revelan un cuello de botella, en [pendientes.md](pendientes.md).
6. **Optimizar.** Solo después de medir. Se repite la misma medición tras el cambio para comprobar la mejora.

## Grabar una sesión

1. Con la app abierta (sandbox o real), pulsa **Ctrl+Alt+P** (⌘+Alt+P en Mac) y escribe qué vas a probar: «100 capas de desenfoque en 4K».
2. Abajo a la derecha aparece un indicador rojo con el tiempo. Antes de cada paso, pulsa la bandera y escribe un **marcador**: «ahora arrastro la foto». El informe separa las cifras por marcadores.
3. Pulsa **Ctrl+Alt+P** otra vez, o el cuadrado, para parar. El aviso dice dónde quedó: `logs/trace-<fecha>-<etiqueta>.jsonl`, dentro de `data/` en la app real y de `.sandbox/data/` en el sandbox.

Sin teclado: añade `?trace=<etiqueta>` a la dirección. Para grabar solo unas partes: `&domains=fx,render`. Para medir la espera con lectura sincronizada de un píxel: `&deep=1` (hace más lenta la medida; no separa exactamente CPU y GPU).

Apagado, el registro no graba nada y su coste es comprobar un booleano. Nunca escribe en tus datos: solo añade archivos en `logs/`, con un tope de 50 MB por archivo.

## Leer una sesión

```bash
npm run trace:report
```

Sin argumentos lee la última sesión del sandbox. Para otra, pasa su ruta. `--json` da el resultado en JSON. El informe responde:

- **Fotogramas:** p50, p95 y máximo, cuántos pasan de 16,7 ms (60 fps) y los huecos entre fotogramas al arrastrar (tirones visibles).
- **Coste por número de capas FX:** cómo crece el fotograma.
- **Reparto del tiempo:** qué parte del fotograma del editor ocupan sus pasos FX, y cuánto dura la lectura sincronizada en modo profundo. Los dibujos de exportación, relleno, vista del agente, miniaturas y operación FX sobre assets se muestran por origen, fuera de ese porcentaje.
- **Memoria:** lienzos y megapíxeles creados por fotograma (presión sobre la GPU) y memoria de JavaScript (solo Chrome).
- **Latencia:** desde la acción (cualquier cambio del Designer, o un comando FX) hasta el fotograma que la muestra.
- **Tareas largas:** momentos en que la página no podía responder.
- **Lo mismo entre cada marcador.**

## Qué se mide hoy (dominios)

| Dominio | Eventos |
| --- | --- |
| `render` | `frame`: cada fotograma del lienzo del Designer, con capas, capas FX, lienzos y píxeles creados; `offscreen`: un dibujo fuera del editor. Ambos llevan identificador de render y origen |
| `fx` | `layer` (cada capa FX), `pass` (cada operación), `pass-gpu` (lectura sincronizada de un píxel, modo profundo), vinculados al identificador y origen del render, `apply` (de un comando FX a su fotograma) |
| `designer` | `change`: de cualquier cambio del documento a su fotograma |
| `memory` | `heap`, cada segundo |
| `browser` | `longtask` (más de 50 ms) |
| `mark` | tus marcadores |
| `history` | `capture`: captura del documento y referencias de buffers; cuenta buffers y píxeles copiados |
| `raster` | `restore`: restaurar referencias y programar guardado; `clone`: copia de un lienzo; `compose`: reconstruir base y trazos; `live`: pintar un segmento; `draw`: dibujar el buffer raster |

La latencia de `fx` o `designer` se registra aunque no se active el dominio `render`: el dibujo del lienzo del editor resuelve la acción pendiente de forma independiente de grabar su duración. Un dibujo fuera de pantalla no la resuelve.

No usar una sesión con `&deep=1` como si tuviera el mismo coste que la normal: la lectura fuerza sincronización. Las estadísticas generales de pasos y lecturas abarcan todos los orígenes; el desglose por origen permite separarlos.

El informe cruza `renderId` y `origin` de cada paso con su fotograma: suma la unión de sus intervalos dentro del fotograma, sin contar dos veces los solapamientos del reloj redondeado. Orígenes: editor, export, fill, agent-view, thumbnail, selection, color-sample, asset-fx y offscreen (llamante sin etiqueta). Las trazas antiguas sin atribución se muestran como unattributed; no se calcula su porcentaje. Una sesión solo con FX conserva el origen, pero no tiene el denominador de fotogramas. Los totales de eventos anidados no se deben sumar como tiempo de pared.

## Añadir una sonda

Una línea en cualquier función, sin tocar nada más:

```ts
import { span } from '../../lib/trace';
const end = span('dominio', 'nombre', { lo: 'que ayude' });
// … el trabajo …
end({ resultado: 1 });
```

Para una acción cuyo efecto se ve en el siguiente fotograma: `awaitFrame('dominio', 'nombre')`. Para un evento puntual: `note(...)`. Con la sesión apagada todo es una operación vacía.

## Probar solo una pieza

No hace falta correr toda la suite:

- Un test, o un caso de un test: `npx vitest run tests/fx-svg.test.ts -t "glow"`.
- Los tests afectados por lo que cambiaste: `npm run test:related`.
- En el navegador, con el sandbox en marcha (`npm run dev:sandbox`):
  - todas las comprobaciones FX con capturas: `npm run fx:check`; un caso: `npm run fx:check -- -g "Blur"`;
  - banco de N capas FX con registro: `FX_BENCH=50 npm run fx:check -- -g bench`, y después `npm run trace:report`.
- Las capturas quedan en `tests-e2e/screens/fx/` (fuera de git).

## Para agentes

- En el sandbox (puerto 5183): `window.__OGS_TRACE__.start(label, { domains, deep })`, `.mark(texto)`, `.stop()`. Nunca sobre la app real ni sobre `data/`: si el usuario graba en su app, que te pase la ruta del archivo.
- Cita las cifras con su contexto: navegador, núcleos, tamaño del documento y zoom. Los números de una máquina no valen para otra.

## Decisiones de rendimiento del Designer (2026-10-09)

Pedido del usuario: el Designer iba lento al pintar «o hacer cualquier cosa», y «una interfaz que vaya lenta conforme más se usa deja la app inviable». Criterio que fijó: primero lo que más aporte al usuario y a la UX, con menos riesgo y más escalable.

- **Hecho (Claude, `585919a`):**
  - Caché de FX del editor para capas con FX «layer».
  - Guardado que reutiliza el texto de las sesiones sin cambios: 131 ms → 24 ms en el estado del sandbox (7,9 MB, Node, mediana de 10).
  - Contratos `fx-editor-cache` y `persist-json-exact` en el [mapa](map.md).
- **Hecho (Claude, este commit):** la escritura del estado espera a que el navegador esté libre (`requestIdleCallback`, plazo 1 s). No abarata el guardado, pero deja de notarse a mitad de un gesto. Cerrar u ocultar la página sigue escribiendo al momento. **test**: `tests/idle-save.test.ts`.
- **Medido, lo que queda:** de esos 24 ms, convertir la sesión activa (142 KB) cuesta 3,5 ms; unir las 95 sesiones en un texto de 8 MB, ~20–29 ms. Ese coste **crece con el número de sesiones**.
- **Pendiente, revisar con GPT 6 Astra antes de tocar código — guardar cada sesión por separado** (el usuario lo prefiere, 2026-10-09). Es el arreglo que escala: el coste dejaría de crecer con el número de sesiones. Es lo más delicado del proyecto, por cuatro motivos:
  - cambia el formato del guardado en el navegador (`src/lib/idb.ts`, `src/store/store.ts`) y en disco (`server/local-store.js`);
  - hay que llevar a sesiones sueltas las copias, `baseAt` y el rechazo de pérdidas masivas (AGENTS.md);
  - hay que leer el formato viejo y migrarlo, con aprobación explícita del usuario;
  - hoy el JSON y los blobs no se guardan como una operación conjunta (aviso de Astra).

  Paso 1: [ADR 0014 propuesto](decisions/0014-sesiones-separadas.md), redactado y revisado contra código por Astra el 2026-10-10; incluye formato, lectura del viejo, protecciones, atomicidad y comprobación. **Pendiente de aprobación del usuario**. Paso 2: el código, ampliando los tests de persistencia existentes.
- **Descartado:**
  - **Serializar en un worker:** enviarle el estado cuesta casi lo mismo que convertirlo ([surma.dev](https://surma.dev/things/is-postmessage-slow), [Mozilla 1356546](https://bugzilla.mozilla.org/show_bug.cgi?id=1356546)).
  - **Redondear decimales de los trazos:** aporta poco y toca los datos.
  - **Rust o WASM:** no ataca ninguna de las causas medidas.
- **Hecho, el FX sobre la capa que se pinta (2026-10-09, Claude):** mientras se pinta en la misma capa que filtra un FX, el filtro puede ir hasta 120 ms por detrás del trazo (si el puntero se queda quieto, un redibujado programado lo pone al día: fallo hallado por Astra el 2026-10-10 y corregido) y se pone al día al soltar, como hacen Krita y GIMP en parte. El usuario: «que sea como Krita o GIMP también sirve». Se eligió esto, en lugar de recalcular solo la zona tocada, por no tener riesgo de costuras y ser pocas líneas. **test**: el caso de trazo en vivo de `fx-render.test.ts`. Las regiones siguen en pendientes (plan del Designer, punto 3), solo si el retraso molesta.
- **Sin medir en el navegador del usuario:** no hay sonda del guardado ni de la brocha. El estabilizador del usuario estaba en 10, que retrasa la brocha a propósito.
- **Brocha raster lenta (el usuario, 2026-10-09: «la lentitud viene del pincel raster; el de lineart va súper bien»).** Causa probable, de código: en cada movimiento el motor leía los píxeles de la máscara con `getImageData`, que espera a la GPU (la Lineart no lee). **Hecho (Claude):** la máscara vive en memoria (`LiveStroke.pixels`) y solo se escribe la zona tocada con `putImageData`, sin leer nunca. Por encima de 16 Mpx de capa sigue el camino anterior. Comprobación: `npm run brush:check` (el trazo reconstruido igual que el pintado, ≤ 1 nivel). Sin sonda de milisegundos por movimiento: la mejora la juzga el usuario.
- **Zoom (2026-10-09):** el máximo pasa de 800 % a 3200 %, como Photoshop (`MAX_ZOOM` en `viewCoordinates.ts`; el campo de porcentaje usa el mismo límite).
- **Panel de filtros (2026-10-09):** cada filtro se abre y se cierra por su cuenta. Antes, abrir uno cerraba el otro, y al usuario no le gustaba.
- **Probado por el usuario (2026-10-09, sandbox, Brave):** con la caché de FX (`585919a`), el guardado ligero y en momento libre (`7cf101f`) y el FX que sigue al trazo (`926aea4`), dijo: «el pincel no anda tan lento… buen trabajo». No probó los ajustes de la brocha ni otras herramientas, así que esa prueba cubre solo la velocidad al pintar. Precedente: cuando el usuario prueba un cambio concreto, se anota con fecha qué cambio probó y qué no, con sus palabras.
- **Integrado después, todavía sin probar por el usuario (2026-10-09):** brocha sin lectura del canvas, zoom a 3200 % y filtros que se abren por separado (`7efeb42`). El usuario no lo había visto: el máximo seguía en 800 % porque esta rama no estaba integrada. Falta también `npm run brush:check`.
- **Revisión de Astra (2026-10-10, solo código) y validación de Claude (mismo día):** dos fallos, ambos corregidos: fusionar cambiaba la opacidad visible, y el FX podía quedarse atrasado con el puntero quieto. Lo demás, sin fallos: la caché se invalida bien y el guardado conserva las protecciones. Matiz: la pasada completa de 30 s ocurre en el primer guardado tras ese plazo, no por sí sola. En el navegador (sandbox), Claude comprobó: `npm run brush:check` 7/7 (la brocha sin lectura del canvas reconstruye igual) y `npm run tools:check` (fusionar, rasterizar, Grow/Shrink y espejo).
