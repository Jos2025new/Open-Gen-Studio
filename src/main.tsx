import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@xyflow/react/dist/style.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/shell.css';
import './styles/composer.css';
import './styles/chat.css';
import './styles/node.css';
import './styles/designer.css';
import './styles/prompt-box.css';
import './styles/designer-connected.css';
import './styles/sidebar-nav.css';
import './styles/home.css';
import './styles/space.css';
import './styles/studio.css';
import { App } from './App';
import { installBoardAutoOpen } from './lib/studioBoard';
import { installHomeAutoClose, installHomeKeyGuard } from './components/shell/homeGuard';

installHomeKeyGuard();
installHomeAutoClose();
installBoardAutoOpen();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Diagnostic bank is opt-in and checks sandbox origin before exposing any actions.
if (import.meta.env.VITE_OGS_SANDBOX === '1' && location.port === '5183' && new URLSearchParams(location.search).has('bench')) void import('./lib/designerBench');
