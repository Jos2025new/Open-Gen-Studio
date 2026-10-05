# Piloto NanoGPT — resultados y límites

Preparación: 2026-10-04. Lectura de resultados: 2026-10-05.
Sustituye el plan rechazado de 160 llamadas. El usuario ejecutó el piloto y comunicó
su finalización; esta revisión solo lee sus resultados, sin nuevas llamadas.

## Alcance

Solo `deepseek/deepseek-v4.1-flash`: 3 parejas control/aviso, **6 llamadas**.
Pareja 1: primera respuesta. Pareja 2: continuación con Continuar.
Pareja 3: continuación con Cancelar. Orden A/B, B/A, A/B.
GPT Luna quedó bloqueado en el ejecutor original. El primer piloto usó un límite
global de **USD 0.05**, no por modelo; la ampliación aprobada figura al final.
No se sacarán conclusiones sobre p90 con esta muestra.

## Resultado del proveedor: 3 parejas, 6 llamadas

Fuente local: `.sandbox/pilot/results.json`, estado `finished`, modelo y hash de
aprobación iguales al manifiesto preparado. Las seis llamadas terminaron y todas
informaron coste. El archivo contiene métricas, sin conversaciones ni credenciales.
Los tiempos siguientes están en segundos, redondeados a tres decimales; el coste
se conserva con la precisión informada. La tabla sigue el orden de envío.

| Caso / brazo | Primer texto s | Total s | Tokens entrada | Tokens salida | cachedTokens | Coste informado USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Primera / control | 5.413 | 7.851 | 15385 | 321 | 0 | 0.00228872 |
| Primera / aviso | 4.179 | 8.371 | 15436 | 500 | 15104 | 0.0003199168 |
| Continuar / aviso | 4.316 | 7.753 | 17749 | 394 | 15104 | 0.0005992168 |
| Continuar / control | 2.990 | 6.672 | 17698 | 366 | 17408 | 0.0002674336 |
| Cancelar / control | 4.602 | 5.629 | 17698 | 334 | 17408 | 0.0002539936 |
| Cancelar / aviso | 4.119 | 7.363 | 17742 | 401 | 17408 | 0.0002882936 |

**Coste total informado: USD 0.0040175744 (0.40175744 centavos).**
El ledger contabiliza USD 0.004020 al redondear cada llamada hacia arriba al
microdólar. Ambos quedan por debajo de USD 0.027970 presupuestados y del límite
local de USD 0.05. Autorizado o reservado no significa cobrado: estos importes
informados por el proveedor tampoco son una auditoría de la factura o suscripción.

El aviso añadió **51, 51 y 44 tokens de entrada**, unos 50 por petición, según
los tokens del proveedor. Las tres peticiones con aviso conservaron uso de caché:
15104, 15104 y 17408 tokens. En la pareja Cancelar, ambos brazos informaron
17408 tokens cacheados. No significa que la tasa de caché sea idéntica en todos
los casos: el primer control fue frío (0), y el orden calienta la caché para
las llamadas siguientes. La caché depende del proveedor, su granularidad y vigencia;
no se añadieron controles `cache_control`.

| Mediana descriptiva, n=3 por brazo | Primer texto s | Total s |
| --- | ---: | ---: |
| Control | 4.602 | 6.672 |
| Aviso | 4.179 | 7.753 |

En el **primer texto** no se observa un retraso sistemático en estas tres parejas:
aviso menos control = -1.235 s, +1.325 s y -0.483 s. El **tiempo total** sí fue
mayor con aviso en las tres parejas: +0.520 s, +1.081 s y +1.734 s. Las salidas
también fueron más largas con aviso (500/394/401 frente a 321/366/334 tokens),
por lo que no puede atribuirse ese aumento al aviso con esta muestra.
Ninguna de las seis llamadas superó 30 s, ni en primer texto ni en finalización (0/6).

Límites: solo una pareja por caso, n=3 por brazo; sin inferencia sobre p90,
significancia, equivalencia ni estabilidad de latencia. El primer texto quedó
entre 2.990 y 5.413 s en estas fixtures; no valida la experiencia de 12–30 s
en sesiones reales. La salida de primera/aviso alcanzó max_tokens=500, y este
archivo no permite determinar si la respuesta fue semánticamente completa.
En estos seis resultados no se evaluó GPT Luna ni otros modelos, cargas, sesiones históricas o un flujo
visual completo. El piloto envía cuerpos sintéticos capturados del agente;
no ejecuta herramientas ni generaciones de activos. Por ello, la caché observada
complementa los tests del prefijo, pero no demuestra por sí sola igualdad de
prefijos ni comportamiento completo de la app. Al leer estos resultados todavía
no se había aprobado ni ejecutado otra tanda.

Evidencia diferenciada: [script revisado](../scripts/price-pilot.mjs),
[captura offline en sandbox](../tests/price-pilot-capture.test.ts),
[tests del prefijo y entrega al modelo](../tests/price-agent-notes.test.ts),
y resultados reales del proveedor en el archivo local anterior, generado por el usuario.

## Captura y estimación sin gasto

El [test de captura](../tests/price-pilot-capture.test.ts) ejecuta el runtime real
con sesiones sintéticas en memoria, persistencia y fetch simulados. Conserva system,
tools y contexto del agente. Para construir una continuación, la llamada anterior
y el resultado local de read_guide se simulan; no hay warmup de pago.
Los cuerpos se guardan solo en `.sandbox/pilot/requests.json`; no se extraen
conversaciones ni credenciales del almacén real. No se modifica `.sandbox/data`.
No es una muestra de conversación histórica: es una petición real construida por
el cliente para estas fixtures reproducibles del sandbox.

Por instrucción del usuario, no se usa tokenizer. Se cuentan los caracteres Unicode
del JSON compacto que se enviaría, con **max_tokens 500** en todos los brazos:

`tokensEntrada = ceil(caracteres(JSON.stringify(body)) / 3 × 1.50)`.

La salida futura no se puede observar sin llamar al modelo. Se reserva su límite
completo de 500 tokens; no se presenta una respuesta simulada como salida real.
El cliente de producción y el aviso de prisa no se modifican en esta preparación.

| Caso | Brazo | Caracteres | Tokens entrada estimados, con margen | Salida máxima | Máximo calculado USD |
| --- | --- | ---: | ---: | ---: | ---: |
| Primera respuesta | control | 61200 | 30600 | 500 | 0.004238 |
| Primera respuesta | aviso | 61375 | 30688 | 500 | 0.004250 |
| Continuación / Continuar | control | 70841 | 35421 | 500 | 0.004865 |
| Continuación / Continuar | aviso | 71016 | 35508 | 500 | 0.004877 |
| Continuación / Cancelar | control | 70841 | 35421 | 500 | 0.004865 |
| Continuación / Cancelar | aviso | 70994 | 35497 | 500 | 0.004875 |
| Total | 6 llamadas | | 203135 | 3000 | **0.027970** |

Tarifas del catálogo público consultado en la preparación del 2026-10-04: entrada 0.13 USD/M y salida
0.52 USD/M, sin descuentos por caché o suscripción.
Fuente: [catálogo NanoGPT](https://nano-gpt.com/api/v1/models?detailed=true).
Cálculo por llamada: `(tokensEntrada × 0.13 + 500 × 0.52) / 1000000`,
redondeado hacia arriba al microdólar. Es un máximo **presupuestado por el método
aproximado solicitado**, no una medición de tokens facturados por NanoGPT.

## Script y tope

[price-pilot.mjs](../scripts/price-pilot.mjs) se ejecuta por defecto en modo
estimación, sin red: `node scripts/price-pilot.mjs`.
La ejecución requiere autorización explícita para el hash del manifiesto y
`NANOGPT_API_KEY` exportada en la terminal. El usuario ejecutó esa modalidad;
esta revisión no la ejecuta ni solicita credenciales.
La clave se lee únicamente de esa variable. Si falta, aborta antes de leer o
escribir archivos del piloto. No se buscan claves en data/, la app ni archivos
de configuración. Solo se usa en el encabezado Authorization del POST a
`https://nano-gpt.com/api/v1/chat/completions`; las redirecciones se rechazan.
No se imprime, registra ni persiste la clave, ni se reproducen errores del proveedor.
El script solo permite DeepSeek, 6 peticiones y max_tokens 500.

Antes de cada POST, reserva la estimación máxima de esa llamada en un ledger local
persistido y rechaza el envío si supera el saldo restante de **USD 0.05**.
Después sustituye esa reserva por el coste informado; si falta, conserva la
estimación más alta. Ante error, conserva la reserva y se detiene.
Una cerradura exclusiva impide ejecutar dos procesos a la vez; se conserva al
terminar o interrumpir. Los IDs ya intentados no se reenvían.
No hay reintentos, fallback, ejecución de herramientas, cotizaciones ni descargas.
El presupuesto es compartido: la ampliación cuenta lo consumido aquí y requiere
un ejecutor y un manifiesto aprobados aparte.

El margen de caracteres es una estimación, no una garantía de factura del proveedor.
Si el coste informado rebasa la reserva, el script se detiene inmediatamente y no
hace más llamadas; no puede deshacer un cargo ya comunicado por un servicio externo.
El límite local impide **autorizar** envíos por encima del presupuesto calculado.
Una garantía bancaria de cargo requeriría además un límite del lado del proveedor.

Por llamada se guarda: tiempo al primer texto (no razonamiento/herramienta), tiempo
total, tokens de entrada/salida, cachedTokens o desconocido, coste informado o
desconocido, y coste contabilizado. No se guardan textos de respuesta ni claves.
Los resultados se escriben después de cada reserva y resultado en
`.sandbox/pilot/results.json`, incluso si el piloto se interrumpe; el ledger está
en `.sandbox/pilot/ledger.json`. Ambos usan permisos 0600 al crearse.
Los contadores permiten observar uso de caché en esta ejecución, sin generalizar
a otras sesiones, modelos o proveedores. No se concluye sobre p90 ni experiencia
de producción con 3 pares.
[Tests de presupuesto y streaming](../tests/price-pilot-budget.test.ts).
[Tests de credencial, destino, reservas y ausencia de reintentos](../tests/price-pilot-execution.test.ts)
usan una clave ficticia y fetch simulado; no invocan NanoGPT.

La ejecución completada queda bloqueada frente a repeticiones por la cerradura
persistida y los IDs intentados. No se elimina ese bloqueo ni se reinicia el ledger.

## Aviso de prisa de 50 s: explicación, sin cambios nuevos

Antes, pasado el umbral de 50 s, el cliente añadía HURRY_NOTE solo al cuerpo enviado;
no lo persistía en el historial. En la siguiente continuación, la respuesta de la
llamada previa entraba antes del aviso temporal y podía cambiar el prefijo.

Ahora, pasado el mismo umbral, se añade una vez al final del historial del turno.
El texto expresa vigencia hasta la siguiente petición del usuario. El mensaje
system, el umbral y las esperas permanecen como estaban. No se amplió este cambio.

Cobertura: [price-agent-notes.test.ts](../tests/price-agent-notes.test.ts), caso
`continuation preserves the complete prefix and call count (notice=true, hurry=true)`.
Simula 60 s con Date.now, comprueba 3 llamadas, el aviso una sola vez, pares de
herramientas completos y prefijo serializado idéntico en las continuaciones.

**Piloto finalizado: seis llamadas de DeepSeek, USD 0.0040175744 informados.
Las llamadas de la ampliación aprobada aún no se han ejecutado.**

## Ampliación aprobada: cuatro modelos, tope global USD 1.00

Consulta pública del catálogo el 2026-10-05, sin clave ni generación.
El usuario aprobó USD 1.00 el 2026-10-05. Preparación actualizada: tres parejas por
modelo (24 llamadas medidas) más un calentamiento sin medir por modelo (4 llamadas).
Las **28 llamadas** usan max_tokens=2000 y reasoning_effort=medium solicitado.
El cambio de 500 a 2000 y los calentamientos sustituyen el manifiesto anterior.
No se ha
alterado el bloqueo del piloto anterior. El ejecutor original mantiene su límite
de USD 0.05; el nuevo ejecutor aplica USD 1.00 global incluyendo DeepSeek.
No se han enviado peticiones a estos modelos desde esta revisión.

| Modelo / ID exacto | Esfuerzos anunciados | Suscripción según catálogo | Entrada / salida USD por millón | Reserva por tokens, 6 medidas USD |
| --- | --- | --- | ---: | ---: |
| MiMo V2.6 Flash / xiaomi/mimo-v2.6-flash | none, high | Incluido | 0.14 / 0.28 | 0.031800 |
| Grok 4.7 / x-ai/grok-4.7 | low, medium, high, xhigh | Fuera | 1.60 / 4.80 | 0.382565 |
| GPT 6 Luna / openai/gpt-6-luna | none, low, medium, high, xhigh, max | Fuera | 0.10 / 0.50 | 0.026314 |
| GLM 5.3 Flash / z-ai/glm-5.3-flash | low, high, max | Incluido | 0.10 / 0.30 | 0.023914 |

Fuente: [catálogo NanoGPT](https://nano-gpt.com/api/v1/models?detailed=true).
Se serializaron offline las seis fixtures existentes, sustituyendo únicamente
model, reasoning_effort y max_tokens, más una repetición del primer control para
calentar cada modelo. Se aplicó ceil(caracteres Unicode / 3 × 1.50), sin
tokenizer ni descuento de caché/suscripción. Entrada por petición: 30595–30687
tokens estimados en primera respuesta y 35415–35507 en continuación; salida
máxima reservada: 2000, también para el calentamiento. No son tokens medidos de
estos cuatro proveedores.

Las 28 llamadas reservan **USD 0.535709 por tokens**. El catálogo advierte de
cargos de rechazo de Grok de hasta USD 0.055; para no asumir que sustituyen al
cargo de tokens, una contingencia conservadora añade 7 × 0.055 = USD 0.385000.
Techo calculado con esa contingencia: **USD 0.920709 adicionales**, o
**USD 0.924729** contando USD 0.004020 del ledger ya consumido. Sigue siendo
un presupuesto con la aproximación de caracteres, no un límite contractual de
factura. Una sola llamada de Grok ya reserva más de USD 0.05 con estas fixtures;
por ello la ampliación usa el tope global USD 1.00 expresamente aprobado.

| Modelo | 6 medidas, incluidas contingencias USD | Calentamiento, incluida contingencia USD | Total 7 llamadas USD |
| --- | ---: | ---: | ---: |
| MiMo V2.6 Flash | 0.031800 | 0.004844 | 0.036644 |
| Grok 4.7 | 0.712565 | 0.113552 | 0.826117 |
| GPT 6 Luna | 0.026314 | 0.004060 | 0.030374 |
| GLM 5.3 Flash | 0.023914 | 0.003660 | 0.027574 |

Si un manifiesto supera USD 1.00 con la contingencia, el cálculo elimina primero
la contingencia de Grok, conservando las 24 medidas y los 4 calentamientos. Si aun
así supera el dólar, aborta antes de enviar nada. En el manifiesto actual cabe
la contingencia completa; no se ha eliminado. El hash incluye esta selección.

MiMo y GLM no anuncian medium nativo. La [documentación de reasoning](https://docs.nano-gpt.com/api-reference/miscellaneous/extended-thinking)
acepta ese valor en la API, pero indica que algunas rutas adaptan niveles al más
cercano soportado. Enviar medium no demuestra medium efectivo en ambos modelos;
Se envía exactamente medium a los cuatro y se registra por separado el nivel
solicitado y el efectivo desconocido; no se les sustituye esfuerzo o variante.
Los tokens de reasoning se facturan como salida. El límite ahora es 2000 para
dar más margen al texto final, aunque no garantiza que llegue. Se registran
finish_reason y reasoning_tokens si se informan, sin guardar contenido, para
separar ausencia de texto o truncamiento de una respuesta terminada.

No se convierte la comparación entre modelos en una prueba de causalidad: niveles
adaptados, rutas, caché caliente/fría y longitudes de salida siguen siendo límites.

### Ejecutor, revisión y salida

[price-pilot-expansion.mjs](../scripts/price-pilot-expansion.mjs) deriva las 28
peticiones de las fixtures existentes; cambia el modelo, fija medium y max_tokens=2000.
Intercala modelos por caso y usa orden control/aviso, aviso/control, control/aviso.
Antes de la primera pareja de cada modelo envía exactamente una petición de
calentamiento idéntica a su primer control. Se marca measured=false y sus tiempos
son «no medido»; coste, tokens y campos del proveedor sí se contabilizan. Solo las
24 llamadas measured=true forman las muestras de latencia; el orden se guarda.
No dispara herramientas ni reintentos de calentamiento. La preparación reduce
el sesgo inicial de caché fría/caliente, pero no garantiza un hit: ruta, granularidad,
vigencia o eviction dependen del proveedor. Los cachedTokens permiten comprobarlo.
Solo lee `.sandbox/pilot/requests.json` y el ledger completado de DeepSeek.
Valida el hash y la suma del ledger anterior; ese coste se incorpora una vez al
ledger de la ampliación. Ni los archivos ni el bloqueo de DeepSeek se modifican.

El modo por defecto calcula y escribe `.sandbox/pilot/expansion/estimate.json`,
sin red y sin leer claves. La modalidad --execute lee únicamente NANOGPT_API_KEY,
aborta si falta y exige PRICE_PILOT_APPROVAL igual al hash del manifiesto exacto
(peticiones, modelos, precios, configuración y ledger previo). Solo usa el
POST fijo de NanoGPT con redirecciones rechazadas, sin reintentos ni fallback.
No imprime ni persiste claves, encabezados, texto o errores del proveedor.

Antes de cada POST comprueba el saldo global de USD 1.00, reserva el máximo de
esa llamada (incluida la contingencia Grok) y escribe ledger y resultados.
Coste informado sustituye la reserva; si falta, permanece el máximo. Si supera
la reserva o el dólar, se detienen los envíos restantes; el código no puede
deshacer un cargo externo ya ocurrido. Una cerradura exclusiva persistente
impide procesos simultáneos o repetir/reanudar la tanda, incluso después de error.

Resultados: `.sandbox/pilot/expansion/results.json`, con costes previo, adicional
y global, modelo/caso/brazo, tiempos de primer texto y total, tokens entrada/salida,
cachedTokens, reasoningTokens, finishReason, esfuerzo solicitado y efectivo
desconocido, y measured para separar los 4 calentamientos de las 24 muestras.
Los campos ausentes se marcan desconocidos. finishReason=length
permite identificar un límite alcanzado; si solo hay reasoning, primer texto es
desconocido. Una respuesta HTTP terminada no demuestra una respuesta semánticamente
completa. Los JSON de estimación y resultados no incluyen claves ni conversaciones.

Código común: [price-pilot.mjs](../scripts/price-pilot.mjs) para credencial, POST,
streaming y reservas; el límite por defecto del piloto original no aumenta.
[Tests de la ampliación](../tests/price-pilot-expansion.test.ts): 28 envíos simulados
con medium, historial idéntico a las fixtures, contabilidad compartida, clave/destino,
reservas antes del POST, sobrepresupuesto, costes ausentes, rechazo de medium,
truncamiento/solo reasoning, ausencia de reintentos o persistencia de contenido,
2000 tokens de salida, calentamiento idéntico e inmediatamente antes del primer
control, exclusión de sus tiempos y retirada de contingencia antes que parejas.

Comando para la terminal del usuario, después de revisar el script, con la clave
ya exportada localmente (no se solicita en el chat):

```bash
cd '/home/samuel/Documentos/Projects/My New App/ogs-price-auth'
PRICE_PILOT_APPROVAL=f15725ccff3cb65339dd1fd8907affbe29c82d3edb7d2e1d5d07f94c6cb9591d node scripts/price-pilot-expansion.mjs --execute
```

### Intento detenido en el primer calentamiento

El usuario intentó ejecutar el manifiesto anterior. Lectura local el 2026-10-05:
`.sandbox/pilot/expansion/results.json` tiene status=stopped, un único intento
`xiaomi/mimo-v2.6-flash/warmup`, status=uncertain, y **0 llamadas medidas**.
No se informó HTTP, tokens, finishReason ni coste del proveedor. Se conserva
la reserva de USD 0.004844; con DeepSeek, el total contabilizado es USD 0.008864.
Es contabilidad conservadora de un intento incierto, no un cobro confirmado.
El resto de las 27 peticiones no figura como intentado.

La versión ejecutada descartaba el error completo, incluido el código HTTP;
por ello no se puede reconstruir si falló por HTTP, red, timeout o streaming.
No hay evidencia para atribuirlo a medium ni para afirmar que el proveedor no
recibió o cobró la petición. No se reenvió el intento, no se borró la cerradura
y no se modificó el ledger o los resultados para fingir que no ocurrió.
El comando anterior queda bloqueado por esa cerradura; no sirve para reanudar.

Corrección del diagnóstico, sin otra llamada: el código común conserva solamente
failureKind (categorías fijas) y httpStatus (número o desconocido), tanto en el
registro del intento como en el mensaje seguro de salida. Distingue http_error,
transport_error, timeout, missing_stream, invalid_stream, provider_error,
stream_error y local_error. No copia cuerpos de error, mensajes, causas, stacks,
encabezados ni valores arbitrarios del proveedor; no registra claves o contenido.
Los campos nuevos solo existen para futuros fallos, no recuperan este fallo pasado.
El control de presupuesto, hashes de peticiones, ausencia de reintentos y bloqueos
persistentes siguen vigentes.

Los [tests de regresión](../tests/price-pilot-expansion.test.ts) reprodujeron con
fetch simulado la pérdida del diagnóstico y comprueban HTTP 400, transporte,
timeout, JSON inválido y error SSE, además del filtrado de strings sensibles.
Esta corrección está probada localmente; la causa del fallo real permanece sin
verificar. No se ha aprobado ni preparado una repetición del intento incierto.
