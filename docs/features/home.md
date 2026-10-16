# Home y barra lateral

Solo disposición (2026-10-15, `task/gui-cohesion`). Studio abre por ahora el chat; no cambia el chat, los proveedores ni los datos.

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| Home abre una vista propia sobre el espacio de trabajo (que sigue montado: borradores y estado se conservan). Cualquier destino la cierra, también cambiar de espacio por otra vía. | [HomeView.tsx](../../src/components/shell/HomeView.tsx), [App.tsx](../../src/App.tsx), [navModel.ts](../../src/components/shell/navModel.ts) | [home-nav.test.ts](../../tests/home-nav.test.ts) |
| Create: Studio abre el chat en modo agente; Image, Video, Audio y 3D abren el espacio Create Media (ver abajo) con ese modo; Node Canvas y Designer abren su espacio. Image, Video, Audio y 3D son accesos con un icono grande de su color; la cifra es el recuento real. | [navModel.ts](../../src/components/shell/navModel.ts), [HomeView.tsx](../../src/components/shell/HomeView.tsx) | [home-nav.test.ts](../../tests/home-nav.test.ts) |
| Tools: todas las operaciones de imagen, vídeo y audio de `ops.ts` (sin las de Sketch ni las de varios clips), una vez cada una; las principales primero y «More» el resto. Cada una abre el espacio Tools con esa operación (ver create-space.md). | [navModel.ts](../../src/components/shell/navModel.ts), [ops.ts](../../src/engine/ops.ts) | [home-nav.test.ts](../../tests/home-nav.test.ts) |
| Latest: sesiones y recursos recientes, con «See all» a los paneles Sessions y Library. | [HomeView.tsx](../../src/components/shell/HomeView.tsx) | [home-nav.test.ts](../../tests/home-nav.test.ts) |
| Barra ancha: Home, Spaces (filas altas), Create (2×2) y Tools (lista) con cabeceras plegables; abajo Sessions, Library y Spending. Barra estrecha: solo iconos, uno por sección, con panel flotante (Popover) al pulsar. | [SidebarNav.tsx](../../src/components/shell/SidebarNav.tsx), [Sidebar.tsx](../../src/components/shell/Sidebar.tsx), [sidebar-nav.css](../../src/styles/sidebar-nav.css), [home.css](../../src/styles/home.css) | [home-nav.test.ts](../../tests/home-nav.test.ts) |

Sin probar visualmente en navegador (solo render de servidor y tests). El selector de espacios del TopBar sigue disponible.
