import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { ConfirmProvider } from './components/ui/ConfirmProvider.js';
import './components/ui/tailwind.css';
import './styles/tokens.css';
import './components/ui/ui.css';
import './styles/styles.css';
import './styles/inspector.css';
import './styles/editor-feedback.css';
import './styles/canvas-viewport.css';
import './styles/editor-topbar.css';
import './styles/navigation-controls.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
);
