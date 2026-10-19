import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { DirectionProvider, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
// Brand font, bundled (not from a CDN) so the installed app works offline.
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import '@fontsource/ibm-plex-sans-arabic/latin-400.css';
import '@fontsource/ibm-plex-sans-arabic/latin-500.css';
import '@fontsource/ibm-plex-sans-arabic/latin-600.css';
import '@fontsource/ibm-plex-sans-arabic/latin-700.css';
import i18n from './i18n';
import { DirectionSync } from './i18n/LanguageSwitch';
import App from './App';
import { ROUTER_FUTURE } from './routerFuture';
import { cssVariablesResolver, theme } from './theme';
import { captureInstallPrompt } from './features/patient/installEvent';

captureInstallPrompt();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DirectionProvider initialDirection={i18n.dir()} detectDirection={false}>
        <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver}>
          <DirectionSync />
          <Notifications position="top-center" />
          <BrowserRouter future={ROUTER_FUTURE}>
            <App />
          </BrowserRouter>
        </MantineProvider>
      </DirectionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
