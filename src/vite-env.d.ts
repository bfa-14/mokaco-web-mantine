/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the MokaCo HRMS API. Empty in dev to use the Vite proxy. */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
