# 0019 — Tipografía: DM Sans y Outfit en la app, Inter en el Designer

## Estado

Aceptado

## Fecha

2026-10-17

## Contexto

Home se rediseñó con una pareja geométrica (maquetas, [042](../history/042-2026-10-W42.md)). Se compararon cuatro parejas; la elegida por el usuario fue Outfit (títulos) + DM Sans (interfaz). Sustituir Inter en toda la app rompió los documentos del Designer, que nombran `Inter Variable`.

## Decisión

- La app usa DM Sans; los títulos de Home, Outfit. Ambas OFL, empaquetadas en local (sin CDN, la app es offline).
- El Designer conserva Inter, cargada aparte, porque sus documentos la nombran.

## Alternativas

- **Inter en todo.** Descartada: el usuario eligió la pareja geométrica.
- **DM Sans también en el Designer.** Descartada: cambiaría el aspecto de documentos ya guardados.
- **Fuentes por CDN.** Descartada: la app funciona sin red.

## Consecuencias

- Dos familias más en el paquete. Un documento nuevo que nombre otra fuente debe cargarla aparte.
- `tests/fonts.test.ts` comprueba que Inter sigue cargada.
