# NanoGPT expansion-2 — resultados y límites

Preparación: 2026-10-05. El usuario solicita una nueva tanda después del fallo del
primer calentamiento de MiMo; conserva el tope global aprobado de USD 1.00.
El [informe anterior](nanogpt-price-comparison.md) documenta los resultados de
DeepSeek y el intento detenido. El usuario ejecutó la tanda; Codex analizó el archivo de métricas offline.

## Presupuesto y manifiesto

Se mantienen los cuatro IDs: xiaomi/mimo-v2.6-flash, x-ai/grok-4.7,
openai/gpt-6-luna y z-ai/glm-5.3-flash. Todas las peticiones solicitan medium y
max_tokens=2000. MiMo y GLM no anuncian medium nativo: nivel efectivo desconocido.
Cada modelo tiene un calentamiento sin medir, inmediatamente antes de su primera
pareja, con el mismo cuerpo que el primer control. Después hay tres parejas por
modelo; orden control/aviso, aviso/control, control/aviso. Hasta 28 envíos: 4
calentamientos y 24 muestras. Solo las medidas enviadas cuentan para las medianas.

| Concepto | Máximo contabilizado USD |
| --- | ---: |
| DeepSeek previo | 0.004020 |
| Intento de MiMo incierto previo, reserva conservada | 0.004844 |
| Total previo arrastrado | **0.008864** |
| Nueva tanda, incluidos calentamientos y contingencia de Grok | **0.920709** |
| Máximo global calculado | **0.929573** |
| Tope global aplicado | **1.000000** |

Los importes previos proceden de los ledgers existentes, no de una factura:
el coste del calentamiento fallido sigue desconocido. No se cuenta DeepSeek dos
veces; expansion-2 incorpora el total global anterior una sola vez. El manifiesto
incluye hashes de ambos ledgers, política de fallo y las 28 peticiones exactas.
Cambiar esos antecedentes invalida la aprobación. Se validan sumas, IDs y estado
del ledger detenido, y su consistencia con expansion/results.json.

La estimación conserva caracteres Unicode del JSON compacto / 3 más margen del
50 %, los precios del catálogo del 2026-10-05 y toda la salida de 2000 tokens.
No usa tokenizer, descuentos ni controles cache_control. La contingencia de Grok
de 7 × USD 0.055 cabe completa. Si un manifiesto no cupiera, se elimina primero
esa contingencia, conservando parejas y calentamientos; si sigue por encima,
aborta antes de enviar. Son máximos presupuestados por la aproximación acordada,
no una garantía contractual del proveedor. Autorizado/reservado ≠ cobrado.

## Diagnóstico seguro y política de fallos

Código común: [sampleRequest](../scripts/price-pilot.mjs). Cada error devuelve
solo failureKind, failurePhase, httpStatus, providerErrorCode y providerErrorType,
más coste numérico informado si lo hay. Fases: fetch, http, parse, provider-error
y timeout; un fallo local no clasificable queda desconocido. Los números HTTP
se validan; error.code/error.type solo conservan códigos técnicos de una lista
permitida o enteros pequeños. Valores arbitrarios o iguales a la clave se marcan
desconocidos. La lista es limitada: no promete identificar códigos futuros.
Se analiza en memoria un cuerpo HTTP de error acotado, sin copiarlo al ledger.
Nunca se guardan mensajes completos, cabeceras, clave, stacks ni texto de respuesta.

Diagnóstico capturado en el calentamiento de MiMo de expansion-2 (no explica
retroactivamente el intento anterior):

```json
{
  "failurePhase": "http",
  "httpStatus": 400,
  "providerErrorCode": "unsupported_reasoning_effort",
  "providerErrorType": "invalid_request_error"
}
```

Cada llamada se reserva y persiste antes del POST. Si el coste no se informa,
se conserva la reserva máxima, incluso en un error. Si el error informa coste,
se contabiliza y se compara con lo reservado. Las reglas de expansion-2 son:

- Fallo de calentamiento: registra el diagnóstico y omite las seis medidas de
  ese modelo. Sigue con el siguiente modelo, sin reintentar el mismo intento.
- Fallo de una medida: registra el diagnóstico y omite los envíos pendientes
  de ese modelo. Continúa los otros modelos, sin rellenar parejas incompletas.
- HTTP 401 o 402: detiene toda la tanda antes del siguiente envío.
- Coste informado superior a la reserva o al dólar: detiene toda la tanda.
  No puede deshacer un cargo ya ocurrido.

Los controles de saldo y persistencia siguen siendo obligatorios: no se envía
si una reserva supera el saldo o no se pudo guardar. No hay fallback ni cambios
de esfuerzo automáticos. Un error no autoriza borrar la cerradura o reanudar.
El calentamiento prepara la caché, pero no garantiza un hit o vigencia; cachedTokens
permite observarlo. Medio solicitado tampoco asegura el mismo razonamiento efectivo.

## Directorios, credencial y salida

Entrada de ejecución: [price-pilot-expansion-2.mjs](../scripts/price-pilot-expansion-2.mjs).
Implementación: [price-pilot-expansion.mjs](../scripts/price-pilot-expansion.mjs).
El directorio nuevo es `.sandbox/pilot/expansion-2`. No se borran ni escriben los
ledgers, resultados o locks anteriores de DeepSeek y expansion. La modalidad por
defecto calcula estimate.json offline. --execute requiere NANOGPT_API_KEY exportada
y PRICE_PILOT_APPROVAL igual al hash exacto; la clave solo va en Authorization al
POST fijo de NanoGPT, con redirecciones rechazadas. Si falta la clave, aborta.

Los resultados se escriben tras cada reserva, resultado o salto en
`.sandbox/pilot/expansion-2/results.json`; ledger.json y execution.lock pertenecen
exclusivamente a esa tanda. El lock usa creación exclusiva y permanece después
de acabar o fallar. El coste global incluye el total anterior. skippedModels y
skippedRequests registran lo omitido con status=not_sent y sin coste nuevo.
status=finished_with_skips significa tanda procesada con muestras incompletas,
no éxito de los cuatro modelos. Los calentamientos llevan measured=false y
tiempos no medidos; el resto conserva primer texto, total, tokens, cachedTokens,
reasoningTokens, finishReason y coste informado o desconocido.

No se completa un n=3 si se omitieron llamadas. No se concluye sobre p90 con esta
muestra; tampoco sobre causalidad, factura o experiencia completa de la app.
El fallo anterior de MiMo continúa sin causa verificable; la nueva captura no
reconstruye retroactivamente los diagnósticos que se perdieron.

## Tests y comando ejecutado por el usuario

[price-pilot-expansion-2.test.ts](../tests/price-pilot-expansion-2.test.ts) usa solo
fetch simulado: cinco fases, filtrado de code/type/clave, saldo previo único,
salto de modelo con 400 o fallo de una medida, 401/402 globales, coste superior
a reserva en éxito y error SSE, y ausencia de reintentos o alteración de antecedentes.
Un test de archivos temporales verifica que los locks y ledgers anteriores
permanecen byte por byte, que la reserva precede al POST y que un segundo proceso
no vuelve a enviar. Todos los envíos de esos tests usan fetch simulado.
Los [tests anteriores](../tests/price-pilot-expansion.test.ts) conservan el piloto
original y la cobertura de calentamiento, streaming y presupuestos.

Nuevo hash (no vale el de expansion):

```text
b1bb89422248e85e5883869a6d913b83c501d64e3a064f8e83015f334bd891ff
```

Comando ya ejecutado por el usuario con su clave exportada:

```bash
cd '/home/samuel/Documentos/Projects/My New App/ogs-price-auth'
PRICE_PILOT_APPROVAL=b1bb89422248e85e5883869a6d913b83c501d64e3a064f8e83015f334bd891ff node scripts/price-pilot-expansion-2.mjs --execute
```

Estado: finished_with_skips. No volver a ejecutar: el lock se conserva.


## Resultados observados el 2026-10-05

Fuente local: `.sandbox/pilot/expansion-2/results.json`, hash de aprobación anterior.
Se enviaron 22 llamadas: cuatro calentamientos (uno fallido) y 18 medidas.
Grok, GPT Luna y GLM completaron tres parejas cada uno; MiMo tiene cero parejas.
Sus seis medidas quedaron not_sent tras HTTP 400 / unsupported_reasoning_effort /
invalid_request_error. No hubo reintentos. El error confirma el rechazo de medium
para esa petición; no determina qué ocurrió en el intento anterior sin diagnóstico.

Coste informado por el proveedor en las 21 llamadas terminadas: **USD 0.16423365**.
El calentamiento de MiMo no informó coste: se contabiliza su reserva de USD 0.004844,
sin afirmar que se cobró. El redondeo conservador a microdólares da USD 0.169083
adicionales; con USD 0.008864 previos, el total global contabilizado es
**USD 0.177947**, por debajo del tope de USD 1.00. No se verificó una factura.

| Modelo | Parejas | Coste informado, incluido calentamiento (USD) | Medidas con cachedTokens > 0 |
| --- | ---: | ---: | ---: |
| MiMo V2.6 Flash | 0 | desconocido | sin muestras |
| Grok 4.7 | 3 | 0.14633800 | 6/6 |
| GPT 6 Luna | 3 | 0.00669355 | 4/6 |
| GLM 5.3 Flash | 3 | 0.01120210 | 1/6 |

Medianas descriptivas de las tres peticiones distintas por brazo, en segundos;
no son tres repeticiones del mismo caso. Los calentamientos se excluyen.

| Modelo | Primer texto control | Primer texto aviso | Total control | Total aviso |
| --- | ---: | ---: | ---: | ---: |
| Grok 4.7 | 11.33 | 10.28 | 12.46 | 11.37 |
| GPT 6 Luna | 3.58 | 4.37 | 3.70 | 4.82 |
| GLM 5.3 Flash | 8.90 | 27.66 | 10.44 | 32.45 |

El aviso añadió 44–55 tokens de entrada por pareja (mediana 51), aproximadamente
50 tokens. Grok mejora en la primera pareja y empeora en las dos continuaciones.
Luna tiene primer texto y total mayores con aviso en las tres parejas; el primer
texto aumenta 0.03, 1.42 y 0.79 s. GLM tiene primer texto casi idéntico en la primera
pareja, pero 44.94 frente a 8.90 s al continuar y 27.66 frente a 8.51 s al cancelar.
En GLM, una de seis medidas supera 30 s hasta el primer texto (16.7 %) y dos
superan 30 s hasta terminar (33.3 %); Grok y Luna tienen cero en ambos campos.
No corresponde afirmar «sin retraso sistemático observable» para esta ampliación.
El piloto DeepSeek anterior mantiene su resultado propio; no se agrupa con estos.

El calentamiento no igualó la caché: Grok conserva solo 1152 tokens en el primer
control frente a 16256 con aviso, pese al calentamiento idéntico. GLM muestra
cero en cinco de seis medidas; Luna alterna aciertos y ceros. Hay aciertos con
aviso, pero la conservación de la caché depende del proveedor y no está garantizada.
La igualdad del prefijo se acredita por los tests de contexto, no por estos hits.

Todas las peticiones solicitaron medium y max_tokens=2000. Las 21 terminadas
informaron finishReason=stop; ninguna declaró agotamiento del límite. El esfuerzo
efectivo permanece desconocido en todos los modelos; Luna informó cero tokens de
razonamiento en sus siete llamadas. No se equipara medium solicitado a efectivo.

Con n=3 parejas heterogéneas, orden alternado, caché desigual y salidas de distinta
longitud/razonamiento, no se estima p90 ni se atribuye causalidad al aviso. Tampoco
se demuestra el criterio de ausencia de empeoramiento consistente o la experiencia
completa de 12–30 s de la app. Las primeras respuestas medidas: Grok 15.06/7.08 s,
Luna 2.83/2.86 s y GLM 15.69/15.69 s (control/aviso). Son tiempos del primer texto
en el stream del script, no una prueba visual de presentación en la app.

## Métricas por llamada

Orden de envío preservado. C = control; A = aviso; cal = calentamiento;
primera = primera respuesta; seguir/cancelar = continuación correspondiente.
Tiempos en segundos; entrada/salida y caché son tokens informados por el proveedor.
Los calentamientos no miden latencia. La única llamada fallida tiene campos
faltantes desconocidos; su reserva no se presenta como coste informado.

| Modelo | Caso/brazo | Primer texto s | Total s | Entrada | Salida | cachedTokens | Coste informado USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MiMo | cal | no medido | no medido | desconocido | desconocido | desconocido | desconocido |
| Grok 4.7 | cal | no medido | no medido | 16356 | 1146 | 1152 | 0.03786 |
| Grok 4.7 | primera / C | 15.06 | 19.95 | 16356 | 1181 | 1152 | 0.03807 |
| Grok 4.7 | primera / A | 7.08 | 9.00 | 16407 | 582 | 16256 | 0.011922 |
| GPT 6 Luna | cal | no medido | no medido | 13452 | 59 | 0 | 0.001710925 |
| GPT 6 Luna | primera / C | 2.83 | 3.37 | 13452 | 52 | 13449 | 0.00016079 |
| GPT 6 Luna | primera / A | 2.86 | 4.26 | 13507 | 50 | 13449 | 0.000166665 |
| GLM 5.3 Flash | cal | no medido | no medido | 14992 | 280 | 0 | 0.0015832 |
| GLM 5.3 Flash | primera / C | 15.69 | 20.47 | 14992 | 394 | 0 | 0.0016174 |
| GLM 5.3 Flash | primera / A | 15.69 | 17.71 | 15044 | 466 | 14976 | 0.000521 |
| Grok 4.7 | seguir / A | 10.28 | 11.37 | 18663 | 693 | 16256 | 0.0171 |
| Grok 4.7 | seguir / C | 8.41 | 9.92 | 18610 | 575 | 18560 | 0.01283 |
| GPT 6 Luna | seguir / A | 5.81 | 6.86 | 15760 | 51 | 0 | 0.001995425 |
| GPT 6 Luna | seguir / C | 4.39 | 5.04 | 15705 | 60 | 13245 | 0.000469875 |
| GLM 5.3 Flash | seguir / A | 44.94 | 51.81 | 17296 | 421 | 0 | 0.0018559 |
| GLM 5.3 Flash | seguir / C | 8.90 | 10.44 | 17252 | 327 | 0 | 0.0018233 |
| Grok 4.7 | cancelar / C | 11.33 | 12.46 | 18610 | 604 | 18560 | 0.013004 |
| Grok 4.7 | cancelar / A | 12.82 | 14.12 | 18657 | 1013 | 18560 | 0.015552 |
| GPT 6 Luna | cancelar / C | 3.58 | 3.70 | 15705 | 62 | 0 | 0.00199405 |
| GPT 6 Luna | cancelar / A | 4.37 | 4.82 | 15753 | 65 | 15702 | 0.00019582 |
| GLM 5.3 Flash | cancelar / C | 8.51 | 10.31 | 17244 | 464 | 0 | 0.0018636 |
| GLM 5.3 Flash | cancelar / A | 27.66 | 32.45 | 17289 | 696 | 0 | 0.0019377 |

## Evidencia y cierre

Lectura offline: resultados y ledger de expansion-2 coherentes, 22 IDs únicos,
seis omisiones y total de 177947 microUSD. Código: el salto por fallo y el bloqueo
de repetición siguen en el runner existente; esta revisión solo cambia docs.
Tests: npm test -- --maxWorkers=2, 627 aprobados y cinco omitidos; salvaguardas y
check-docs en verde (33 archivos, máximo 29562 bytes).
Sandbox: peticiones sintéticas capturadas por el test existente, sin sesión real
ni prueba visual nueva. Proveedor: ejecución realizada por el usuario, examinada
a través de las métricas locales. Codex no lanzó llamadas nuevas. No se verificaron
factura, esfuerzo efectivo, p90 ni causalidad de los tiempos; no se fusionó la rama.


## Medición cerrada: razonamiento, variación y caché

No se harán más llamadas al proveedor para esta medición. Los tiempos incluyen
el razonamiento antes del primer texto y la variación del servicio. Estos datos
no permiten afirmar que la latencia siga proporcionalmente el número de tokens:
GLM tuvo 15.69/15.69 s en la primera pareja con 243/352 tokens de razonamiento,
y la continuación de 44.94 s tuvo solo 135 tokens (el control: 8.90 s y 39).
Grok pasó de 15.06 s y 1116 tokens a 7.08 s y 459 en la primera pareja, pero también
cambió la caché. La cantidad de razonamiento es un factor compatible con algunos
resultados; no explica por sí sola el caso de GLM ni demuestra la causa del retraso.
La variación del proveedor/ruta/caché sigue siendo una explicación posible,
sin separar experimentalmente esos factores. Se conserva el límite de n=3.

El aviso conserva el prefijo y permite reutilizar la caché: en la pareja Cancelar
de Grok, cachedTokens=18560 tanto en control como con aviso; en la primera de
Luna, 13449 en ambos. Luna Cancelar con aviso informó 15702 y GLM primera con
aviso 14976. Son aciertos observados, no una garantía para todas las llamadas;
los ceros y el calentamiento desigual siguen documentados arriba. El test del
prefijo acredita que el aviso no reescribe el historial anterior.

## Hallazgo de código: MiMo puede recibir un esfuerzo rechazado

Lectura estática, sin corregir ni hacer peticiones nuevas. El selector
[SettingsPanel.tsx](../src/components/shell/SettingsPanel.tsx) ofrece None, Low,
Medium y High para NanoGPT sin restringirlos por modelo. El catálogo de
[llm.ts](../src/engine/providers/llm.ts) guarda reasoning como capacidad booleana,
pero no una lista de esfuerzos admitidos. [runtime.ts](../src/engine/agent/runtime.ts)
pasa settings.agent.effort a chat. reasoningBody recibe el proveedor, no el
modelo, y copia ese valor a reasoning_effort. Por tanto, con MiMo V2.6 Flash
seleccionado y Medium, la app puede enviar el valor rechazado en el piloto:
HTTP 400 / unsupported_reasoning_effort. La configuración inicial también usa Medium.

El adaptador de la app tiene un comportamiento distinto del piloto: ante HTTP 400
con campos de razonamiento, analiza el mensaje; si contiene reason, effort o think,
repite una vez sin esos campos. No usa error.code para decidir ese fallback.
[agent-thinking.test.ts](../tests/agent-thinking.test.ts) cubre este segundo envío
con un mensaje simulado, no con el error real de MiMo. El diagnóstico seguro del
piloto no conserva el mensaje, así que no confirma si ese fallback habría actuado
con la respuesta real. Puede haber un primer envío rechazado y una llamada extra;
si el mensaje no coincide, la app propaga el error. No se modificó este código.

La [prueba manual sin gasto](price-review-sandbox.md) permite pulsar Continuar y
Cancelar con un paso sintético y comprobar el contexto mediante respuestas simuladas.
