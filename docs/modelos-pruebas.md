# Pruebas de modelos y prompting (las hace el usuario)

Comprueban si los modelos **responden al prompting** de la app. Separado de [fluidez-pruebas.md](fluidez-pruebas.md) (rendimiento). Contexto: [037](history/037-2026-10-W42.md), [investigación](investigacion-prompting-referencias.md). Rama `task/ref-roles`, solo sandbox (`npm run dev:sandbox`, puerto 5183). Cada casilla: **hacer → esperar**. 💲 = cuesta dinero: fijar antes un coste máximo y modelo concretos; sin aprobación no se ejecuta.

## Estilos (💲 todas)

- [ ] 2D / ilustración / anime: pedir un personaje → sale estilizado, sin look de foto.
- [ ] 3D / CGI: → render 3D, sin piel fotográfica.
- [ ] Fotorrealista: → foto creíble.
- [ ] UGC smartphone: → aspecto de móvil, no de estudio.
- [ ] Estudio de producto: → fondo limpio, luz de estudio.
- [ ] Vector Recraft: → vectorial plano; paleta respetada.
- [ ] Cartel Ideogram: → texto legible; el JSON no se rompe.

## Realismo (💲)

- [ ] Generación nueva sin estilo → fotográfico por defecto.
- [ ] Edición de una fuente estilizada → conserva el estilo, no pasa a foto.
- [ ] Con ref de estilo, JSON o vocabulario fotográfico → sin cláusula de realismo añadida.
- [ ] Boceto («sketch») → render fotorrealista: se obtiene render, no se queda en boceto.

## Roles de referencia (💲)

- [ ] Un caso por rol: identity, pose, style, lighting, clothing, expression, background → cada ref aporta solo su rol.
- [ ] Frase «Image N» frente a la sintaxis propia de cada modelo (flux, nano-banana) → se respeta la referencia correcta.
- [ ] Qwen «Image N» frente a «Figure N» → ver cuál obedece mejor.
- [ ] Grok «this» frente a índice → ídem.

## Operaciones (💲)

- [ ] angle y hoja de contactos → cambia la cámara y conserva la identidad.
- [ ] relight con y sin ref de luz → la luz cambia; con ref copia la de la ref.
- [ ] replace_background → fondo nuevo, sujeto intacto.
- [ ] Pose / ropa / expresión por ref → solo cambia lo pedido.

## Guías (💲)

- [ ] flux, krea, nano-banana, seedream, gpt-image, ideogram, recraft, qwen-image, grok-imagine-image: un prompt cada uno → ¿se sigue la guía (orden, longitud, formato)? Anotar desvíos.

## Precios

- [ ] Precio de imagen de OpenRouter → aparece «cargando» y luego el valor en el selector; el estimador lo usa. Gratis (solo catálogo).
- [ ] Vídeo con tarifa no reconocida → se muestra como nota, no como precio. Gratis.
- [ ] Atlas → precio exacto previo (model/calculate). Gratis.
- [ ] Coste real de una generación OpenRouter frente a `usage.cost` 💲 (mínima).

## Latencia del agente con OpenRouter (💲 mínima)

- [ ] Mensaje corto al agente → ~5 s esperado. Si son 10–30 s, anotar modelo, proveedor y hora (`agentMetrics` aún no los guarda).

## Realismo: fichas de toma 💲

- [ ] Comparar la cláusula antigua («plausible lens optics…») con las fichas de toma en Nano Banana, Seedream y GPT Image: ≈12 imágenes (4 escenas × 3 modelos), mismo prompt, mirar el «look IA». Coste: 12 imágenes.

## Pendiente de este bloque

Prueba visual de ambas ramas en sandbox (ninguna hecha); 5c: cómo se ven en ajustes los esfuerzos no admitidos; un paso `op` del plan aún no admite `realism` explícito; añadir fecha/modelo/proveedor a `agentMetrics`.
