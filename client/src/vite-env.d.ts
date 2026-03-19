/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANALYTICS_ENDPOINT?: string;
  readonly VITE_ANALYTICS_WEBSITE_ID?: string;
  readonly VITE_ENABLE_TEST_FEATURES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
