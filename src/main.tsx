import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Inter stays for the Designer's text (engine/design/doc.ts uses 'Inter Variable'); the app UI uses DM Sans.
import '@fontsource-variable/inter';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@xyflow/react/dist/style.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/shell.css';
import './styles/composer.css';
import './styles/chat.css';
import './styles/chat-cards.css';
import './styles/node.css';
import './styles/designer.css';
import './styles/prompt-box.css';
import './styles/designer-connected.css';
import './styles/sidebar-nav.css';
import './styles/home.css';
import './styles/space.css';
import './styles/save-guard.css';
import './styles/writer-lock.css';
import './styles/studio.css';
import { App } from './App';
import { installDoneNotice } from './lib/doneNotice';
import { installBoardAutoOpen } from './lib/studioBoard';
import { installHomeAutoClose, installHomeKeyGuard } from './components/shell/homeGuard';

installHomeKeyGuard();
installHomeAutoClose();
installBoardAutoOpen();
installDoneNotice();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Diagnostic bank is opt-in and checks sandbox origin before exposing any actions.
if (import.meta.env.VITE_OGS_SANDBOX === '1' && location.port === '5183' && new URLSearchParams(location.search).has('bench')) void import('./lib/designerBench');
