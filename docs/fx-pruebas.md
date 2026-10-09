# Capas FX: pruebas pendientes

Plan de validación de [ADR 0011](decisions/0011-capas-fx.md), rama `task/fx` (commit `9364125`). Formato: casilla, caso, cómo se prueba, qué se espera y la evidencia que lo cierra. Al cerrar uno, marca `[x]`, pon la fecha y la evidencia.

Evidencia: **test** = cubierto por `npm test` · **script** = `npm run fx:check` en el sandbox, con capturas en `tests-e2e/screens/fx/` · **sandbox** = probado a mano en `npm run dev:sandbox` (puerto 5183) · **medido** = con cifras del registro de rendimiento ([ADR 0012](decisions/0012-registro-de-rendimiento.md)) · **externo** = en otro programa (Inkscape, navegador).

Cómo correr el script y el banco: [depuracion.md](depuracion.md).

## Ya cubierto

- [x] Comandos, alcance, deshacer, SVG y agente: 33 tests en `tests/fx-*.test.ts`. **2026-10-08**, test.
- [x] Glow sobre un texto con alcance «Layer below»: halo visible, el texto no cambia de tamaño, menú FX, ocultar y mostrar, y el doble clic que abre el editor. **2026-10-08**, sandbox. Esa prueba encontró la escala aplicada dos veces (corregido en `9364125`).

- [x] `npm run fx:check` (12 casos, 2026-10-08, Chromium headless):
  - cada uno de los 11 filtros y efectos sobre un texto con «Layer below»: cambia el lienzo, el contenido conserva sitio y tamaño, y un deshacer lo devuelve;
  - una capa de filtros «Everything below» con escala de grises: el rectángulo de color pasa a gris.
  
  **2026-10-08**, script. Encontró dos fallos, ya corregidos:
  - el destello se colocaba en coordenadas de la página y quedaba recortado fuera de la capa; ahora se coloca dentro de la capa destino, como en GIMP;
  - con una capa FX activa, arrastrar en el lienzo intentaba mover la capa FX, que no tiene geometría, y no movía nada.

## 1. Corrección visual (sandbox)

Cada caso: una imagen o un texto de prueba, aplicar, comparar con lo esperado y repetir con zoom al 25 %, 100 % y 400 %. El resultado no debe cambiar de tamaño ni de posición con el zoom.

- [ ] Cada filtro a secas sobre una foto: brillo, contraste, saturación, tono, escala de grises, sepia, invertir y desenfoque. **Esperado:** el mismo resultado que el filtro CSS equivalente en el navegador.
- [ ] Cada efecto sobre un texto y sobre una forma: glow, sombra y destello. **Esperado:** la sombra se desplaza en px de documento; el destello queda dentro de la capa con «Layer below» y cubre la página con «Everything below».
- [ ] «Everything below» con fondo de color y sin fondo (tablero). **Esperado:** el filtro afecta al fondo, no a las capas de encima.
- [ ] Varias capas «Layer below» seguidas sobre la misma capa. **Esperado:** se aplican de abajo arriba. Reordenarlas cambia el resultado.
- [ ] Capa FX con opacidad 50 % y con cada modo de fusión. **Esperado:** interpola con el original o pinta encima con ese modo.
- [ ] Capa destino con rotación, opacidad y fusión propias. **Esperado:** el FX actúa antes de su opacidad y su fusión.
- [ ] Capa FX dentro de una carpeta. **Esperado:** se mueve, oculta y bloquea con la carpeta; su alcance no se limita a la carpeta (límite documentado).
- [ ] Mover, escalar y girar la capa destino con un FX encima. **Esperado:** el FX la sigue en directo.
- [ ] Editar el texto de una capa con FX. **Esperado:** mientras se edita, la capa se oculta igual que hoy; al salir vuelve con su FX.

## 2. Interfaz (sandbox)

- [ ] Reordenar, desactivar, quitar (con Cancelar y con Quitar) y añadir operaciones en una capa completa.
- [ ] «Edit as … layer» en un filtro a secas: pasa a pila completa y no cambia el resultado.
- [ ] Deshacer y rehacer cada acción anterior: un paso por acción.
- [ ] Capa FX bloqueada: el editor queda desactivado y el agente recibe un error.
- [ ] Panel en pantalla estrecha (375 px de ancho): el menú y el editor caben sin scroll horizontal.
- [ ] Recargar la página: las capas FX y sus valores se conservan.

## 3. Exportación (externo)

- [ ] PNG y JPG: iguales a lo que se ve en el lienzo.
- [ ] SVG abierto en Inkscape 1.4: los filtros aparecen en *Filters → Filter Editor*, se pueden editar y se ven como en la app. Revisar sobre todo la sombra (radio a la mitad) y el glow.
- [ ] SVG con destello: aviso visible y el resto del archivo correcto.
- [ ] SVG con FX al 50 % de opacidad: comparar bordes semitransparentes (diferencia aceptada en el ADR).
- [ ] PDF con FX: svg2pdf no soporta todos los filtros. **Sin verificar qué sale.**

## 4. Operación `fx` y agente (sandbox, sin gasto)

- [ ] Menú de operaciones de un asset → «Filters & effects» → imagen nueva; la original no cambia.
- [ ] Nodo Tool con `fx`, cambiando `effect` y `amount`.
- [ ] Agente en el Designer: «desenfoca la foto y ponle un glow» → dos capas FX y un solo deshacer.
- [ ] Agente en Chat con una imagen adjunta: «pásala a blanco y negro» → operación `fx`, gratis, sin pedir aprobación de gasto.

## 5. Escala y rendimiento (medido)

**Primera medición (2026-10-08).** `FX_BENCH=100 npm run fx:check -- -g bench`, Chromium headless, 8 núcleos, sin GPU dedicada y con la máquina cargada. Documento de 1920×1080 a la escala de la vista (unos 0,5 Mpx por lienzo). N capas «Desenfoque» apiladas sobre un texto, arrastrando un rectángulo de otra capa a 60 Hz:

| Capas FX | Fotograma p50 | Lienzos / Mpx por fotograma | Parte de los pasos FX | Memoria JS |
| --- | --- | --- | --- | --- |
| 1 | 11,4 ms | 3 / 1,6 | 10 % | 66–75 MB |
| 5 | 45,4 ms | 8 / 4,2 | 58 % | 51–65 MB |
| 10 | 96 ms | 13 / 6,9 | 78 % | 59–67 MB |
| 25 | 203 ms | 28 / 14,7 | 91 % | 63–65 MB |
| 50 | 398 ms | 53 / 27,9 | 95 % | 55–72 MB |

La sesión de 100 capas no terminó: la app se cerró mientras añadía capas (código 137), así que no se sabe si fue por memoria.

**Lectura:**
- El coste crece en línea: unos 8 ms por capa de desenfoque y fotograma (7,7 ms por paso).
- **El cuello de botella son los pasos FX, que se recalculan en cada fotograma:** del 91 al 95 % del tiempo con 25 capas o más. El rectángulo arrastrado ni siquiera está bajo esas capas, y aun así el texto se vuelve a desenfocar 50 veces por fotograma.
- La memoria de JavaScript no crece. Lo que crece son los lienzos temporales: uno nuevo por paso, 28 Mpx por fotograma con 50 capas, que van a la GPU.
- Con 5 capas ya no se llega a 60 fps (45 ms). La latencia de añadir una capa con 50 apiladas es de unos 320 ms (p50).

**Siguiente paso** (pendiente en [pendientes.md](pendientes.md)): una caché del resultado de cada capa FX, como GIMP e Inkscape. Después, repetir esta medición para comprobar la mejora.

Casos aún sin medir:

| Caso | Variable | Valores |
| --- | --- | --- |
| Capas FX apiladas | número de capas «Everything below» con desenfoque | 1, 5, 10, 25, 50, 100, 300 |
| Operaciones por capa | número de operaciones en una sola capa FX | 1, 5, 20 |
| Tamaño del lienzo | documento | 1080², 4K (3840×2160), 8K |
| Zoom | escala de la vista | 25 %, 100 %, 400 % (el tope de 16 Mpx actúa aquí) |
| Interacción | qué ocurre durante la medición | quieto, mover un deslizador del editor |
| Tipo de efecto | coste por paso | glow (varios pases), destello (gradientes) |
| Modo profundo | `&deep=1` | qué parte es espera de la GPU |

## 6. Robustez

- [ ] Documento con FX abierto por una versión anterior de la app (rama `task/agent-forcing`, sandbox). **Riesgo:** puede fallar al dibujar el tipo `fx`.
- [ ] Lienzo muy grande con decenas de FX: no debe colgar la pestaña. Si la cuelga, hace falta un límite o render progresivo.
- [ ] Navegadores: Chrome, Firefox y Safari 18 o posterior (`ctx.filter`). Hoy solo se ha probado en el navegador integrado (Chromium).
