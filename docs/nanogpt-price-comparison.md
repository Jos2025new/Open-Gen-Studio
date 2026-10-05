# Comparación NanoGPT — plan pendiente de aprobación

Fecha de preparación: 2026-10-04. **No ejecutado.** La única consulta remota fue
un GET público del [catálogo NanoGPT](https://nano-gpt.com/api/v1/models?detailed=true),
sin autenticación ni generación. La lectura del sandbox encontró agente offline y
modelo vacío. Se proponen estos IDs concretos, sin alias ni sustituciones:

| Modelo | ID | Entrada USD/M | Salida USD/M | Contexto máximo | Suscripción según catálogo |
| --- | --- | ---: | ---: | ---: | --- |
| DeepSeek V4.1 Flash | deepseek/deepseek-v4.1-flash | 0.13 | 0.52 | 1000000 | incluido |
| GPT 6 Luna | openai/gpt-6-luna | 0.10 | 0.50 | 1050000 | no incluido |

La inclusión depende de la cuenta y las condiciones vigentes; no se presupone coste
cero. El [soporte oficial](https://nano-gpt.com/support) describe caché implícita
dependiente de ruta y modelo, y señala que tokens cacheados consumen cuota de entrada.

## Casos y orden

20 pares por modelo y tipo de sesión: **20 muestras por brazo/modelo/tipo**,
80 peticiones por modelo, **160 llamadas en total**. Cada muestra mide una llamada
streaming del agente, sin ejecución de herramientas ni generaciones multimedia.
No es una medición de un plan multimedia completo.

Se emplean cinco fixtures sintéticas propias, cuatro repeticiones cada una:
Continuar con 0.20 → 1.20; Cancelar; terminado con proveedor 0.73; terminado con
coste desconocido; fallido con coste desconocido. La pregunta común pide explicar
la decisión, la autorización y el coste informado con una respuesta breve.

- Sesión nueva: historial de inicio sintético; ninguna conversación del usuario.
- Continuación: mismo historial sintético con una llamada y respuesta de herramienta
  ya completas. El historial se construye localmente, sin llamada de calentamiento.
- Control A: historial sin el aviso; B: mismo historial más el aviso fijo al final.
  No se modifica el prefijo compartido. No se envía el texto de conversaciones reales.
- Alternar A/B y B/A por pareja y modelo. Dos bloques de 10 pares por cada tipo,
  con orden invertido en el segundo; conservar resultados separados por bloque.
- Una petición por muestra, sin reintentos automáticos, fallback, cotizaciones,
  llamadas auxiliares LLM ni warmup de pago. Si el modelo devuelve solo herramientas,
  no se ejecutan: primer texto visible desconocido; no se elimina esa muestra.

Configuración idéntica entre brazos: endpoint habitual `/api/v1/chat/completions`,
streaming, system y tools actuales, tool_choice auto, reasoning_effort low,
showReasoning false y max_tokens 16000, igual al límite del cliente actual.
No añadir temperature, cache_control, prompt_caching ni selección extra de ruta.
Ejecutar únicamente en el sandbox del worktree, con cliente aislado y credencial
autorizada para ese ensayo. No iniciar el script que copie data/ real.

## COSTE MÁXIMO: USD 22.21

Es un límite deliberadamente conservador calculado con **todo el contexto máximo
de cada modelo en cada llamada**, más 16000 tokens de salida, sin descuento por
caché ni suscripción. No es una predicción del gasto habitual.

Para GPT Luna se usa 0.125 USD/M de entrada, el mayor precio entre entrada normal
y escritura de caché publicado (0.000125 USD/1000); no se activa caché explícita.

| Modelo | Máximo por petición | Peticiones | Máximo subtotal USD |
| --- | ---: | ---: | ---: |
| DeepSeek | (1000000 × 0.13 + 16000 × 0.52) / 1000000 = 0.13832 | 80 | 11.0656 |
| GPT Luna | (1050000 × 0.125 + 16000 × 0.50) / 1000000 = 0.13925 | 80 | 11.1400 |
| Total | | 160 | 22.2056, redondeado hacia arriba a **22.21** |

Antes del primer POST, volver a consultar el catálogo público y verificar IDs,
tarifas, contexto, capacidad de herramientas y que el límite de salida cubre los
tokens facturables, incluido razonamiento. Si cambian los límites o no se puede
verificar ese contrato, detenerse antes de gastar y presentar otro máximo.
No sustituir modelos ni cambiar configuración automáticamente.
Reservar el máximo por petición **antes** del envío. Ante coste desconocido o timeout,
mantener esa reserva, registrar identificador/estado si existe y no repetir el envío.
No generar muestras adicionales para reemplazar fallos. No recargar saldo ni cambiar
la configuración económica de la cuenta como parte de este ensayo.

## Registro y aceptación

Guardar solo modelo/ID, tipo, brazo, bloque, orden, tiempos, llamadas, tokens,
cachedTokens y coste informado. Nada de credenciales ni texto de respuesta en el
informe. Medir primer fragmento de texto, primera salida texto/herramienta y fin del
stream por separado; campos ausentes desconocidos. Registrar llamadas fallidas sin
inventar uso ni coste. Emplear mediana, p90 nearest-rank y porcentaje >30 s con su n
conocido/desconocido, por modelo, tipo, brazo y bloque.

Criterio propuesto para «no empeora consistentemente»: falla si ambos bloques del
mismo modelo/tipo empeoran en mediana más de max(1 s, 10%) o en p90 más de max(3 s,
10%) frente a su control. Un resultado contradictorio o insuficiente se declara
inconcluso, sin gastar en otra ronda automáticamente. La primera respuesta visible
debe conservar mediana y p90 ≤30 s; respuestas más rápidas que 12 s son aceptables.
Informar aparte qué porcentaje queda entre 12 y 30 s y el primer texto visible.
Con 20 muestras por brazo, p90 sigue siendo sensible a pocos casos lentos.

Verificar además que B no aumenta llamadas, y que prefijos/cachedTokens se informan
sin atribuir automáticamente un hit a la implementación. No proclamar aceptación
de la experiencia de la app completa a partir de una sola llamada del modelo.

El [paso 1](agent-baseline.md) tiene 0 muestras: no permite afirmar hoy que se cumple
12–30 s, que hay caché efectiva o que el cambio carece de regresión en NanoGPT.
**Se requiere aprobación explícita de estos modelos, 160 llamadas y USD 22.21
antes de enviar cualquier petición de generación.**
