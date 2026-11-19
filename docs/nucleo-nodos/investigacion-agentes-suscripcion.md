> **Nota de la sesión maestra (2026-11-19):** la cláusula de Anthropic se dirige a terceros que *ofrecen* el login de Claude.ai a sus usuarios. Para una app propia, usada por su dueño con su propio plan, el artículo oficial «Use the Claude Agent SDK with your Claude plan» contempla el Agent SDK y `claude -p` con el login del plan, que cuentan contra su cuota. Lo que se evita es extraer el token de `~/.claude` y llamar a la API desde un cliente propio; el binario oficial o el SDK lo usan con el login o con `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`). Confirmar con el artículo completo antes de construir.

# Agentes de suscripción dentro de Open Gen Studio (investigación web, solo lectura)
Consultado el 2026-11-19. V = verificado en página oficial; NV = no confirmado en fuente oficial (blogs/mirrors o fragmentos de búsqueda).

## Resumen
- Ningún proveedor incluye clave de API en la suscripción (V en OpenAI, Cursor-docs, xAI parcial; Anthropic V indirecto, ver abajo).
- Vía técnica común y oficial: lanzar la CLI propia del proveedor como proceso hijo (stdio / ACP / JSON-RPC) con el login que el usuario ya hizo en esa CLI.
- Riesgo de términos: Anthropic y Google prohíben explícitamente a una app de terceros enrutar por credenciales de suscripción. OpenAI, Cursor y xAI: no hallé prohibición explícita, tampoco permiso explícito (NV).

## 1. Anthropic / Claude
| Pregunta | Hallazgo | Fuente |
|---|---|---|
| Clave API incluida | V: facturación API (Console) separada. Matiz: Max/Ultra/Team incluyen créditos mensuales de API si se usa una clave de la organización Console vinculada (actualización 7-oct-2026). Pro: no confirmado. | https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan (2026-11-19) |
| Vía oficial | V: Claude Agent SDK y `claude -p` (headless). Documentado. | https://code.claude.com/docs/en/legal-and-compliance (2026-11-19) |
| Login suscripción vía SDK | V: con sesión del plan, Agent SDK y `claude -p` "siguen contando contra los límites de la suscripción". Hubo un cambio anunciado (crédito aparte, 15-jun-2026) que se pausó/retiró; el artículo no lo da como vigente. | support.claude.com (misma URL); NV segunda lectura: https://www.theregister.com/ai-ml/2026/05/14/anthropic-tosses-agents-into-the-api-billing-pool/5240748 |
| ACP/MCP | NV: no verifiqué un modo servidor oficial de Claude Code con login de suscripción; existe `claude mcp serve` pero no lo consulté. | -- |
| Términos | V: "Anthropic no permite a terceros ofrecer login de Claude.ai en sus apps, ni enrutar peticiones con credenciales Free/Pro/Max/Ultra en nombre de sus usuarios"; los desarrolladores "no pueden recolectar, almacenar ni intermediar credenciales o tokens de sesión de Claude.ai". Los desarrolladores con Agent SDK "deben usar clave de API". Sí permite: "un usuario final inicia sesión en el binario Claude Code sin modificar con su propia suscripción". Los límites anunciados "asumen uso ordinario e individual de Claude Code y Agent SDK". | https://code.claude.com/docs/en/legal-and-compliance (2026-11-19) |
| Riesgo | PROHIBIDO: leer/reutilizar el OAuth de `~/.claude` en tu propio cliente. ZONA GRIS: app propia que llama al Agent SDK usando el login del usuario (la cláusula habla de "ofrecer" a usuarios; uso personal propio no aparece tratado explícitamente, NV). Anthropic "puede aplicar sin aviso". | idem |
| Límites | V: cuenta contra el límite de suscripción (ventana compartida). Concurrencia: NV. | support.claude.com |

## 2. OpenAI / ChatGPT / Codex
| Pregunta | Hallazgo | Fuente |
|---|---|---|
| Clave API incluida | V: no. Dos logins separados: ChatGPT (plan) o API key; "con API key se usa precio estándar de API en vez de créditos del plan", facturado en Platform. | https://learn.chatgpt.com/docs/auth (antes developers.openai.com/codex/auth, 2026-11-19) |
| Vía oficial | V: `codex exec` (headless), Codex SDK (página SDK no leída, NV), `codex app-server` (JSON-RPC por stdio; docs dicen experimental, "no soportado para producción"), `codex mcp-server` (experimental; un blog dice deprecado en ago-2026, NV). | https://developers.openai.com/codex/app-server (vía búsqueda; 2026-11-19) |
| Login suscripción en automatización | V: docs recomiendan API key para CI/programático ("API keys are still the recommended default for automation"). Login ChatGPT en máquina sin navegador: device code (beta) o copiar `~/.codex/auth.json` ("trátalo como contraseña"). Access tokens solo Enterprise, para scripts de confianza. | learn.chatgpt.com/docs/auth |
| Términos para app de terceros | NV: la página no trata apps de terceros. La navegación menciona "Sign in with ChatGPT" para apps (no leída). Copiar auth.json a otro cliente propio: no verificado, tratar como riesgo. | -- |
| Límites | V parcial: usa los créditos/límites del plan. Cifras y concurrencia: NV. | learn.chatgpt.com/docs/auth |

## 3. Cursor
| Pregunta | Hallazgo | Fuente |
|---|---|---|
| Clave API incluida | V: `CURSOR_API_KEY` se genera para autenticar CLI/scripts contra la cuenta Cursor; no hallé que sea un crédito de API separado. Facturación: uso del plan; ACP "mismo precio por uso que la suscripción" solo en espejo/terceros (NV). | https://cursor.com/docs/cli/headless ; https://cursor.com/docs/cli/acp (2026-11-19) |
| Vía oficial | V documentado: `agent -p` (headless) y `agent acp` (JSON-RPC 2.0 por stdio, una línea por mensaje; "pensado para construir clientes e integraciones propios"). Auth: `cursor_login`, o `agent login`, `--api-key`, `--auth-token`. Existe también Cursor SDK (no leído). | cursor.com/docs/cli/acp |
| Términos | NV: sin cláusula específica hallada. Admins de equipo pueden bloquear `-p` ("Disable CLI headless mode"). | cursor.com/docs/cli/headless |
| Límites | NV (consume uso del plan según terceros). | -- |

## 4. xAI / Grok
| Pregunta | Hallazgo | Fuente |
|---|---|---|
| Clave API incluida | V parcial: la FAQ trata suscripción SuperGrok y API como cosas distintas (créditos API prepagados no reembolsables; "SuperGrok Heavy anual, no uso de API"). "No incluye créditos" es afirmación de terceros (NV oficial). | https://docs.x.ai/grok/faq (2026-11-19) |
| Vía oficial | V documentado: Grok Build CLI; `grok -p` headless (streaming JSON) y `grok agent stdio` = ACP por stdin/stdout. Auth: `grok login` (token en caché) o `XAI_API_KEY`. | https://docs.x.ai/build/cli/headless-scripting (2026-11-19) |
| Acceso | NV oficial: CLI abierta a SuperGrok y X Premium+ (anuncio xAI x.ai/news/grok-build-cli, no leído; lo cita una búsqueda). Con clave se factura por token (NV). | -- |
| Términos | NV: no hallé cláusula sobre apps de terceros. | -- |
| Límites | NV (reporte de terceros: pool semanal compartido con Build). | -- |

## 5. Google (Gemini CLI / Antigravity)
| Pregunta | Hallazgo | Fuente |
|---|---|---|
| Clave API incluida | V parcial: los métodos soportados son login Google (Code Assist), clave Gemini Developer API o clave Vertex; la clave es producto aparte. | https://www.geminicli.com/docs/resources/tos-privacy (2026-11-19) |
| Vía oficial | Gemini CLI tenía ACP (`--acp`, doc "ACP mode") y headless, pero un banner oficial dice "Gemini CLI fue reemplazado por Antigravity CLI el 18-jun-2026" (consumo vía suscripción; seguiría con claves de pago). Antigravity CLI (`agy`): sin modo ACP en el lanzamiento (NV, terceros: https://mcp.directory/blog/antigravity-cli-vs-gemini-cli-migration-2026). Auth por OAuth de navegador. | https://geminicli.com/docs/resources/faq/ |
| Términos | V, explícito: usar software de terceros para "recolectar o aprovecharse del OAuth de Gemini CLI" o acceder directamente a los servicios (ej. OpenClaw con OAuth de Gemini CLI) "viola los términos" y "puede suspender o cancelar la cuenta de inmediato". Alternativa soportada: clave de Vertex AI o Google AI Studio. Hay hilos de usuarios Pro con 403 ToS (relatos, NV). | https://geminicli.com/docs/resources/faq/ ; tos-privacy |
| Riesgo | PROHIBIDO: reutilizar OAuth de la CLI en otro cliente. Lanzar la CLI oficial como hijo propio: sin cláusula clara; riesgo de bloqueo de cuenta (la que paga Pro). | -- |
| Límites | NV: cuota compartida CLI/agent mode según Google (cifras no verificadas para 2026). | -- |

## Recomendación
Vía más simple, oficial y segura: un proveedor "CLI local" en OGS que lance la CLI oficial como proceso hijo y hable por ACP o por su modo headless con salida JSON en stream, sin tocar jamás los tokens.
- ACP documentado: Cursor (`agent acp`) y xAI (`grok agent stdio`). Mejor primer candidato: mismo adaptador para ambos. Codex: `codex app-server` (experimental) o `codex exec --json`. Claude: `claude -p --output-format stream-json` o Agent SDK.
- Priorizar por riesgo de términos: 1) Cursor, 2) Grok, 3) Codex (sin cláusula contraria hallada); Claude solo tras decisión del usuario (la cláusula se lee contra apps que "ofrecen" login; uso personal es zona gris, consultar a Anthropic); Google: no usar OAuth, solo clave API de pago.
- Frente a claves de pago: API = cumple todos los términos, facturación por token, estable y concurrente; CLI-suscripción = sin coste marginal pero límites de plan compartidos con tu uso interactivo, esquemas experimentales que cambian por versión, posible zona gris de términos, y menos control (la CLI es su propio agente con herramientas y permisos).
- Hay que construir (grandes rasgos): tipo de proveedor "cli-local" (ruta binario, argumentos, protocolo acp|jsonl); gestor de procesos con cwd aislado en una carpeta de trabajo vacía/sandbox, entorno mínimo (sin claves ajenas), permisos de herramientas en solo lectura o denegar, timeout, límite de memoria y matado limpio; detección de CLI instalada y de login (la app nunca lee ni guarda tokens; el login lo hace el usuario en la CLI); puente de mensajes/eventos hacia los nodos de chat; cola de turnos para no exceder cuotas (una sesión por CLI al principio); opcional y desactivado por defecto, con aviso de términos por proveedor; modo test para que el tester observe la conversación entre dos agentes.
- Conversación entre dos agentes: la app media (reenvía la salida de uno como entrada del otro); no depende de que los proveedores hablen entre sí.

## Sin confirmar (pendiente)
Página del Codex SDK y su licencia/uso con login ChatGPT; modo servidor de Claude Code (`claude mcp serve`) y términos para uso personal local; cláusulas de Cursor, xAI y OpenAI sobre apps de terceros (términos de servicio completos no leídos); cuotas y concurrencia de todos; estado de Antigravity CLI para headless/ACP y su acceso con suscripción; texto original del artículo de soporte de Anthropic más allá del resumen obtenido.
