import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Where the dev proxy forwards /api AND /hubs: the port `npm run dev` starts the API on. */
const DEV_API_TARGET = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:5078'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API calls to the MokaCo HRMS backend during development.
    // This keeps the browser same-origin, so we sidestep CORS and the
    // backend's self-signed HTTPS certificate (secure: false).
    proxy: {
      '/api': {
        target: DEV_API_TARGET,
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
       *
       * SAME TARGET AS /api, from one constant. This entry used to point at
       * https://localhost:44332 (an IIS Express port) while /api pointed at :5078, the port
       * `npm run dev` actually starts the API on — so every hub negotiate came back 502 and live
       * updates were silently off in development. Override both with VITE_DEV_API_TARGET.
       */
      '/hubs': {
        target: DEV_API_TARGET,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
})
