# Piloto NanoGPT — resultados y límites

Preparación: 2026-10-04. Lectura de resultados: 2026-10-05.
Sustituye el plan rechazado de 160 llamadas. El usuario ejecutó el piloto y comunicó
su finalización; esta revisión solo lee sus resultados, sin nuevas llamadas.

## Alcance

Solo `deepseek/deepseek-v4.1-flash`: 3 parejas control/aviso, **6 llamadas**.
Pareja 1: primera respuesta. Pareja 2: continuación con Continuar.
Pareja 3: continuación con Cancelar. Orden A/B, B/A, A/B.
GPT Luna queda bloqueado en el script; sus otras 6 llamadas requieren autorización
posterior. El límite global del piloto sigue siendo **USD 0.05**, no por modelo.
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
No se evaluó GPT Luna ni otros modelos, cargas, sesiones históricas o un flujo
visual completo. El piloto envía cuerpos sintéticos capturados del agente;
no ejecuta herramientas ni generaciones de activos. Por ello, la caché observada
complementa los tests del prefijo, pero no demuestra por sí sola igualdad de
prefijos ni comportamiento completo de la app. No se aprobó ni ejecutó otra tanda.

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
El presupuesto es compartido: no se reinicia para una futura etapa de GPT Luna.

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
Sin autorización para llamadas adicionales.**
