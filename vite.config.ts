import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API calls to the MokaCo HRMS backend during development.
    // This keeps the browser same-origin, so we sidestep CORS and the
    // backend's self-signed HTTPS certificate (secure: false).
    proxy: {
      '/api': {
        target: 'https://localhost:44332',
        changeOrigin: true,
        secure: false,
      },
      /**
       * The SignalR hub. A SEPARATE ENTRY because the app talks to the API on a relative URL
       * (API_BASE_URL is ''), so the browser asks the DEV SERVER for /hubs/live/negotiate — and
       * Vite answered 404 for it, since only /api was forwarded. That 404 looks exactly like a
       * missing hub on the backend, which is the wrong place to go looking.
       *
       * `ws: true` is the part that is easy to miss and impossible to work around: negotiate is
       * ordinary HTTP and would be forwarded without it, so the connection would get through
       * negotiation and then fail at the upgrade — a hub that "connects and then dies".
       */
      '/hubs': {
        target: 'https://localhost:44332',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
})
