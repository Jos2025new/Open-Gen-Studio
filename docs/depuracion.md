# Depurar y medir

Cómo grabar qué hace la app mientras pruebas algo, y cómo leerlo después (tú o un agente). Decisión: [ADR 0012](decisions/0012-registro-de-rendimiento.md).

## Protocolo

Para agentes y para quien mida. Se aplica **solo a lo que ya tiene sondas**: los dominios de la tabla «[Qué se mide hoy](#qué-se-mide-hoy-dominios)» y los casos de `npm run fx:check`. Para cualquier otra cosa, primero se añade la sonda ([Añadir una sonda](#añadir-una-sonda)) y su fila en esa tabla, en el mismo commit; después se mide.

1. **Cuándo.** El usuario pide medir, o una afirmación sobre rendimiento («va lento», «aguanta 100 capas») necesita cifras. Sin registro no se afirma nada de rendimiento: se dice «sin medir».
2. **Dónde.** Solo en el sandbox (`npm run dev:sandbox`, puerto 5183), y se detiene al terminar. Si el usuario grabó en su app real, se lee el archivo que él indique, sin abrir la app ni tocar `data/`.
3. **Cómo.**
   - Un caso reproducible: `FX_BENCH=n npm run fx:check -- -g bench`, o un escenario propio con `window.__OGS_TRACE__.start(etiqueta, { domains })`.
   - Un marcador antes de cada paso (`.mark('…')`).
   - `deep: true` solo para separar el tiempo de JavaScript del de la GPU.
4. **Leer.** `npm run trace:report` (o `--json`). Comparar tramos entre marcadores, no cifras sueltas.
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

Sin teclado: añade `?trace=<etiqueta>` a la dirección. Para grabar solo unas partes: `&domains=fx,render`. Para separar el tiempo de JavaScript del de pintado en la GPU: `&deep=1` (hace más lenta la medida).

Apagado, el registro no graba nada y su coste es comprobar un booleano. Nunca escribe en tus datos: solo añade archivos en `logs/`, con un tope de 50 MB por archivo.

## Leer una sesión

```bash
npm run trace:report
```

Sin argumentos lee la última sesión del sandbox. Para otra, pasa su ruta. `--json` da el resultado en JSON. El informe responde:

- **Fotogramas:** p50, p95 y máximo, cuántos pasan de 16,7 ms (60 fps) y los huecos entre fotogramas al arrastrar (tirones visibles).
- **Coste por número de capas FX:** cómo crece el fotograma.
- **Reparto del tiempo:** qué parte es de los pasos FX, y en modo profundo cuánto es espera de la GPU.
- **Memoria:** lienzos y megapíxeles creados por fotograma (presión sobre la GPU) y memoria de JavaScript (solo Chrome).
- **Latencia:** desde la acción (cualquier cambio del Designer, o un comando FX) hasta el fotograma que la muestra.
- **Tareas largas:** momentos en que la página no podía responder.
- **Lo mismo entre cada marcador.**

## Qué se mide hoy (dominios)

| Dominio | Eventos |
| --- | --- |
| `render` | `frame`: cada fotograma del lienzo del Designer, con capas, capas FX, lienzos y píxeles creados |
| `fx` | `layer` (cada capa FX), `pass` (cada operación), `pass-gpu` (modo profundo), `apply` (de un comando FX a su fotograma) |
| `designer` | `change`: de cualquier cambio del documento a su fotograma |
| `memory` | `heap`, cada segundo |
| `browser` | `longtask` (más de 50 ms) |
| `mark` | tus marcadores |

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
