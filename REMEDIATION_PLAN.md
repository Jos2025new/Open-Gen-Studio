# Remediation Plan — Open Gen Studio

**Auditorías**: Claude Haiku 4.5 (local) + Claude Flash + GPT-4 web  
**Fecha**: 2026-09-24  
**Status**: Draft → Ready for sprint planning

---

## Phase 1: DRY Violations (Week 1) — High ROI, Low Risk

### 1.1 MAX_PLAN_STEPS → Constante única
- **Qué**: Consolidar 16/16/24 en `const MAX_PLAN_STEPS = 16`
- **Dónde**: `src/engine/plan.ts` (source of truth) + `tools.ts` + `executor.ts` (imports)
- **Por qué**: Tres valores diferentes → drift garantizado cuando cambies límite
- **Esfuerzo**: 15 min | **Risk**: Nulo

### 1.2 OPS → Fuente única de agent tools
- **Qué**: Derivar `opIds` + descripciones del agent desde `OPS` (no duplicar)
- **Dónde**: `src/engine/ops.ts` → exportar `getAgentOpsSchema()` → consumir en `agent/context.ts`, `agent/tools.ts`
- **Por qué**: Operaciones están en `OPS`, repetidas en `tools.ts`, vueltas a describir en `context.ts`. Cambiar una op requiere 3 edits
- **Esfuerzo**: 1h | **Risk**: Bajo (refactor mecánico)

### 1.3 Providers → Consolidar en registry
- **Qué**: Una `PROVIDERS_REGISTRY` canónica con id/label/keys/status/adapter
- **Dónde**: `src/engine/providers/registry.ts` → derivar `ProviderId`, `PROVIDER_LABELS`, `REMOTE_PROVIDERS`, initial keys en `store.ts`
- **Por qué**: Providers decla en 4+ sitios: `types.ts`, `registry.ts`, `parseModelRef()`, `store.ts`. Añadir provider requiere 9 edits
- **Esfuerzo**: 2h | **Risk**: Bajo (pero tocar store.ts, cuidado merge)

---

## Phase 2: Data Integrity (Week 2) — Critical, Medium Risk

### 2.1 Raster validation + recovery
- **Qué**: Validar buffers en-memoria vs IndexedDB antes de render. Flag "stale" si falló persist
- **Dónde**: `src/engine/design/raster.ts` (schedulePersist) + `src/App.tsx` (hydration check)
- **Por qué**: Debounce (700ms) puede perder pixeles si tab cierra antes del timeout. Reload restaura versión antigua silenciosamente
- **Esfuerzo**: 2–3h | **Risk**: Medio (timing edge case)
- **Test**: Paint → close tab → reload → verificar pixeles

### 2.2 Assets orphan detection
- **Qué**: Validar que `layer.sourceAssetId` existe antes de render/export. Avisar si asset fue borrado
- **Dónde**: `src/engine/design/actions.ts` (placeAsset, renderDoc) + `src/engine/design/render.ts`
- **Por qué**: Si asset se borra, layer referencia blob inexistente. Canvas queda en blanco sin aviso
- **Esfuerzo**: 1.5h | **Risk**: Bajo (validación defensiva)
- **Test**: Coloca imagen → borra asset en gallery → export → verificar error + fallback

### 2.3 Generation recovery
- **Qué**: Reset generaciones stuck > 5min en `executing`. Resume remote jobs (ya existe, consolidar)
- **Dónde**: `src/App.tsx` (hydration) + `src/engine/jobs.ts` (clarify error states)
- **Por qué**: Network fail → generación queda `'executing'` forever. UI spinner infinito
- **Esfuerzo**: 1h | **Risk**: Bajo (safety net, no cambia happy path)
- **Test**: Genera imagen → interrupt network → reload → verificar reset automático

---

## Phase 3: KISS Clarification (Week 3) — Optional, No Risk

### 3.1 Bootstrap flujo — documentar o refactor
- **Qué**: `ensureSchema()` antes + después de `loadCatalogs()` → explicar o fusionar
- **Dónde**: `src/App.tsx:20-32` (comentario) + posible `initCatalog()` wrapper
- **Por qué**: Confunde: se cargan catalogs, pero luego se cargan schemas. ¿Por qué dos pasadas?
- **Esfuerzo**: 30 min (doc) o 1.5h (refactor) | **Risk**: Nulo (doc) / Bajo (refactor)

### 3.2 History LRU cleanup
- **Qué**: Memory pressure: si `stacks` > 100MB, descartar stack más antiguo
- **Dónde**: `src/engine/design/history.ts` + housekeeping en `src/App.tsx`
- **Por qué**: Undo snapshots (40+ por doc, ~50KB c/u) nunca se limpian. Memory leak después de 1–2h uso intenso
- **Esfuerzo**: 1h | **Risk**: Bajo (es cleanup, no corruption)

---

## Priority Matrix

| Fase | Tarea | Esfuerzo | ROI | Risk | Sprint |
|------|-------|----------|-----|------|--------|
| 1 | MAX_PLAN_STEPS | 15m | 🟢 Alto | Nulo | W1 |
| 1 | OPS → agent | 1h | 🟢 Alto | Bajo | W1 |
| 1 | Providers registry | 2h | 🟢 Alto | Bajo | W1 |
| 2 | Raster validation | 2–3h | 🔴 Crítico | Medio | W2 |
| 2 | Assets orphan | 1.5h | 🔴 Crítico | Bajo | W2 |
| 2 | Generation recovery | 1h | 🔴 Crítico | Bajo | W2 |
| 3 | Bootstrap doc | 30m–1.5h | 🟡 Medio | Nulo | W3 |
| 3 | History cleanup | 1h | 🟡 Medio | Bajo | W3 |

---

## Checklist

- [ ] **Phase 1**: DRY fixes (3.25h total) — tests pass, typecheck OK
- [ ] **Phase 2**: Data integrity (4.5h total) — manual testing on chrome, firefox; edge cases validated
- [ ] **Phase 3**: Optional Polish (1.5–2.5h total)
- [ ] Merge PR a `main` con commits separados por tarea
- [ ] Update PROGRESS.md con status

---

## Notes

- **Sin breaking changes**: Todos los cambios son refactor interno o seguridad defensiva
- **Tests existentes**: 12 en `tests/engine.test.ts`; actualizar si cambian signatures
- **Verificación**: typecheck + build + test suite en cada fase
