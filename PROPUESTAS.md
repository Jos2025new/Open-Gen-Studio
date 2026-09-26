# Propuestas en discusión — Open Gen Studio

Ideas conversadas con el usuario (2026-09-25). **No es un plan fijo**: cada punto recoge opciones, pros y contras, y lo que queda por decidir. Lo ya hecho está en `PROGRESS.md`; los planes de cada tarea, en `AGENTS.md`.

Punto de partida: la app **no tiene backend**. Corre entera en el navegador; el servidor de Vite (`npm run dev` / `npm run preview`) solo la sirve en local y aporta unas rutas auxiliares `/x/*`.

---

## 1. Despliegue (Cloudflare, Vercel, Coolify…)

Meta del usuario: publicarla más adelante, **después de pulirla**. Sin decisión tomada.

Idea común: las rutas `/x/*` ya son, en la práctica, la frontera con un futuro backend. Hoy existen en Vite:

| Ruta | Para qué | Por qué existe |
|---|---|---|
| `/x/fal-web`, `/x/atlas-static` | Esquemas OpenAPI de fal y Atlas | Esos documentos no envían CORS |
| `/x/media` | Descargar resultados de almacenes sin CORS (Atlas `*.volces.com`) | Si no, no se guardan y caducan en 24 h |
| `/x/store` | Copia en disco del estado y los archivos | Que el trabajo no dependa del navegador |

Si esas mismas rutas se implementan en la plataforma elegida, **el frontend no cambia**.

Opciones consideradas:

- **Cloudflare Workers / Pages + Functions** — la favorita en la conversación. Estáticos + rutas en un Worker; archivos en R2; estado en KV o D1. Límites de tamaño holgados para vídeo. Contra: aprender R2/D1; la persistencia pasa a ser por usuario (ver punto 2).
- **Coolify (self-hosted)** — un `server.mjs` pequeño en Node (sin dependencias) que sirva `dist/` e implemente `/x/*` escribiendo en un volumen. Lo más parecido a lo que ya hay en local. Contra: mantener el servidor.
- **Vercel** — la menos adecuada: las funciones limitan el cuerpo de petición a ~4,5 MB y los vídeos lo superan con facilidad.

Por decidir: plataforma; si será solo para el usuario o para más gente (cambia mucho el punto 2).

## 2. Acceso y claves al publicar

- **Acceso:** una app pública con `/x/store` abierto y las claves del usuario sería un riesgo. Opciones: Cloudflare Access (login delante de todo, sin código), o contraseña básica en el servidor. Si hubiera varios usuarios, haría falta separar datos por usuario (más trabajo).
- **Claves:** hoy viven en el navegador y en `data/state.json` (texto plano, permisos 600, fuera de git). Con backend convendría que vivieran en el servidor y que las llamadas a proveedores pasaran por él (fal lo recomienda para `FAL_KEY`). Encaja en el mismo paso que el despliegue.

## 3. Persistencia (hecho lo mínimo; ideas para después)

Hecho: copia en disco vía `/x/store` (ver `PROGRESS.md`). Posibles mejoras, solo si hacen falta:
- Exportar/importar un `.zip` de `data/` desde la app (copias manuales o mover entre máquinas).
- Limpiar copias `data.bak-*` antiguas (hoy se acumulan en cada "Wipe all data").
- API de acceso a archivos del navegador como alternativa sin servidor (solo Chromium y pide permiso por sesión; descartada de momento).

## 4. Proveedores

- **Subidas grandes:** fal y NanoGPT reciben vídeo como data URL; clips grandes pueden superar el tamaño de petición. fal tiene API de subida (`rest.alpha.fal.ai/storage/upload/initiate`, admite CORS). Solo si aparece el problema.
- **Estimación de coste de Atlas:** solo publica el tramo más barato; hoy se muestra como mínimo (`≥`). Si se quisiera exactitud, habría que modelar precios por resolución/audio por modelo.
- **fal:** la cuenta de prueba está bloqueada por saldo; nada de fal se ha verificado con una generación real.

## 5. Herramientas pendientes (sin decidir)

- **Trim / quitar audio de vídeo:** ningún proveedor lo ofrece (salvo una utilidad de pago en fal). Opción ligera en el navegador: remuxar sin recodificar con una librería tipo Mediabunny (revisar licencia y peso antes). ffmpeg.wasm descartado por peso (~30 MB).
- **Quitar fondo de vídeo** (`pixelcut/video-background-removal` en NanoGPT): ID verificado, sin implementar. **Audio:** el tipo de medio ya existe (transcripción y MiniMax Music/Lyrics hechos, fase 4); otras familias (TTS, efectos, música de otros proveedores) esperan decisión del usuario.
- **Descartado por el usuario:** "Analysis" (describir imagen/vídeo con el LLM para sacar un prompt).
