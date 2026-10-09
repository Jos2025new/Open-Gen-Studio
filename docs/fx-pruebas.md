# Capas FX: pruebas pendientes

Plan de validación de [ADR 0011](decisions/0011-capas-fx.md), rama `task/fx` (commit `9364125`). Formato: casilla, caso, cómo se prueba, qué se espera y la evidencia que lo cierra. Al cerrar uno, marca `[x]`, pon la fecha y la evidencia.

Evidencia: **test** = cubierto por `npm test` · **sandbox** = probado a mano en `npm run dev:sandbox` (puerto 5183) · **medido** = con cifras del registro de rendimiento ([ADR 0012](decisions/0012-registro-de-rendimiento.md), propuesto) · **externo** = en otro programa (Inkscape, navegador).

## Ya cubierto

- [x] Comandos, alcance, deshacer, SVG y agente: 33 tests en `tests/fx-*.test.ts`. **2026-10-08**, test.
- [x] Glow sobre un texto con alcance «Layer below»: halo visible, el texto no cambia de tamaño, menú FX, ocultar y mostrar, y el doble clic que abre el editor. **2026-10-08**, sandbox. Esa prueba encontró la escala aplicada dos veces (corregido en `9364125`).

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

Hoy no hay cifras. El render recalcula todas las capas FX en cada fotograma, sin caché, a la resolución de la vista. Es el primer cuello de botella esperado, y estos casos sirven para medirlo antes de optimizar.

| Caso | Variable | Valores |
| --- | --- | --- |
| Capas FX apiladas | número de capas «Everything below» con desenfoque | 1, 5, 10, 25, 50, 100, 300 |
| Operaciones por capa | número de operaciones en una sola capa FX | 1, 5, 20 |
| Tamaño del lienzo | documento | 1080², 4K (3840×2160), 8K |
| Zoom | escala de la vista | 25 %, 100 %, 400 % (el tope de 16 Mpx actúa aquí) |
| Interacción | qué ocurre durante la medición | quieto, arrastrar una capa, mover un deslizador del editor |
| Tipo de efecto | coste por paso | filtro CSS (barato), glow (varios pases), destello (gradientes) |

Para cada caso se registra:
- tiempo de `drawDoc`, total y por capa FX;
- latencia desde la acción hasta el primer fotograma que la muestra;
- fotogramas por encima de 16,7 ms mientras se arrastra;
- lienzos creados y píxeles reservados por fotograma;
- memoria de JavaScript (solo Chrome);
- tareas largas del navegador.

El resultado buscado es saber, para N capas, si el tiempo crece en línea y qué parte domina: pintar (GPU), reservar lienzos (memoria) o el trabajo de JavaScript. El cómo medir está en la propuesta [0012](decisions/0012-registro-de-rendimiento.md).

## 6. Robustez

- [ ] Documento con FX abierto por una versión anterior de la app (rama `task/agent-forcing`, sandbox). **Riesgo:** puede fallar al dibujar el tipo `fx`.
- [ ] Lienzo muy grande con decenas de FX: no debe colgar la pestaña. Si la cuelga, hace falta un límite o render progresivo.
- [ ] Navegadores: Chrome, Firefox y Safari 18 o posterior (`ctx.filter`). Hoy solo se ha probado en el navegador integrado (Chromium).
