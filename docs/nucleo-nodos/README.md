# Núcleo de nodos: diagnóstico y revisiones

Material de entrada del [ADR 0031](../decisions/0031-nucleo-de-nodos.md) (2026-11-18). Es evidencia del momento, no estado actual.

- [diag-desacople](diag-desacople.md): tabla de entradas y salidas por componente (Sonnet, solo lectura).
- [revision-desacople](revision-desacople.md): revisión independiente de esa tabla (GPT 6.2 Sol).
- [propuesta-nucleo-nodos](propuesta-nucleo-nodos.md): propuesta de núcleo de la sesión maestra.
- [revision-nucleo](revision-nucleo.md): revisión independiente de la propuesta (GPT 6.2 Sol).
- [revision-commits-nucleo](revision-commits-nucleo.md): revisión independiente de los 4 primeros commits (GPT 6.2 Sol, 2026-11-19).
- [adversarial-nucleo](adversarial-nucleo.md): tests adversariales tras las correcciones (GPT 6.2 Sol, 2026-11-19): 10 fallos reales en 24 ataques.
- [informe-neon](informe-neon.md): crítica y tests adversariales de Gemini 4 Neon (2026-11-19): 27 fallos reales en 32; causas de raíz.
- [blender-avisos](blender-avisos.md): cómo resuelve Blender 5.2.3 los avisos, los cables inválidos y los grupos, leído en su código (2026-11-19).
- [revision-neon-externa](revision-neon-externa.md): Gemini 4 Neon revisa el informe externo de la sesión (2026-11-19): doble gasto, escape de `deleteGeneration` y corrupción entre agentes en paralelo.
- [informe-neon-owner](informe-neon-owner.md): Neon ataca el historial por agente (2026-11-19): 20 fallos de dinero, borrado, Stop y recarga; propone un hilo por agente.
