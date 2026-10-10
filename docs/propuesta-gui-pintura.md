# Propuesta: la interfaz del Designer según la filosofía de ibisPaint y Photoshop

Fecha: 2026-10-10. Estado: **propuesta, sin implementar**. La pidió el usuario a partir de dos capturas: un collage de paneles de Photoshop y la pantalla de dibujo de ibisPaint. Sus palabras: «no digo que lo copiemos, digo que miremos su filosofía y la extrapolemos»; en nuestro Designer, «aunque es más grande, [funciones importantes] quedan incluso ocultas». Lo que se dice de esas apps es **inferido de las capturas**, no de su documentación. Lo que se dice del Designer está **comprobado en el código** el mismo día.

## Lo que se ve en las capturas

**ibisPaint (pantalla de dibujo):**
- **Barra vertical izquierda, con nombre bajo cada icono:** mover/transformar, varita, lazo, filtro (FX), pincel, borrador, dedo (difuminar), desenfoque, pluma especial, cubo, vector, texto, viñetas, cuentagotas y lienzo.
- **Abajo, encima del lienzo, siempre a la vista:** el tamaño del pincel (deslizador, botones − y +, y valor «27.0px») y la opacidad (deslizador, botones − y +, «100%»).
- **Barra inferior:**
  - un círculo con el tamaño actual que abre el pincel;
  - un cuadrado con el color actual;
  - deshacer y rehacer;
  - un botón de capas (la «F») y volver.
- **Arriba a la derecha, botones redondos de un toque:** ajustes rápidos, selección, modo táctil o mano, y la regla.
- **El lienzo está girado:** la vista rota como una hoja sobre la mesa.

**Photoshop (collage de paneles):**
- **Capas:** arriba del panel van la fusión, la opacidad, la fila de bloqueos y el relleno. Los efectos cuelgan, sangrados, de su capa («Effects → Drop shadow»). Abajo, una fila de iconos: enlazar, fx, máscara, ajuste, grupo, nueva y borrar.
- **Pincel:** tamaño y dureza arriba, y debajo una cuadrícula de puntas.
- **Otros paneles:** color (deslizadores y rueda), muestras, carácter (fuentes con muestra) e histograma.

## La filosofía que se deduce

1. **Lo que se toca a cada segundo nunca se esconde:** tamaño, opacidad, color, deshacer, rehacer y capas están a un toque, sea cual sea la herramienta y el panel abierto.
2. **Cada herramienta tiene su nombre visible** en la barra; no hace falta pasar el ratón por encima para saber qué es.
3. **Lo ocasional se abre a demanda**, en un panel encima del lienzo, y se cierra.
4. **Lo que pertenece a una capa se ve dentro de esa capa:** sus efectos, su fusión y su opacidad.
5. **Las ayudas de dibujo** (selección, regla) **son interruptores de un toque**, no menús.

## Dónde estamos (comprobado en el código, 2026-10-10)

| Necesidad | ibisPaint / Photoshop | Designer hoy | Problema |
|---|---|---|---|
| Tamaño y opacidad del pincel | Siempre visibles abajo, con − y + | En la pestaña «Tool settings» del panel derecho, y una versión compacta en la barra inferior, tras el cuentagotas | Con la pestaña «Layers» abierta no se ven, y en la barra quedan tras las flechas `<` `>` cuando no caben (captura del 2026-10-10) |
| Capas y ajustes a la vez | Capas en su panel; el pincel en su barra | Capas y ajustes son **dos pestañas del mismo panel** (`LayersPanel.tsx`, `tab`) | Hay que elegir entre ver las capas o el pincel |
| Herramientas | Barra vertical con nombres | Barra inferior de iconos, con grupos y desbordamiento | La Regla y otras quedan ocultas; los nombres solo en el tooltip |
| Deshacer y rehacer | En la barra de dibujo | En la barra superior (`DesignerWorkspace.tsx`) | Lejos de la mano al pintar |
| Efectos de una capa | Sangrados bajo su capa | Capas FX aparte (ADR 0011), arriba de su capa | Se entiende peor qué filtra cada FX |
| Fusión y opacidad de capa | Arriba del panel de capas | En «propiedades», debajo de la lista | Hay que bajar para encontrarlas |
| Interruptores de ayuda | Botones redondos sobre el lienzo | Regla con su herramienta y su ajuste; selección en sus herramientas | Para activar o desactivar la regla hay que abrir sus ajustes |
| Girar el lienzo | Sí | No existe | Falta |
| Histograma | Panel propio | No existe | Niveles se ajusta a ciegas |

## Secuencia propuesta (de más impacto y menos riesgo a más)

1. **Barra del pincel siempre visible sobre el lienzo:** tamaño y opacidad con − y +, y el valor. Solo con pincel o borrador. Reutiliza `InlineSlider`, sin controles nuevos. Pequeño.
2. **Deshacer, rehacer y botón de capas junto a esa barra**, con la miniatura de la capa activa, como la «F» de ibisPaint. Pequeño.
3. **Herramientas que nunca se esconden:** barra vertical a la izquierda, con nombre corto bajo cada icono y grupos que se abren. Así desaparece el desbordamiento. Medio, porque cambia la distribución.
4. **Panel de capas al estilo Photoshop:**
   - fusión, opacidad y bloqueos arriba;
   - las capas FX de alcance «capa» sangradas bajo su capa (es solo cómo se ven; el modelo del ADR 0011 no cambia);
   - una fila de iconos abajo (nueva, grupo, fusionar, FX, borrar).

   Medio.
5. **Interruptores de un toque sobre el lienzo,** arriba a la derecha: regla activa o no, mostrar u ocultar la selección y la vista de píxeles. Pequeño.
6. **Girar el lienzo:** atajo y gesto, con el botón de ajustar que también endereza. Medio, porque toca las coordenadas de la vista (`viewCoordinates.ts`) y todas las herramientas.
7. **Histograma en Niveles** y **rueda de color**. Medio.
8. **Más adelante:** las herramientas dedo y desenfoque como pinceles, y una cuadrícula de puntas como la de Photoshop.

Para cada paso: probarlo en el sandbox con capturas, y que el usuario lo vea antes de seguir. Los pasos 1, 2 y 5 no cambian nada guardado; el 4 y el 6 cambian la interfaz y necesitan el visto bueno del usuario sobre su aspecto.

# Segunda ronda (2026-10-10): Feather 3D y SketchUp, cruzados con lo anterior

El usuario añadió dos capturas: Feather 3D, que mezcla 2D y 3D, y SketchUp, que para él es de una «simplicidad y accesibilidad extrema». Sus palabras: «todo está accesible y lo que no se descubre cuando se usa una tool o se requiere una función». También recordó que «nosotros ni por asomo tenemos tantas funciones aún, así que debería ser relativamente fácil disponer mejor nuestras features», y que el dibujo debe ser «accesiblemente robusto» aunque no sea lo que la app quiere destacar.

## Lo que se ve (inferido de las capturas)

**Feather 3D:**
- **Una tira vertical estrecha a la izquierda** con todo lo de cada segundo: la punta, el color, el tamaño («15»), la opacidad («100%»), la forma del trazo, el cuentagotas, deshacer y rehacer.
- **Arriba a la derecha,** botones de modo y de vista (plano de dibujo, espejo, vistas).
- **Abajo en el centro,** tres botones grandes para los modos principales: dibujar, plano y vista 3D.
- **Arriba a la izquierda,** inicio y menú.
- **El lienzo ocupa casi toda la pantalla.**

**SketchUp:**
1. **El lienzo,** que ocupa el centro.
2. **El título.**
3. **Un menú clásico** con todas las órdenes.
4. **Una barra con las herramientas principales.**
5. **Una barra de estado abajo** que **enseña la herramienta activa y sus modificadores** («Click or drag to select objects. Shift = Add/Subtract…»), y un campo **Measurements** para escribir valores exactos.
6. **La bandeja derecha («Default Tray»)** con paneles plegables uno debajo de otro: Entity Info, Materials, Components, Styles, Tags, Shadows, Scenes e Instructor. Instructor explica la herramienta activa.

Además, a la izquierda, una **paleta grande agrupada por familias** (seleccionar, pintar y borrar; dibujar; mover, girar y escalar; medir y texto; cámara).

## Coincidencias entre las cuatro apps, con su peso

Peso = cuántas de las cuatro lo hacen × cuánto le falta hoy al Designer × lo poco que cuesta. Alto, medio o bajo.

| Patrón | ibisPaint | Photoshop | Feather | SketchUp | Designer hoy | Peso |
|---|---|---|---|---|---|---|
| **A. Lo de cada segundo siempre visible** (tamaño, opacidad, color, deshacer) | barra inferior | barra de opciones | tira izquierda | — | escondido en una pestaña o tras el desbordamiento | **Alto** |
| **B. Herramientas a la vista, agrupadas por familia, sin desbordar** | barra con nombres | barra y grupos | pocas, grandes | paleta por familias | barra inferior que se desborda | **Alto** |
| **C. Paneles apilados y plegables, varios a la vez** | — | paneles | — | bandeja | dos pestañas que se excluyen (capas o ajustes) | **Alto** |
| **D. La herramienta activa se explica sola** (qué hace y sus modificadores) | — | — | — | barra de estado e Instructor | tres avisos sueltos (`StageHint`) y tooltips | **Alto** (lo que el usuario más valora de SketchUp) |
| **E. Interruptores de un toque sobre el lienzo** | arriba a la derecha | — | arriba a la derecha | — | la regla y el ajuste dentro de sus menús | Medio |
| **F. Pocos modos grandes y claros** | — | — | tres abajo | — | Edit / Objects / Layer en los ajustes | Medio |
| **G. Valores exactos al escribir** | valores en la barra | campos | — | Measurements | `InlineSlider` ya admite escribir; posición y tamaño en propiedades | Bajo (casi resuelto) |
| **H. El lienzo domina** | sí | — | sí | sí | sí, con márgenes ya reducidos | Bajo (hecho) |

## La interfaz que se deduce para el Designer

Lo que ya tenemos, mejor dispuesto; sin funciones nuevas:

- **Izquierda, tira rápida (A, como Feather):**
  - con pincel o borrador: color, tamaño y opacidad (cada uno con − y +), la punta y el cuentagotas;
  - con las demás herramientas, sus dos o tres valores principales;
  - siempre: deshacer y rehacer.

  Sustituye a los ajustes compactos de la barra inferior.
- **Abajo, solo herramientas (B, como SketchUp e ibisPaint),** agrupadas por familia:
  - Editar (mover, mano);
  - Seleccionar (rectángulo, lazo, varita);
  - Pintar (pincel, Lineart, borrador, cubo, degradado);
  - Formas, Líneas y Texto;
  - Guías (Regla);
  - Color (cuentagotas).

  Cada grupo muestra su herramienta activa y se abre al pulsarlo, sin flechas de desbordamiento.
- **Derecha, bandeja de paneles plegables (C, como SketchUp),** en lugar de dos pestañas:
  - **Capas,** con fusión, opacidad y bloqueos arriba y los FX sangrados bajo su capa;
  - **Ajustes de la herramienta** (completos);
  - **Propiedades de la capa** y **FX**.

  Cada uno se pliega por separado y recuerda su estado.
- **Abajo del lienzo, barra de estado (D, como SketchUp):**
  - una línea con la herramienta activa y sus modificadores («Pincel · Alt: cuentagotas · Mayús: …»), que reúne los avisos de hoy;
  - a la derecha, el valor que se está cambiando (tamaño, ángulo, posición) para escribirlo.
- **Arriba a la derecha del lienzo, interruptores (E):** regla activa, imán y alineación, vista de píxeles y reglas de página.

## Secuencia revisada (sustituye a la de la primera ronda)

1. **Barra de estado contextual (D).** Peso alto y coste bajo: reúne los avisos que ya existen y el texto de los tooltips; no mueve nada de sitio. Es lo que más acerca el Designer a SketchUp.
2. **Tira rápida a la izquierda (A),** con deshacer y rehacer. Reutiliza `InlineSlider` y los campos compactos.
3. **Bandeja de paneles plegables en lugar de pestañas (C).** Resuelve lo de «elegir entre ver las capas o el pincel».
4. **Herramientas agrupadas por familia, sin desbordamiento (B).**
5. **Interruptores sobre el lienzo (E).**
6. **Capas al estilo Photoshop** (fusión y opacidad arriba, FX sangrados): va dentro de la bandeja.
7. **Girar el lienzo, histograma en Niveles, rueda de color.**

Comprobación de cada paso: capturas en el sandbox y que el usuario lo vea antes del siguiente. Los pasos 1, 2 y 5 no cambian la distribución general. El 3 y el 4 sí: primero se enseñan como maqueta.
