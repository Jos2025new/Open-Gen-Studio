# Biblioteca

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| La migración de sujetos antiguos conserva una entrada por nombre, sin distinguir mayúsculas; gana la primera. | [src/store/store.ts](../../src/store/store.ts) | [tests/library.test.ts](../../tests/library.test.ts) |
| La biblioteca comparte sujetos entre sesiones y conserva sus imágenes al borrar la sesión de origen. | [src/engine/actions.ts](../../src/engine/actions.ts) | [tests/library.test.ts](../../tests/library.test.ts) |
| Normalizar un plan rechaza nombres de sujetos ausentes de la biblioteca y del propio plan. | [src/engine/plan.ts](../../src/engine/plan.ts) | [tests/library.test.ts](../../tests/library.test.ts) |
| Usar una imagen existente mediante refs no la guarda; un sujeto de paso es temporal, también al reanudar sus dependientes. | [executor.ts](../../src/engine/executor.ts) | [reference-sheet.test.ts](../../tests/reference-sheet.test.ts) |
| Los sujetos procedentes de assets se guardan al ejecutar el plan aprobado; cancelar antes no guarda. Repetir el guardado no reemplaza una identidad existente. | [runtime.ts](../../src/engine/agent/runtime.ts), [executor.ts](../../src/engine/executor.ts) | [plan-revision.test.ts](../../tests/plan-revision.test.ts), [reference-sheet.test.ts](../../tests/reference-sheet.test.ts) |
| Herramienta, prompt y reparación distinguen referencia temporal de persistencia explícita. La detección semántica de consentimiento por un LLM real sigue sin verificar. | [tools.ts](../../src/engine/agent/tools.ts), [context.ts](../../src/engine/agent/context.ts), [plan.ts](../../src/engine/plan.ts) | [plan-subjects.test.ts](../../tests/plan-subjects.test.ts) |
