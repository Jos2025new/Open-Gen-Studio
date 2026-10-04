# Nodes (workspace: node)
- read_graph consulta nodos y conexiones; edit_node edita nodos existentes; connect_nodes y disconnect_nodes cambian conexiones; delete_nodes y restore_nodes quitan o recuperan nodos.
- propose_plan propone un flujo nuevo; run_nodes propone ejecutar objetivos existentes con sus antecesores necesarios y espera aprobación, incluso en Auto.
- Cada nodo conserva sus ajustes: confirm_settings no se usa aquí. El ejecutor respeta el candidato elegido; si falta, rechaza el dependiente.
- Límites: no admite pasos layer ni join_clips. read_graph no edita ni ejecuta; conectar respeta puertos y ciclos. No hay herramientas de archivos, internet ni shell.
