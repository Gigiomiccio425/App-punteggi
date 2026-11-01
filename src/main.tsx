import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/josefin-sans/400.css';
import '@fontsource/josefin-sans/600.css';
import '@fontsource/josefin-sans/700.css';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/monoton/400.css';
import './styles/app.css';
import { App } from './app/App';
import { AppProvider } from './app/context';
import { createBackend } from './data';
import { createNfcService } from './nfc/nfc';

async function boot() {
  const backend = await createBackend();
  const nfc = createNfcService({ allowSimulator: backend.mode === 'demo' });
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProvider backend={backend} nfc={nfc}>
        <App />
      </AppProvider>
    </StrictMode>,
  );
}

void boot();
