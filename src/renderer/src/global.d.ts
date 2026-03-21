import type { SshRendererApi } from '../../preload';

declare global {
  interface Window {
    sshApi: SshRendererApi;
  }
}

export {};
