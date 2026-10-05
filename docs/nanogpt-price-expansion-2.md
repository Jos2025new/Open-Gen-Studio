# NanoGPT expansion-2 — preparada, sin ejecución

Preparación: 2026-10-05. El usuario solicita una nueva tanda después del fallo del
primer calentamiento de MiMo; conserva el tope global aprobado de USD 1.00.
El [informe anterior](nanogpt-price-comparison.md) documenta los resultados de
DeepSeek y el intento detenido. Esta preparación no hace llamadas al proveedor.

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

Ejemplo con proveedor simulado, no diagnóstico retrospectivo de MiMo:

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

## Tests y comando pendiente

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

Después de revisar, con la clave exportada en la terminal del usuario:

```bash
cd '/home/samuel/Documentos/Projects/My New App/ogs-price-auth'
PRICE_PILOT_APPROVAL=b1bb89422248e85e5883869a6d913b83c501d64e3a064f8e83015f334bd891ff node scripts/price-pilot-expansion-2.mjs --execute
```

Estado: preparado para revisión; no ejecutado por Codex.
