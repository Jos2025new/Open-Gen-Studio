# 073 · Posición al recargar, vista por espacio y diseño del subnet (sesión maestra 5, 2026-11-21)

Ramas `task/posicion-recarga` y `task/vista-espacio`, fusionadas en `main` (`6cbfec37`) con el sí del usuario. `task/descriptor-2` queda sin fusionar. Evidencia, no estado actual.

## Fusionado
- **Posición al recargar:**
  - **Fallo:** las tarjetas guardadas se recolocaban al montar el lienzo, porque la primera medición las trataba como nuevas.
  - **Arreglo:** ahora solo se recolocan las tarjetas añadidas o importadas en la sesión (`useLoadedIds.ts`). Neon corrigió dos casos: el grafo que llega tras la hidratación y deshacer un borrado.
  - **Prueba en sandbox (Haiku):** 3 recargas en el omnicanvas y en Nodes, sin deriva y con el arrastre conservado.
- **Vista por espacio, aprobada por el usuario:**
  - Nodes y el omnicanvas recuerdan su vista por sesión, también tras recargar (`graph.viewport` y el campo nuevo `graph.omniViewport`). El encuadre solo ocurre la primera vez.
  - «Ajustar a la vista» encuadra la selección o lo del usuario sin las tarjetas de sistema. Shift+1 encuadra todo y Shift+2 la selección.
  - Neon corrigió tres fallos: el guardado al cerrar la pestaña, la definición de «sistema» y los atajos con otro espacio abierto.
  - **Sin prueba en sandbox.**
- **`npm test` tras fusionar:** 4819 pasan y 1 falla: el atajo volvía a registrarse en cada render. Arreglado en `6cbfec37`; después solo se pasaron los tests relacionados.

## Sin fusionar: `task/descriptor-2`
- **Partes 1 a 5 del plan de GPT:**
  - valores iniciales por tipo y `DefaultsEnv`;
  - `env` en los puertos y salidas con nombre;
  - plan de varios pasos;
  - frescura por tipo;
  - registro de interfaz por tipo.
- **Equivalencia:** se conserva para los tipos actuales.
- **Estado:** GPT la dio por no fusionable, con cinco fallos altos, todos en lo nuevo que aún no usa nadie. Qué se conserva y qué se sustituye está en [diseno-subnet](../nucleo-nodos/diseno-subnet.md).

## Investigación guardada
- [blender-grupos](../nucleo-nodos/blender-grupos.md): el código de Blender sobre grupos, leído por Neon y cotejado por Sonnet.
- [diseno-subnet](../nucleo-nodos/diseno-subnet.md):
  - lo ya decidido, cotejado contra las transcripciones de sesiones pasadas;
  - el modelo, el ciclo de vida de los puertos y los criterios de aceptación;
  - lo que necesitará aprobación.
- Una búsqueda en docs, bus, memoria y transcripciones (Neon y Sonnet) separó las decisiones literales del usuario de las propuestas de los modelos.

## Lecciones (crítica de Neon a la dirección, adoptada por el usuario)
Fuente: bus `20261121-neon-critica-direccion-5.md`; observaciones en [metodo-trabajo](../metodo-trabajo.md#observaciones).
1. No se lanza una tanda nueva sin leer el diff y tener un «fusionable sí». Quien escribe y quien revisa no comparten carpeta. Un contrato se cambia por escritura y por lectura, con su ciclo de vida y un consumidor real.
2. Se lee el informe completo del bus, no solo el resumen. El resumen de la primera prueba de Haiku confundió el eje y el espacio.
3. Como máximo, dos procesos pesados a la vez. Los workers no corren `test:related` (de 13 a 24 minutos): Hydrogen se agotó esperándolo dos veces sin hacer commit.
4. Hay que mantener el foco en los frentes que pidió el usuario.

## Pendiente, en orden (sustituye a la lista de 072)
1. **App real a `main` y prueba con una clave real.** La app real sigue en `task/agent-forcing`, sin los arreglos de dinero ni los de hoy. Necesita aprobación.
2. **Huecos de dinero en los envíos:**
   - proveedor síncrono sin id;
   - aprobaciones solo en memoria;
   - `purgeDiscarded`;
   - LLM fuera de `jobs.ts`;
   - gasto estimado de un lote recargado sin precio.
3. **Probar en el sandbox la vista por espacio** y «Ajustar».
4. **Subnet**, aplazado por el usuario: paso 1 de [diseno-subnet](../nucleo-nodos/diseno-subnet.md), luego `task/descriptor-2` según ese documento.
5. **Agentes de suscripción** (baja prioridad).

Plan «Todo es un nodo»: va más o menos por la mitad, según una estimación de esta sesión sin verificar paso a paso. La tabla de su plan es del 2026-11-14 y está desactualizada. Nada bloquea aplazarlo una semana. Siguen abiertas las 14 dudas de interfaz y de arrastre del bus `20261120-master-para-usuario.md`.
