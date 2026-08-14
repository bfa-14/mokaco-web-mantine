import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
// After the Mantine stylesheets, so the DX density rules win on specificity ties without
// !important. Before index.css, which owns the page chrome and is deliberately left in Poppins.
import './dx-parity.css'
import './index.css'
// Before App, and before anything renders: this module applies the stored language, direction and
// document attributes at import time, so the very first paint is already correct rather than
// flipping a frame later.
import './i18n'
import { DirectionProvider, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { theme } from './theme'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* detectDirection reads the dir applyLanguage() already set on <html>. A language switch
        remounts the routed tree (see LanguageProvider) and re-runs the CSS against the new [dir],
        which is what carries Mantine's logical properties through the flip. */}
    <DirectionProvider detectDirection>
      <MantineProvider theme={theme}>
        <Notifications position="top-center" />
        <App />
      </MantineProvider>
    </DirectionProvider>
  </StrictMode>,
)
