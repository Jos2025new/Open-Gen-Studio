# Propuesta: conocimiento del agente en archivos y vistas guardadas

2026-10-27, sin implementar. Origen: dos lecturas pedidas por el usuario, [Obsidian como pseudo-base de datos](https://www.roguehistory.ca/blog/re-organizing-obsidianmd-into-a-pseudo-database-manager) y [Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/) (OKF: un `.md` por concepto, frontmatter mínimo con `type`, índices para cargar por partes). Se toman solo las ideas con valor real y riesgo bajo.

## Lo que ya existe (comprobado en código)

- **Búsqueda de texto:** Library busca en prompt, modelo y origen ([GalleryPanel.tsx:135](../src/components/gallery/GalleryPanel.tsx)); Generations, en prompt, modelo y texto ([GalleryPanel.tsx:159](../src/components/gallery/GalleryPanel.tsx), [GenerationsPanel.tsx](../src/components/shell/GenerationsPanel.tsx)). No hace falta añadirla.
- **Notas en un sujeto:** `Subject.description` ya existe ([types.ts:1003](../src/engine/types.ts)) y el agente ya la recibe junto al `@Nombre` ([context.ts:286](../src/engine/agent/context.ts)). No hace falta un campo nuevo ni tocar la persistencia protegida.
- **Plantillas:** los estilos de captura y «Mis estilos» cubren lo que el artículo hace con Templater.
- **Grafo:** Nodes ya muestra relaciones reales; un grafo de enlaces manuales competiría con él. Descartado.

## Propuesta, en orden

### 1. Vistas guardadas de filtros (Library y Generations)

Guardar con un nombre la combinación actual de Lugar, Modo, tipo, favoritos, orden y búsqueda, y elegirla desde el mismo menú de filtros (patrón de Sessions; sin superficies nuevas). Se guardan como preferencia de interfaz, igual que `tileSize` en [persistUi.ts](../src/store/persistUi.ts), con saneado al cargar.

- Valor: no repetir el filtrado en cada visita.
- Riesgo: casi nulo; no toca sujetos, sesiones ni resultados.
- Pendiente de decidir: si una vista recuerda también la búsqueda o solo los filtros.

### 2. Reglas fijas del agente en archivos `.md`

Hoy el contexto del agente está en código: [context.ts](../src/engine/agent/context.ts) (44 KB, por encima del límite de 30 KB de AGENTS.md), [requestGuides.ts](../src/engine/agent/requestGuides.ts), [modelIndex.ts](../src/engine/agent/modelIndex.ts). Mezcla dos cosas:

- **Datos vivos** (lista de modelos, esquemas, precios, biblioteca): se siguen generando en código.
- **Reglas fijas** (mapa de capacidades, reglas MUST, guías por tipo de petición y por modelo): pasan a `src/engine/agent/knowledge/<tipo>/<concepto>.md` con frontmatter mínimo al estilo OKF (`type`, `title`, `description`, `tags`), importados como texto en la compilación.

- Valor: el usuario lee y corrige las reglas sin tocar código; git muestra cada cambio de regla; `context.ts` baja del límite de tamaño.
- Riesgo: bajo si el prompt resultante es idéntico byte a byte. Prueba: un test compara el contexto generado antes y después para casos fijos.
- No toca datos del usuario ni proveedores.

### 3. Cargar el conocimiento por partes (tras el paso 2)

Cada carpeta de `knowledge/` tiene un `index.md` con una línea por ficha. El agente recibe siempre los índices y las reglas críticas; las fichas largas (guías por modelo, por tipo de petición) entran solo cuando la petición o el modelo elegido las necesitan, decidido por la app, no por el agente. Ataca el tamaño de contexto anotado en la revisión del 2026-10-20.

- Valor: menos tokens por turno, menos coste y menos latencia.
- Riesgo: medio; una ficha necesaria podría no entrar. Prueba: medir tokens y repetir las pruebas de anti-deriva (tiempos y aciertos de 2026-10) antes de activarlo. Si empeora, se vuelve al contexto completo.

### Después, no ahora: paquete de sujetos y estilos

Exportar e importar sujetos y estilos como carpeta (un `.md` por sujeto con su frontmatter y sus imágenes) para copias y para moverlos entre instalaciones. Importar escribe en la biblioteca, que es [persistencia protegida](persistencia-protegida.md): requiere autorización explícita, pruebas y revisión independiente.

## Coste

Ninguno de los pasos usa proveedores de pago. Las pruebas del paso 3 con un LLM real sí cuestan: antes, coste máximo y aprobación (ADR 0004).
