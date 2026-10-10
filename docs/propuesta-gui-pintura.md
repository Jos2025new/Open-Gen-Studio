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
