# 0003 — Probar la app solo en el sandbox

## Estado

Aceptado

## Fecha

2026-10-04

## Contexto

Arrancar o abrir la app real puede guardar automáticamente. Existe un lanzador aislado en [dev-sandbox.mjs](../../scripts/dev-sandbox.mjs) y el servidor recibe DATA_DIR desde [vite.config.ts](../../vite.config.ts).

## Decisión

Para pruebas de la app usar npm run dev:sandbox: copia de lectura de data/ a .sandbox/data, puerto 5183, estricto y sin abrir navegador automáticamente. No abrir la app real desde navegadores automatizados. Los tests unitarios pueden usar mocks o carpetas temporales sin datos del usuario.

## Alternativas

Otro puerto con el mismo directorio de datos no aísla escrituras. Un perfil de navegador nuevo con la app real puede guardar estado ajeno. La copia con puerto y directorio separados evita estas rutas de contaminación.

## Consecuencias

El sandbox contiene una copia privada y está excluido de Git. Debe detenerse al terminar y no ejecutar proveedores de pago sin la aprobación correspondiente. [safeguards.test.ts](../../tests/safeguards.test.ts) prueba rutas prohibidas, copia y enlaces simbólicos; [check-safeguards.mjs](../../scripts/check-safeguards.mjs) revisa la configuración antes de la suite.
