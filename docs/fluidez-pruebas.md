# Fluidez: entrega al agente de pruebas

Implementación: [plan acordado](plan-fluidez.md), etapas 0–1. Las cifras antes/después están **pendientes**: el usuario reservó la automatización y los arrastres reales a otro agente. No tomar los números anteriores de desarrollo como una comparación de esta implementación.

## Para el agente de pruebas

Solo `/home/samuel/Documentos/Projects/My New App/ogs-agent-forcing`, rama `task/designer-ux`. No abrir la app real, tocar `data/`, ejecutar proveedores, borrar sesiones ni matar procesos ajenos. Una sola pestaña. Cerrar navegador y servidor propio al terminar. Antes de cada ejecución: `uptime` y `free -m`; esperar si carga >6 o memoria disponible <1,5 GB. No usar React profiler.

### Servidor y navegador

1. Comprueba que 5183 esté libre. En la carpeta indicada, sirve la baseline `86300c7` con la misma sonda:

   ```bash
   SANDBOX_BUILD_DIR=/tmp/ogs-fluidity-baseline npm run dev:sandbox -- --production --no-build
   ```

   La carpeta es un artefacto local de esta sesión; si falta, pedir que se reconstruya desde `86300c7` más los archivos de la etapa 0. No reutilizar una build distinta como baseline.

2. Carga el workflow (`agent-browser skills get core`). Usa Chrome/Chromium instalado, sesión aislada y una sola pestaña. Ejemplo:

   ```bash
   agent-browser --session ogs-fluidity --headed --executable-path /opt/brave.com/brave/brave open 'http://127.0.0.1:5183/?bench=1'
   agent-browser --session ogs-fluidity snapshot -i
   agent-browser --session ogs-fluidity eval 'window.__OGS_TEST__().hydrated'
   ```

   Espera hidratación y `window.__OGS_BENCH__`. Mantén la pestaña visible, ventana 1500×940, misma máquina/navegador/DPR. El banco aborta si no acierta un trazo; no contabilizar esa ejecución.

### Casos y sonda

3. **Habitual:** elige con los controles el documento ORIGINAL del usuario, no un documento de una prueba anterior. Anota su identificador y selecciona el mismo antes/después. Preparar conserva el original y crea una copia diagnóstica:

   ```bash
   agent-browser --session ogs-fluidity eval 'await window.__OGS_BENCH__.prepare("habitual")'
   agent-browser --session ogs-fluidity eval 'await window.__OGS_BENCH__.run()' > /tmp/fluidez-before-habitual-1.json
   ```

   Tres repeticiones con nombres `-1`, `-2`, `-3`. Cada repetición crea un trazo y lo mueve; registrar ese crecimiento y no atribuir diferencias mínimas al cambio. El JSON contiene navegador, núcleos, DPR, zoom, brush, handlers, cola, siguiente RAF, intervalos y tareas largas.

4. Cierra navegador y servidor baseline. Arranca la versión nueva:

   ```bash
   npm run dev:sandbox -- --production
   ```

   Reabre la misma URL, vuelve al MISMO original y repite habitual, con archivos `/tmp/fluidez-after-habitual-N.json`. Comparar habitual antes de preparar el caso exigente: añadir 1 000 sesiones contaminaría esa comparación.

5. **Exigente:** preparar UNA vez, desde la versión nueva:

   ```bash
   agent-browser --session ogs-fluidity eval 'await window.__OGS_BENCH__.prepare("exigente")'
   agent-browser --session ogs-fluidity eval 'await window.__OGS_BENCH__.run()' > /tmp/fluidez-after-exigente-1.json
   ```

   Añade 1 000 sesiones sintéticas con IDs estables y una capa de 300 trazos ×120 segmentos; conserva las existentes. Guarda los metadatos devueltos y el documento. Repite tres veces; cambia al servidor baseline y repite SOBRE ESA MISMA SESIÓN, sin preparar otra vez ni borrar datos. Anota el orden de ejecución y el número de trazos: el banco añade uno por repetición. No presentar el tamaño habitual de 12,6 MB/555 sesiones como actual sin comprobarlo.

6. Recoge por caso y versión: `frameWorkP95Ms`, máximo, `eventQueueP95Ms`, `eventNextRafP95Ms`, número/máximo de `longTasks`, duración, muestras y metadatos. Las tareas largas abarcan el gesto y el segundo posterior a pulsar/soltar. Guarda JSON completo y el resumen en el historial 025, entrada 3.

   **Límites:** handlers+RAF son un mínimo observado del trabajo del hilo, no CPU total. Siguiente RAF no es píxel presentado. Estos campos NO certifican por sí solos los umbrales de 8 ms ni 16,7 ms; para eso se necesitan perfil nativo y prueba visible. No sumar intervalos anidados.

### Arrastres reales y persistencia

7. Con `snapshot -i` fresco, elige Brush; dibuja suavemente, para y reanuda. Elige Edit → Objects; pulsa un trazo visible, arrástralo y suelta. Usa el ratón real de la herramienta con muchos `mouse move` entre `mouse down` y `mouse up` (consulta `--help`; `batch` recibe las instrucciones por stdin). Confirma que se seleccionó y MOVIÓ el trazo. Captura antes/después; Ctrl+Z debe restaurarlo en un paso. No aceptar una medición si el puntero no acertó el objeto.

8. Comprueba indicador: cambios pendientes → guardando → guardado solo después de respuestas de estado y raster; Ctrl+S incluso en un campo; recargar conserva dibujo. Simula HTTP500/desconexión únicamente mediante interceptación en el navegador de pruebas, nunca alterando datos: debe aparecer error y reintentar debe recuperar. El 409 muestra recargar y NO permite sobrescribir. Restaurar la interceptación antes de cerrar. Registrar funciones no disponibles del agente como «no probado».

9. Cierra con `agent-browser --session ogs-fluidity close`, detén TU servidor y confirma 5183 libre. Entrega tabla antes/después, capturas, errores, carga/memoria y lo no probado. No declarar «sin lag» a partir de tests o siguiente RAF.
