import { contextBridge, ipcRenderer } from 'electron';
import type {
  ConnectionProfile,
  DownloadResult,
  OpenRemoteBrowserRequest,
  RemoteBrowserErrorPayload,
  OpenRemoteBrowserResult,
  RecentBrowserVisit,
  RecentConnection,
  RemoteEntry,
  ShellClosedPayload,
  ShellDataPayload,
  SshConnectConfig,
  SshConnectResult,
  UpsertConnectionProfileInput,
  UploadResult
} from '../shared/types';

const api = {
  connect: (config: SshConnectConfig): Promise<SshConnectResult> =>
    ipcRenderer.invoke('ssh:connect', config),
  disconnect: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('ssh:disconnect', sessionId),
  openShell: (sessionId: string): Promise<string> =>
    ipcRenderer.invoke('ssh:open-shell', sessionId),
  closeShell: (shellId: string): Promise<void> =>
    ipcRenderer.invoke('ssh:close-shell', shellId),
  writeShell: (shellId: string, data: string): void => {
    ipcRenderer.send('ssh:shell-write', { shellId, data });
  },
  resizeShell: (shellId: string, cols: number, rows: number): void => {
    ipcRenderer.send('ssh:shell-resize', { shellId, cols, rows });
  },
  onShellData: (listener: (payload: ShellDataPayload) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: ShellDataPayload): void => listener(payload);
    ipcRenderer.on('ssh:shell-data', wrapped);
    return () => ipcRenderer.removeListener('ssh:shell-data', wrapped);
  },
  onShellClosed: (listener: (payload: ShellClosedPayload) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: ShellClosedPayload): void => listener(payload);
    ipcRenderer.on('ssh:shell-closed', wrapped);
    return () => ipcRenderer.removeListener('ssh:shell-closed', wrapped);
  },
  onRemoteBrowserError: (listener: (payload: RemoteBrowserErrorPayload) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: RemoteBrowserErrorPayload): void => listener(payload);
    ipcRenderer.on('ssh:remote-browser-error', wrapped);
    return () => ipcRenderer.removeListener('ssh:remote-browser-error', wrapped);
  },
  listDir: (sessionId: string, remotePath: string): Promise<RemoteEntry[]> =>
    ipcRenderer.invoke('ssh:list-dir', { sessionId, remotePath }),
  pickLocalFile: (): Promise<string | null> => ipcRenderer.invoke('file:pick-local'),
  pickLocalDirectory: (): Promise<string | null> => ipcRenderer.invoke('file:pick-local-directory'),
  pickPrivateKeyFile: (): Promise<string | null> => ipcRenderer.invoke('file:pick-private-key'),
  uploadFile: (
    sessionId: string,
    localPath: string,
    remoteDir: string
  ): Promise<UploadResult> => ipcRenderer.invoke('ssh:upload-file', { sessionId, localPath, remoteDir }),
  uploadDirectory: (
    sessionId: string,
    localPath: string,
    remoteDir: string
  ): Promise<UploadResult> => ipcRenderer.invoke('ssh:upload-directory', { sessionId, localPath, remoteDir }),
  downloadFileToWorkspace: (sessionId: string, remotePath: string): Promise<DownloadResult> =>
    ipcRenderer.invoke('ssh:download-file-to-workspace', { sessionId, remotePath }),
  downloadDirectoryToWorkspace: (sessionId: string, remotePath: string): Promise<DownloadResult> =>
    ipcRenderer.invoke('ssh:download-directory-to-workspace', { sessionId, remotePath }),
  getWorkspacePath: (): Promise<string> => ipcRenderer.invoke('workspace:get-path'),
  revealWorkspace: (): Promise<string> => ipcRenderer.invoke('workspace:reveal'),
  listConnectionProfiles: (): Promise<ConnectionProfile[]> =>
    ipcRenderer.invoke('connection:list-profiles'),
  listRecentConnections: (): Promise<RecentConnection[]> =>
    ipcRenderer.invoke('connection:list-recent'),
  listRecentBrowserVisits: (): Promise<RecentBrowserVisit[]> =>
    ipcRenderer.invoke('browser:list-recent'),
  deleteRecentBrowserVisit: (id: string): Promise<void> =>
    ipcRenderer.invoke('browser:delete-recent', id),
  upsertConnectionProfile: (input: UpsertConnectionProfileInput): Promise<ConnectionProfile> =>
    ipcRenderer.invoke('connection:upsert-profile', input),
  deleteConnectionProfile: (id: string): Promise<void> =>
    ipcRenderer.invoke('connection:delete-profile', id),
  openRemoteBrowser: (
    request: OpenRemoteBrowserRequest
  ): Promise<OpenRemoteBrowserResult> => ipcRenderer.invoke('ssh:open-remote-browser', request)
};

contextBridge.exposeInMainWorld('sshApi', api);

export type SshRendererApi = typeof api;
