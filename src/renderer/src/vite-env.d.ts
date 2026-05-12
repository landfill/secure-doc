/// <reference types="vite/client" />

import type { SecureDocDesktopApi } from "../../shared/desktopApi";

declare global {
  interface Window {
    secureDoc?: SecureDocDesktopApi;
  }
}

