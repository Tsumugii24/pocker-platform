/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_TEST_FEATURES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
