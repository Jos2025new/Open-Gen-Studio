# Estado del cierre de render-bench (2026-10-13)

- Entró, en 3 commits: `89bb605` guardado raster que confirma solo la versión que codificó; `ae0aa2e` regiones con caja exacta frente a conservadora, FX de capa con su margen y FX desconocidos con la colocación del raster; `2f44d74` banco de paridad que pinta como trazo editable.
- Verificado: `npx tsc --noEmit` sin errores; `npm run test:related` 849 pasan (4 omitidos); `npm test` 189 archivos y 1313 tests pasan (5 omitidos).
- Revertido: la nota nueva de `docs/plan-fluidez.md` sobre `canvasToBlob`, que no formaba parte de este cierre.
- Falta: verificación en navegador de la paridad de 200 operaciones; prueba de interfaz del límite raster; comparación final de fluidez (A/B 1024², CPU/GPU, 2048²) y la diferencia de 2 000 operaciones documentada en `render-baseline.md`.
- Sigue desactivado: la ruta PNG en worker; el guardado usa el encoder Canvas legado.
