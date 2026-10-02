import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree';
import './styles/base.css';
import './styles/app.css';
import { App } from './App';
import { initHotkeys } from './lib/hotkeys';

initHotkeys();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
