# 0024 — Identidad visual: sistema de tarjetas, bases y resaltado

## Estado

Aceptado

Pasos 1 y 2 implementados en `task/workflow-ask-first`, sin fusionar. Pasos 3 a 5 pendientes. Justifica [el sistema visual de las tarjetas](../propuesta-sistema-visual-tarjetas.md) y [las bases y el resaltado](../propuesta-temas.md); la regla 6 de AGENTS.md los protege.

## Fecha

2026-10-20

## Contexto

Entre el 2026-10-19 y el 2026-10-20 el usuario fue probando en el sandbox las tarjetas del agente y corrigiendo lo que veía. Cada corrección acabó en una decisión; este documento las recoge en orden, con lo que decidió el usuario, por qué y qué corrección llevó a ello. Los motivos son los que dio el usuario; no se añaden otros. Detalle de código y pruebas en el [historial 047](../history/047-2026-10-W43.md) y el [048](../history/048-2026-10-W43.md).

## Decisión

**A. El modelo solo cambia cuando el usuario lo pide.** Fuera de Direct, una tarjeta compacta «Found X · $. Switch?»; en Direct, si el usuario nombra un modelo se cambia directamente. El cambio es por paso. Queda marcado DELICADO en [features/agente.md](../features/agente.md) («Cambio de modelo — delicado»): no se cambia sin autorización del usuario.

**B. Tarjeta de seguimiento tras un cambio.** La siguiente petición del mismo tipo pregunta «continuar con X / volver a Y / otro modelo». Solo en Auto (Guided ya lo pregunta todo); una petición de otro tipo sigue el flujo normal. «Continue» convierte X en el modelo confirmado. Motivo del usuario: «confirm settings siempre mantiene el modelo y solo cambia cuando el usuario lo pide».

**C. Correcciones en el sandbox, en orden:**
1. Los nombres completos de modelo hacían las tarjetas enormes: «Found model» más una píldora, y Keep / Change.
2. Sobre el plegable: «no era ese el que tenía en mente… se siente discordante». Pasa a reutilizar el selector en cápsula de `confirm_settings`.
3. Las opciones parecían texto plano: casillas reales.
4. «No se parecen; el ejemplo de confirm settings es el estilo»: se extrae el componente compartido `ModelField`.

**D. Fallo de `find_models`.** No encontraba FLUX 3 Klein: la expresión de familia de imagen solo cubría vídeo. Corregido (`flux[-_ .]?3` en la familia de imagen).

**E. Tamaños de tarjeta.** El usuario sentía los tamaños demasiado variables. No había nada escrito, así que cada agente inventaba su disposición y su rejilla. Pidió establecer y acotar el estilo gráfico. Su principio: «jerarquizar dentro de una misma identidad; no todas las variaciones son malas; un estándar y luego los puntos donde ciertas variaciones son útiles, flexible y estético sin uniformidad sosa». Tipografía, espaciado y disposición funcionan como plantillas; solo una o dos tarjetas destacan.

**F. «Decisión» (tarjeta del plan).** La banda de cabecera teñida «se ve feo» y la tarjeta crecía demasiado. Prefería los títulos de paso antiguos en negrita, pero le gustó el espaciado nuevo. Resultado: sin banda, la huella antigua y algo más de espacio entre filas. Se queda como variante (decisión del usuario).

**G. Color de selección.** «No me gusta ese verde diferente»: la selección sigue al color de resaltado y el verde queda solo para estados.

**H. Temas, a partir de imágenes de referencia** (Google Fotos oscuro, Fotor y un anuncio de una API de voz; solo se toman colores y formas).
- Prefirió el esquema neutro nuevo (Atlas) y los botones en píldora («se siente mejor»).
- Solo varía el color de resaltado, elegido entre ajustes fijos.
- El verde de Fotor quedaba demasiado cerca del lima: no se añade. Grafito es la oscura secundaria.
- La primera lectura de la tercera referencia como monocroma fue un error («no me gustó mucho, mira bien el esquema»). El esquema es la esfera con grano de lavanda a violeta a magenta, que pasó a ser Aurora. «Este sí me gustó.»

**I. Modelo final.**
- Selector de base: Sistema (por defecto), Atlas, Grafito, Claro (el modo claro cálido) y Original (antigua). Original conserva sus colores y esquinas de 10 px, usa la disposición nueva, no recibe más mejoras y se retirará más adelante.
- Seis resaltados independientes: lima (por defecto), azul, violeta, rosa, verde agua y Aurora.
- Se guarda solo en `localStorage`, fuera de la zona de persistencia protegida.
- Las tarjetas de cambio de modelo usan el tamaño medio.

**J. Regla 6 de AGENTS.md.** El usuario: «estas reglas son importantes; forman parte de la identidad, el que las cambie cambia la identidad visual». Cambiarlas exige aprobación explícita.

**K. Ajustes del marco tras probar** (`a705c97`, `9e7b47b`, `c98c2c7`): la barra superior es transparente y pierde la línea divisoria; los popovers usan el mismo borde que la caja del prompt (`--border`), que el usuario prefirió a reforzar el de la caja.

**M. Marco tranquilo** (2026-10-20). Tras probar los pasos 1 y 2, el usuario sentía la app «ruidosa con todo abierto» frente a Higgsfield, Flora y Gemini, con colores menos puntualizados. Se diagnosticaron cinco causas: el lima en unos diez sitios a la vez (235 usos del acento en el CSS, `--accent-soft` como fondo de casi todo lo activo); demasiadas cajas con borde; el razonamiento desplegado; letra pequeña, muchos grises y etiquetas en mayúsculas; estados vacíos repetidos. El usuario aprobó las cinco correcciones y pidió aplicarlas directamente, sin maqueta, en esta rama («si no me gusta revertimos»):
1. Acento solo para el primario o enviar, la marca, la selección en tarjetas y lo que está en curso; lo activo es neutro (`--active-*`).
2. Barra lateral, panel derecho y burbuja sin contorno (`--frame-border`); tarjetas resueltas como una línea.
3. Un turno del agente terminado se pliega a «Worked for Xs · lo que hizo»; el razonamiento solo se ve al abrirlo.
4. Conversación a 15 px (`--fs-chat`); títulos de sección y de tarjeta sin mayúsculas.
5. En Studio, el panel vacío muestra una sola línea; «Ongoing» solo aparece si algo corre.
Corrección tras probarlo (el usuario: «me gustó… se siente menos ruidoso»): en Home «New session» no se distinguía de la fila activa y quedaba resaltado de más. «New session» pasa a acción con contorno y sin relleno (`--new-*`); las pestañas de Home y de Spaces y el punto del carrusel, neutros; el dinero del pool en texto normal (`--money`; antes verde «para que se note»). Segunda corrección («se siente muy desalineado»): cada bloque tenía su sangría (texto del agente a 30 px por una marca vacía, turnos a 26, tarjetas resueltas a 0). Ahora todo arranca en el mismo borde: iconos en una columna de 13 px (`--feed-icon`) y texto tras 7 px (`--feed-gap`); la pregunta resuelta lleva check como Settings y su resumen va sin viñetas, alineado al texto. Original conserva el lima en lo activo, los contornos, el verde del dinero y su «New session» (redefine los tokens). Designer y nodos («no se ve muy bien» en Blanco): React Flow iba en `colorMode="dark"` con su fondo `#141414`; sus variables `--xy-*` leen ahora nuestros tokens, y las reglas y el borde de página del Designer leen los tokens al dibujar. Sus estados activos (herramienta, capa, opción, pestaña) son neutros; la selección en el lienzo (nodos, trazados, marquee, tiradores) y lo que genera siguen con el acento.

**N. Base Blanco** (2026-10-20). El usuario pidió «un tema variante de blanco con estos tonos» a partir de una captura de Google Vids, «manteniendo flexible el color de resaltado tal como ya existe». Nueva base `blanco` («White»): página blanca, paneles `#f0f4f9`, texto `#1f1f1f`/`#444746`; reutiliza el juego claro de los seis resaltados de Claro. Claro (cálido) se queda; Sistema sigue resolviendo a Claro en claro.

**O. Una norma para los campos de ajuste** (2026-10-20). El usuario: «auto-select y los demás tienen un marco pero no se ve coherente… hay que definir una fuente de verdad», con el deslizador de Influence casi invisible frente al de Opacity y una casilla que «no cuadra». Causa: la tira de contexto sobreescribía el fondo de los campos con `--surface` (el mismo de la tira) y otro radio, y «Auto-select» dibujaba su propio marco con casilla nativa. Ahora los tokens `--field-bg`, `--field-bg-hover`, `--field-border`, `--field-radius` y `--field-fill` son la única fuente para todos los campos de [ADR 0013](0013-campos-y-brocha.md) y los botones de la tira (`.tool-setting`), en cualquier barra o panel y en todas las bases. Los ajustes de encendido/apagado son `InlineToggle` (Auto-select, Reverse, Mirror, Simulate pressure, Allow painting); las casillas nativas quedan para menús, diálogos y popovers, con un solo estilo (el de `.cc-box`). `tests/ui-single-slider.test.ts` lo comprueba.

**L. Proceso.** Las maquetas usan el CSS real de la app. El visor del usuario bloquea el CSS local enlazado, así que se enviaron copias en línea. El usuario prueba en el sandbox; los agentes no abren navegadores.

## Alternativas

Dejar las variaciones libres (descartado en E: sin norma, cada agente inventa), una banda teñida en «Decisión» (F), un verde propio para la selección (G), un catálogo de temas completos en lugar de base más resaltado (H), un tema monocromo (H) y el verde de Fotor como resaltado (H). Guardar la apariencia en los ajustes persistidos: descartado para no tocar la zona protegida.

## Consecuencias

- Pasos 1 (tokens y bases) y 2 (selector en Ajustes → pestaña «Look») implementados; ver [apariencia](../features/apariencia.md).
- **Pendiente:** pasos 3 (plantillas de tarjeta), 4 (migración tarjeta a tarjeta) y 5 (`check-card-style`); la revisión visual del usuario de los pasos 1 y 2 en el sandbox; los arreglos pendientes del agente (notas de operaciones en inglés y el falso positivo de continuidad); la etiqueta de la pestaña «Look», en inglés, que el usuario quizá quiera «Apariencia».
- Cambiar estas reglas exige aprobación explícita del usuario.
