export type AuthType = 'password' | 'privateKey';

export interface SshConnectConfig {
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export interface SshConnectResult {
  sessionId: string;
}

export interface RemoteEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime: number;
}

export interface UploadResult {
  remotePath: string;
}

export interface DownloadResult {
  localPath: string;
}

export interface OpenRemoteBrowserRequest {
  sessionId: string;
  remoteHost: string;
  remotePort: number;
  protocol: 'http' | 'https';
  pathname: string;
}

export interface OpenRemoteBrowserResult {
  localPort: number;
  url: string;
}

export interface RemoteBrowserErrorPayload {
  sessionId: string;
  message: string;
}

export interface ShellDataPayload {
  sessionId: string;
  shellId: string;
  data: string;
}

export interface ShellClosedPayload {
  sessionId: string;
  shellId: string;
  code: number;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertConnectionProfileInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export interface RecentConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  lastConnectedAt: number;
}
