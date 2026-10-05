# Piloto NanoGPT — pendiente de aprobación

Fecha: 2026-10-04. Sustituye el plan rechazado de 160 llamadas.
No se ha enviado ninguna llamada de generación.

## Alcance

Solo `deepseek/deepseek-v4.1-flash`: 3 parejas control/aviso, **6 llamadas**.
Pareja 1: primera respuesta. Pareja 2: continuación con Continuar.
Pareja 3: continuación con Cancelar. Orden A/B, B/A, A/B.
GPT Luna queda bloqueado en el script; sus otras 6 llamadas requieren autorización
posterior. El límite global del piloto sigue siendo **USD 0.05**, no por modelo.
No se sacarán conclusiones sobre p90 con esta muestra.

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

Tarifas del catálogo público consultado en esta sesión: entrada 0.13 USD/M y salida
0.52 USD/M, sin descuentos por caché o suscripción.
Fuente: [catálogo NanoGPT](https://nano-gpt.com/api/v1/models?detailed=true).
Cálculo por llamada: `(tokensEntrada × 0.13 + 500 × 0.52) / 1000000`,
redondeado hacia arriba al microdólar. Es un máximo **presupuestado por el método
aproximado solicitado**, no una medición de tokens facturados por NanoGPT.

## Script y tope

[price-pilot.mjs](../scripts/price-pilot.mjs) se ejecuta por defecto en modo
estimación, sin red: `node scripts/price-pilot.mjs`.
La ejecución requiere autorización explícita para el hash del manifiesto y
`NANOGPT_API_KEY` exportada en la terminal; no se ha activado esa modalidad.
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
No se concluye sobre p90, caché efectiva ni experiencia de producción con 3 pares.
[Tests de presupuesto y streaming](../tests/price-pilot-budget.test.ts).
[Tests de credencial, destino, reservas y ausencia de reintentos](../tests/price-pilot-execution.test.ts)
usan una clave ficticia y fetch simulado; no invocan NanoGPT.

Solo después de revisar y aprobar el script, con la variable ya exportada:

```bash
cd '/home/samuel/Documentos/Projects/My New App/ogs-price-auth'
PRICE_PILOT_APPROVAL=264802108a2de6eaf654af8cf94feef95c73fa074ea3f1189ac1fe610f4b19ba node scripts/price-pilot.mjs --execute
```

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

**Esperando aprobación únicamente para las 6 llamadas de DeepSeek,
USD 0.027970 calculados, con tope global de USD 0.05.**
