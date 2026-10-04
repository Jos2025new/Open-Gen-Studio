# Agente

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| El prompt fija un procedimiento común y distingue datos del usuario de decisiones creativas. | [src/engine/agent/context.ts](../../src/engine/agent/context.ts) | [tests/agent-procedure.test.ts](../../tests/agent-procedure.test.ts) |
| Stop cancela el turno de su sesión sin detener el de otra sesión. | [src/engine/agent/runtime.ts](../../src/engine/agent/runtime.ts) | [tests/agent-cancel.test.ts](../../tests/agent-cancel.test.ts) |
