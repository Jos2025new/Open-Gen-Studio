# 065: persistencia en SQLite, mediciones y pruebas (2026-11-15)

Historial de cómo se llegó a la [propuesta B+A](../propuesta-persistencia-sqlite.md), en orden. Evidencia, no estado
actual. Cifras completas en [spike/sqlite/RESULTADO.md](../../spike/sqlite/RESULTADO.md) (rama `task/sqlite-spike`).
Fable orquestó; nadie tocó la persistencia real, `data/` ni el sandbox.

## Origen

El usuario pidió que la biblioteca no pierda nada: originales intocables, historial de cambios y reversión como en
Google Fotos o Fotos del iPhone, y pocos registros clave en texto plano (generaciones, gastos, logs). Advirtió que un
mal sistema de registros puede hacer estragos y que no debía hacerse a la ligera. Después propuso «SQL + JSON
flexible» y pidió que la interfaz siga volando y que sirva para escritorio y móvil.

## Secuencia

| # | Qué se hizo, quién | Por qué | Qué reveló |
|---|---|---|---|
| 1 | Búsqueda en docs, transcript y código (Haiku) | Saber si ya estaba investigado | No había plan ni investigación. Editar con una operación crea un asset nuevo, pero el asset no guarda su origen, no hay historial y un blob reescrito pierde los bytes viejos |
| 2 | Investigación de registros (Haiku) | Referencias y fallos que evitar | Primera versión débil: fragmentos de búsqueda, darktable desde foros, Krea, Higgsfield y OpenArt sin mirar |
| 3 | Rehecha con fuentes primarias (Haiku) | El usuario: «darktable es código libre… que lo haga bien» | Esquema y sidecars de darktable leídos en su código; Apple y Google de sus páginas; comparación de motores, con SQL + JSON. Lightroom sigue sin verificar (403) |
| 4 | Investigación de UI rápida (Haiku) y diagnóstico de la persistencia actual (Haiku) | El usuario dudó de que la UI no notara el servidor | La UI ya trabaja en memoria y no espera al servidor. Hallazgo: `store-v2.js` escribe sesiones y después HEAD sin transacción |
| 5 | Ronda 1 del spike (Haiku), solo archivos nuevos | Medir antes de proponer | Seguridad: formato 2 a medias 3 y 6 de 100 cortes; SQLite 0. Velocidad: SQLite 20 veces más lento |
| 6 | Supervisión (Fable) | Separar SQLite del diseño | La lentitud venía de reescribir los 25 MB de `globals` en cada guardado y guardar copias dentro de la base |
| 7 | Ronda 2 (Haiku), intercalada A/B y perfilada | El usuario: distinguir carga del equipo, interferencia o diseño | Carga baja (Brave, medio núcleo). SQLite gana en edición (36 frente a 60 ms) y gesto; pierde en arranque (231 frente a 90 ms) por diseño |
| 8 | Fable propuso adoptar la ronda 2 tal cual; el usuario pidió resolverlo bien con un Sonnet sin contexto | «¿No estás sobrecomplicando?», y después la ronda 3 | — |
| 9 | Ronda 3 (Sonnet), variantes A, B y C | Arranque y memoria | **Fuga:** el diseño de la ronda 2 crecía 24,5 MB por guardado (733 MB); la recomendación de Fable era errónea. B arregla la memoria; B+A, el arranque |
| 10 | Ronda 4 (Argon, cuenta nueva de Gemini, con permiso para delegar en Hydrogen) | Medir B+A, rebase tras 409, cortes de red y migración | B+A gana en todo salvo disco (+53 MB). 0 de 100 a medias; 300 pasos aleatorios sin pérdidas ni duplicados; migración verificada por huella |
| 11 | Propuesta escrita (Fable) | El usuario: «Escríbela» | [propuesta-persistencia-sqlite.md](../propuesta-persistencia-sqlite.md), sin autorizar |
| 12 | Revisión independiente (Grok en Cursor, por el bus; el usuario le pasó el encargo) | Regla 5 antes de cualquier fase | 4 fallos en el spike (409 que ya no frena, rebase que pisa ediciones concurrentes, reorden de biblioteca perdido, migración relanzada que borra lo nuevo) y cifras de la propuesta mal citadas por Fable |
| 13 | Arreglos de los cuatro hallazgos (Grok, `46d8f9db`); Fable volvió a correr los tests y comparó sus nombres | Cerrar la revisión | El 409 conserva la copia local y no pisa; el orden de biblioteca y sesiones se guarda; una segunda migración se detiene sin borrar. 19/19 tests; 30 cortes: 23 correctos, 7 antes del primer guardado, 0 a medias, 0 perdidos |

## Problemas y cómo se resolvieron

- **Investigación superficial** (paso 2): se pidió rehacerla con código y páginas oficiales, marcando V solo con la fuente
  leída.
- **Diseño ingenuo del spike** (ronda 1): Fable leyó el código del spike, encontró la causa y la ronda 2 la corrigió.
- **Ruido de medición:** rondas intercaladas con orden rotado, mediana y rango, y una foto de la carga antes y después.
- **Recomendación prematura de Fable** (paso 8): la ronda 3 la desmintió con la fuga de memoria.
- **Tiempo:** Argon recibió primero 90 minutos. El usuario fijó la regla: 30 minutos y como mucho dos extensiones de 15,
  solo si avanza. Un supervisor reanuda la misma conversación para cada extensión.
- **Red:** Argon sufrió tres cortes de red (TLS) y una extensión que no reconoció el modelo. Entregó en un último tramo
  sin código nuevo, a las 14:57, unos minutos tarde.
- **Delegación:** Argon no delegó en Hydrogen; lanzó pruebas en segundo plano y esperó avisos, contra el encargo.

## Pendiente

Volver a medir las cifras de B+A con los arreglos (el envío ahora lleva el orden).

Autorización del usuario por fases, revisión independiente de cada fase y prueba con datos reales del usuario.
