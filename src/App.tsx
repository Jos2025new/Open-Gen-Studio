import { useEffect, useState } from 'react';
import { useStore } from './store/store';
import { ensureSchema, loadCatalogs, loadLlmCatalog } from './engine/catalog';
import { adoptRemoteAssets, resumeInterrupted } from './engine/jobs';
import { settleInterruptedPlans } from './engine/agent/runtime';
import { syncBlobsToDisk } from './lib/idb';
import { Sidebar } from './components/shell/Sidebar';
import { TopBar, TopbarSlotContext } from './components/shell/TopBar';
import { SidePanel } from './components/shell/SidePanel';
import { Lightbox } from './components/assets/Lightbox';
import { SketchEditor } from './components/assets/SketchEditor';
import { ChatWorkspace } from './components/chat/ChatWorkspace';
import { NodeWorkspace } from './components/node/NodeWorkspace';
import { DesignerWorkspace } from './components/designer/DesignerWorkspace';
import { Composer } from './components/composer/Composer';
import { Toasts } from './components/ui/Toasts';
import { TooltipLayer } from './components/ui/TooltipLayer';

export function App() {
  const hydrated = useStore((s) => s.hydrated);
  const workspace = useStore((s) => s.ui.workspace);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    const st = useStore.getState();
    void loadCatalogs().then(() => {
      const c = useStore.getState().composer;
      void ensureSchema(c.image.modelRef);
      void ensureSchema(c.video.modelRef);
    });
    void ensureSchema(st.composer.image.modelRef);
    void ensureSchema(st.composer.video.modelRef);
    if (st.settings.agent.provider !== 'offline') void loadLlmCatalog(st.settings.agent.provider);
    void resumeInterrupted();
    // Plans cut by the reload follow their resumed generations; results still only at a provider get saved.
    settleInterruptedPlans();
    void adoptRemoteAssets();
    // Disk copy: bring older blobs over, and ask the browser not to evict its own copy under storage pressure.
    void syncBlobsToDisk();
    void navigator.storage?.persist?.().catch(() => false);
  }, [hydrated]);

  if (!hydrated) {
    return (
      <div className="boot">
        <div className="boot-mark" />
      </div>
    );
  }

  return (
    <TopbarSlotContext.Provider value={slot}>
      <div className="app">
        <Sidebar />
        <main className="main">
          <TopBar slotRef={setSlot} />
          <div className={`workspace ws-${workspace}`}>
            {workspace === 'chat' ? <ChatWorkspace /> : workspace === 'node' ? <NodeWorkspace /> : <DesignerWorkspace />}
            <Composer />
          </div>
        </main>
        <SidePanel />
        <Lightbox />
        <SketchEditor />
        <Toasts />
        <TooltipLayer />
      </div>
    </TopbarSlotContext.Provider>
  );
}
