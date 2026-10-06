# Error del agente: referencia de una vista 3D

Fecha: 2026-10-06. Rama: task/price-auth. Base: 4839438. Samuel pidió corregir y documentar el error observado después de la corrección transversal del operador.

## Reporte y límites del diagnóstico

Pedido: «Dame una vista de la imagen que ves del modelo 3D, usa esa referencia para que mantenga el estilo visual que ya tenemos». El transcript aportado registra 68 s totales, con 61 s de pensamiento. El agente consideró seis imágenes de vista, dudó entre preguntar y elegir la más reciente, y no consta una búsqueda ni ejecución en ese fragmento.

Es evidencia aportada por el usuario. No reconstruimos su payload, adjuntos efectivos ni almacenamiento privado. Por tanto, el código confirma los errores siguientes, pero no permite atribuirles por sí solos los 61 s ni afirmar que el fallo del adjunto ocurrió en esa ejecución.

## Errores confirmados

1. **Un único adjunto 3D no llegaba al mecanismo visual.** visibleAttachments comprobaba únicamente image/video y salía antes de attachmentParts cuando el único adjunto era model3d. attachmentParts ya sabía convertir un 3D en su captura. También se omitía el aviso de falta de visión para ese caso. Referencia: [runtime.ts](../src/engine/agent/runtime.ts), función visibleAttachments.
2. **La relación vigente se perdía en el contexto habitual.** El modelo conserva viewImageId; al actualizar la vista, las capturas anteriores quedan disponibles para referencias de generaciones existentes. Sin embargo, el listado reciente presentaba capturas genéricas y el adjunto textual no nombraba su captura vigente. La herramienta find_assets contenía parte de esa relación, pero no la comunicaba uniformemente con los otros consumidores. Referencias: [context.ts](../src/engine/agent/context.ts), buildContext; [model3dThumb.ts](../src/lib/model3dThumb.ts), captura y conservación de la vista anterior.
3. **Una referencia inválida podía anunciarse o enviarse.** Las rutas de adjunto y viewTargets confiaban en viewImageId sin comprobar que correspondía a una imagen de la misma sesión. El test demuestra ese comportamiento con metadata fabricada; no demuestra datos dañados reales ni una filtración ocurrida. La corrección protege ambas rutas contra esa inconsistencia.

La raíz común es una relación de recursos que la app ya conoce, pero que se filtra o comunica de forma diferente según el camino. Se corrigió esa conexión; no se añadió una regla de «elige siempre la más reciente».

## Corrección y consumidores

- [assetSearch.ts](../src/engine/agent/assetSearch.ts): currentViewImage comprueba tipo de imagen y misma sesión; viewReferenceLabel comunica el ID vigente, la relación inversa modelo/captura y las vistas guardadas sin dueño vigente conocido. describeAsset y viewTargets reutilizan esa relación.
- [context.ts](../src/engine/agent/context.ts): adjuntos y activos recientes incorporan la misma etiqueta. Una captura más reciente de otro modelo no sustituye la seleccionada. Se conserva el orden de selección y el límite de diez resultados recientes.
- [attachments.ts](../src/engine/agent/attachments.ts): el contenido visual y su etiqueta usan la misma relación validada. La miniatura propia sigue como fallback; si no hay un asset de captura válido, no se presenta un ID ausente o ajeno como referencia utilizable.
- [runtime.ts](../src/engine/agent/runtime.ts): model3d entra en visibleAttachments, conservando el control de visión. find_assets pasa el registro de assets a viewTargets para la validación compartida.
- [tools.ts](../src/engine/agent/tools.ts): describe que un 3D se muestra mediante su captura guardada vigente y que las anteriores siguen siendo imágenes independientes.

No se borra ni migra ninguna captura. Una imagen guardada que el usuario selecciona explícitamente sigue utilizándose como esa imagen; no se convierte automáticamente en la vista actual. El GLB continúa siendo distinto del asset de imagen que puede alimentar una generación. No se infiere el padre histórico de una captura que el esquema ya no relaciona con un modelo.

## Pruebas y procedimiento

[agent-attachment-selection.test.ts](../tests/agent-attachment-selection.test.ts):

- Pedido completo mediante sendAgentMessage con solo un 3D: un agente con visión recibe la captura; uno sin visión recibe el aviso y no la imagen. El endpoint LLM está simulado, sin red externa ni claves reales.
- Contexto con seis capturas, dos modelos y un modelo de otra sesión: se conserva el ID vigente del modelo adjunto aunque haya imágenes más recientes; cada captura vigente identifica su modelo, y las restantes no se anuncian como vigentes.
- ID de vista ausente: no se anuncia una referencia utilizable.
- ID de vista de otra sesión: no se solicita su imagen; conserva la miniatura propia como fallback y una etiqueta coherente.

[find-assets.test.ts](../tests/find-assets.test.ts): descripción y destino de vista comparten la relación vigente; viewTargets rechaza una captura ajena y conserva una imagen guardada seleccionada explícitamente.

Las cuatro regresiones iniciales fallaron antes del arreglo. Los tests adicionales de adjunto y búsqueda con relación ajena también fallaron antes de sus respectivas correcciones. Los tests existentes se conservaron; se adaptaron solamente las expectativas del texto que ahora dice vista vigente.

Validación final: npm test -- --maxWorkers=2 aprobó 712 tests y omitió 5 (125 archivos aprobados, 5 omitidos), en 37,33 s. npm run typecheck y git diff --check aprobados. La suite incluye salvaguardas y check-docs; los tests omitidos no se consideran casos verificados. Ese tiempo corresponde a la suite, no al LLM.

## Sandbox y latencia

El puerto 5183 estaba ocupado por un proceso existente. Se intentó npm run dev:sandbox, falló por puerto ocupado y se detuvo únicamente ese lanzador. No se tocó el proceso ajeno. La carpeta data/ real estaba ausente en este checkout.

Después Samuel informó que había liberado el puerto. Se comprobó libre y se arrancó un sandbox propio. Una primera navegación encontró el servidor inactivo; se reinició únicamente el servidor propio y la repetición funcionó. Perfil nuevo propio, fetch del almacén bloqueado antes de navegar, seis capturas sintéticas y dos modelos. Desde la GUI se adjuntó únicamente hero y se envió el pedido original. Se interceptó la llamada LLM con una respuesta simulada, sin enviarla a un proveedor.

Payload observado: una imagen JPEG (data URL de 2595 caracteres), etiqueta asset:current, relación explícita de ambas capturas vigentes con sus modelos y cuatro capturas guardadas diferenciadas. Se conservaron las seis imágenes; biblioteca vacía y cero generaciones. Un intento de acceso al almacén y dos intentos externos quedaron bloqueados; una llamada LLM fue simulada. No se imprimieron imágenes base64 ni cabeceras/claves. La captura de pantalla y el JSON resumido se entregan en outputs/agent-3d-reference fuera del repositorio. El «Worked for 1s» visible pertenece a la respuesta simulada, no demuestra una mejora de latencia del modelo. La imagen de entrada fue un bitmap sintético: no se validó la captura/renderización de un GLB real ni la fidelidad de una generación. Navegador y servidor propios detenidos.

Vite avisó que la fuente Inter del enlace node_modules estaba fuera de su lista de acceso; se usó el fallback sin ampliar la configuración.

No hay captura nueva, espera de renderizado, petición de red, tool round ni trabajo por frame añadido. Las etiquetas consultan metadata al construir el pedido y la respuesta de búsqueda; existe un coste local de CPU no medido. La mejora de latencia del LLM sigue sin verificar. viewImageId corresponde a la última captura guardada completada; esta corrección no garantiza sincronización instantánea con una cámara cuyo render aún está pendiente.

## Comprobación posterior

Recargar la app autorizada, adjuntar únicamente el modelo 3D y repetir el pedido. Verificar que el payload nombra la captura vigente y la envía como imagen; el plan debe referenciar ese asset y preservar el estilo solicitado. Probar también una captura antigua explícitamente seleccionada. Con más de un modelo sin selección clara puede seguir siendo legítima una pregunta; no se autoriza escoger una referencia arbitraria.

Registrar tiempo hasta la primera acción útil y hasta un plan válido, lecturas, preguntas y rechazos. Comparar con el mismo modelo y condiciones antes de afirmar ahorro. Verificar separado el estilo de la salida: recibir una referencia correcta no garantiza fidelidad de un proveedor. Las pruebas pagadas requieren su autorización específica. Ante una discrepancia, conservar el payload y la relación de IDs con secretos redactados; corregir el productor/consumidor correspondiente, sin añadir excepciones por cada pedido.
