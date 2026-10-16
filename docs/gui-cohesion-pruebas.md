# Cómo probar la interfaz por espacios en el sandbox

Para el usuario, tras [039](history/039-2026-10-W42.md). Sandbox: `npm run dev:sandbox` (datos en `.sandbox/data`, puerto 5183); nunca la app real ni su carpeta de datos (AGENTS). Al terminar, parar el sandbox. **Gratis** = no llama a ningún proveedor; **Cuesta** = genera o consulta un modelo de pago: no lo hagas sin fijar un máximo (ADR 0004).

## Gratis

1. **Home.** Pulsa Home: el espacio de trabajo no pierde su borrador al volver. Pestañas Home, Projects (desactivada), Sessions y Library: Sessions y Library cambian la página en el sitio, sin cajón. Latest, «See all», «More/Less» de Tools. En Designer, Ctrl+Z con Home abierto no debe deshacer nada.
2. **Barra lateral.** Ancha: cabeceras plegables de Spaces, Create (2×2) y Tools. Estrecha: un icono por sección con panel flotante; mira si el tooltip tapa el panel o el título (pendiente).
3. **Create** (Image, Video, Audio, 3D desde Home o la barra): panel a la izquierda con pestañas de modo y tarjetas con etiqueta y valor; tablero a la derecha con Done, «mostrar fallidas» (fila Failed), refrescar (reinicia la vista), filtro, orden y favoritos. El icono Library abre Home en su pestaña Library. **No pulses Generate** (cuesta); mira el coste que muestra.
4. **Tools:** abre una herramienta, elige el activo de entrada (tiles recientes), cambia ajustes. **No pulses Generate** (cuesta).
5. **Flujo Go:** en el tablero elige un activo (Select) y una acción de Actions suggested (alterna); sin activo sale una pista; con activo, Go abre Tools con la herramienta o Create con el activo adjunto (si el compositor no lo admite, un aviso). Solo navega: no genera.
6. **Studio, tablero:** abrir y cerrar con la X y el botón pequeño, arrastrar el divisor, ancho que se recuerda al recargar; pestañas Generations, Nodes, Designer. Estrecho (≤760 px) el tablero se oculta (pendiente).
7. **Nodes y Designer incrustados:** con Nodes, mover y hacer zoom, seleccionar, y Ctrl+Z, Ctrl+C o Supr solo con el foco dentro del tablero (escribir en el chat no debe afectarlos). Con Designer: barra superior (File, Select, Pan, deshacer, zoom), barra inferior (Line art, Color, Size, Eraser, Shapes, Text, Layers), Ctrl+V de una imagen con el foco dentro del tablero y no desde el chat. Crear un diseño: File → New. Las teclas de herramienta y borrar capas no funcionan (pendiente conocido).
8. **Un agente sin modelo de pago** no sirve para `open_board`; ver abajo.

## Cuesta (evita o fija un máximo antes)

- **Generate** en Create o Tools con proveedores reales; cualquier generación del chat.
- **`open_board` con el agente real:** pide en Studio «edita el keyframe» o «mira el diseño»: usa el modelo del agente (coste por mensaje) y, si propone un plan, las generaciones aparte. Con Nodes o Designer vacíos el agente solo lee, pero la llamada al modelo ya cuesta.
- **Plan o paso de capa del agente** en el Designer incrustado que dispare una generación.

Para probar `open_board` sin gasto de generación basta ver la línea de contexto («You are in Studio (chat). The board shows: …») en el depurador del turno y el mensaje del agente; el test `studio-agent.test.ts` cubre el resto con un modelo simulado.
