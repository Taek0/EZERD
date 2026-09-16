import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ConfirmProvider } from './components/ui/ConfirmProvider.js';
import './components/ui/tailwind.css';
import './tokens.css';
import './components/ui/ui.css';
import './styles.css';
import './inspector.css';
import './editor-feedback.css';
import './canvas-viewport.css';
import './editor-topbar.css';
import './navigation-controls.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
);
