# Biblioteca

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| La migración de sujetos antiguos conserva una entrada por nombre, sin distinguir mayúsculas; gana la primera. | [src/store/store.ts](../../src/store/store.ts) | [tests/library.test.ts](../../tests/library.test.ts) |
| La biblioteca comparte sujetos entre sesiones y conserva sus imágenes al borrar la sesión de origen. | [src/engine/actions.ts](../../src/engine/actions.ts) | [tests/library.test.ts](../../tests/library.test.ts) |
| Normalizar un plan rechaza nombres de sujetos ausentes de la biblioteca y del propio plan. | [src/engine/plan.ts](../../src/engine/plan.ts) | [tests/library.test.ts](../../tests/library.test.ts) |
