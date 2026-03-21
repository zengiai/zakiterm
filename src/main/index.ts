import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';
import { Client } from 'ssh2';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type {
  ConnectionProfile,
  OpenRemoteBrowserRequest,
  OpenRemoteBrowserResult,
  RecentConnection,
  RemoteEntry,
  SshConnectConfig,
  SshConnectResult,
  UpsertConnectionProfileInput
} from '../shared/types';

interface SessionState {
  id: string;
  conn: Client;
  sftp?: SFTPWrapper;
  shellIds: Set<string>;
  tunnelPorts: Set<number>;
}

const sessions = new Map<string, SessionState>();
const shellStreams = new Map<string, ClientChannel>();
const shellToSession = new Map<string, string>();
const tunnelServers = new Map<number, net.Server>();
const TUNNEL_CONNECT_TIMEOUT_MS = 5_000;

let mainWindow: BrowserWindow | null = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function emitToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toTunnelErrorMessage(remoteHost: string, remotePort: number, error: unknown): string {
  const message = toErrorMessage(error);
  if (message.includes('Connection refused')) {
    return `远程地址 ${remoteHost}:${remotePort} 拒绝连接，请确认目标服务已启动并监听在远端机器。`;
  }
  return `远程地址 ${remoteHost}:${remotePort} 无法建立隧道: ${message}`;
}

async function ensureWorkspaceDir(): Promise<string> {
  const workspacePath = path.join(app.getPath('downloads'), 'ssh-client-workspace');
  await fs.mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

function getConnectionProfileFilePath(): string {
  return path.join(app.getPath('userData'), 'connection-profiles.json');
}

function getRecentConnectionFilePath(): string {
  return path.join(app.getPath('userData'), 'recent-connections.json');
}

async function loadConnectionProfiles(): Promise<ConnectionProfile[]> {
  const filePath = getConnectionProfileFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as ConnectionProfile[];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function loadRecentConnections(): Promise<RecentConnection[]> {
  const filePath = getRecentConnectionFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as RecentConnection[];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function saveConnectionProfiles(profiles: ConnectionProfile[]): Promise<void> {
  const filePath = getConnectionProfileFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(profiles, null, 2), 'utf-8');
}

async function saveRecentConnections(connections: RecentConnection[]): Promise<void> {
  const filePath = getRecentConnectionFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(connections, null, 2), 'utf-8');
}

async function recordRecentConnection(config: SshConnectConfig): Promise<void> {
  const now = Date.now();
  const identity = `${config.username}@${config.host}:${config.port}:${config.authType}`;
  const connections = await loadRecentConnections();
  const nextConnection: RecentConnection = {
    id: identity,
    name: `${config.username}@${config.host}:${config.port}`,
    host: config.host,
    port: config.port,
    username: config.username,
    authType: config.authType,
    password: config.authType === 'password' ? config.password : undefined,
    privateKeyPath: config.authType === 'privateKey' ? config.privateKeyPath : undefined,
    passphrase: config.authType === 'privateKey' ? config.passphrase : undefined,
    lastConnectedAt: now
  };

  const nextConnections = connections.filter((item) => item.id !== identity);
  nextConnections.unshift(nextConnection);
  await saveRecentConnections(nextConnections.slice(0, 8));
}

async function upsertConnectionProfile(input: UpsertConnectionProfileInput): Promise<ConnectionProfile> {
  if (!input.name.trim()) {
    throw new Error('配置名称不能为空。');
  }

  const now = Date.now();
  const profiles = await loadConnectionProfiles();
  const profileId = input.id ?? randomUUID();
  const existing = profiles.find((profile) => profile.id === profileId);

  const profile: ConnectionProfile = {
    id: profileId,
    name: input.name,
    host: input.host,
    port: input.port,
    username: input.username,
    authType: input.authType,
    password: input.authType === 'password' ? input.password : undefined,
    privateKeyPath: input.authType === 'privateKey' ? input.privateKeyPath : undefined,
    passphrase: input.authType === 'privateKey' ? input.passphrase : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  const nextProfiles = profiles.filter((item) => item.id !== profileId);
  nextProfiles.push(profile);
  nextProfiles.sort((a, b) => b.updatedAt - a.updatedAt);
  await saveConnectionProfiles(nextProfiles);

  return profile;
}

async function deleteConnectionProfile(id: string): Promise<void> {
  const profiles = await loadConnectionProfiles();
  const nextProfiles = profiles.filter((profile) => profile.id !== id);
  await saveConnectionProfiles(nextProfiles);
}

function normalizeRemotePath(remotePath: string): string {
  if (!remotePath || remotePath.trim() === '') {
    return '/';
  }
  const normalized = path.posix.normalize(remotePath);
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function resolveSession(sessionId: string): SessionState {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('SSH 会话不存在，请先连接。');
  }
  return session;
}

async function getSftp(sessionId: string): Promise<SFTPWrapper> {
  const session = resolveSession(sessionId);
  if (session.sftp) {
    return session.sftp;
  }

  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    session.conn.sftp((error, wrapper) => {
      if (error || !wrapper) {
        reject(error ?? new Error('创建 SFTP 会话失败。'));
        return;
      }
      resolve(wrapper);
    });
  });

  session.sftp = sftp;
  return sftp;
}

async function closeTunnel(port: number): Promise<void> {
  const server = tunnelServers.get(port);
  if (!server) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  tunnelServers.delete(port);
}

async function closeShell(shellId: string): Promise<void> {
  const stream = shellStreams.get(shellId);
  const sessionId = shellToSession.get(shellId);
  if (!stream) {
    if (sessionId) {
      const session = sessions.get(sessionId);
      session?.shellIds.delete(shellId);
      shellToSession.delete(shellId);
    }
    return;
  }

  if (sessionId) {
    const session = sessions.get(sessionId);
    session?.shellIds.delete(shellId);
  }

  shellStreams.delete(shellId);
  shellToSession.delete(shellId);
  stream.end('exit\n');
}

async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  for (const shellId of Array.from(session.shellIds)) {
    await closeShell(shellId);
  }

  for (const port of Array.from(session.tunnelPorts)) {
    await closeTunnel(port);
  }

  session.conn.end();
  sessions.delete(sessionId);
}

async function connectSsh(config: SshConnectConfig): Promise<SshConnectResult> {
  const conn = new Client();

  let resolvedPrivateKey: string | undefined = config.privateKey;
  if (config.privateKeyPath) {
    resolvedPrivateKey = await fs.readFile(config.privateKeyPath, 'utf-8');
  }

  const connectConfig: ConnectConfig = {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.authType === 'password' ? config.password : undefined,
    privateKey: config.authType === 'privateKey' ? resolvedPrivateKey : undefined,
    passphrase: config.authType === 'privateKey' ? config.passphrase : undefined,
    readyTimeout: 12_000,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3
  };

  await new Promise<void>((resolve, reject) => {
    conn.once('ready', () => resolve());
    conn.once('error', (error) => reject(error));
    conn.connect(connectConfig);
  });

  const sessionId = randomUUID();
  const state: SessionState = {
    id: sessionId,
    conn,
    shellIds: new Set(),
    tunnelPorts: new Set()
  };

  conn.on('close', () => {
    sessions.delete(state.id);
  });

  sessions.set(state.id, state);
  await recordRecentConnection(config);
  return { sessionId: state.id };
}

async function listRemoteDir(sessionId: string, remotePath: string): Promise<RemoteEntry[]> {
  const sftp = await getSftp(sessionId);
  const normalized = normalizeRemotePath(remotePath);

  const items = await new Promise<RemoteEntry[]>((resolve, reject) => {
    sftp.readdir(normalized, (error, list) => {
      if (error || !list) {
        reject(error ?? new Error('读取远程目录失败。'));
        return;
      }

      const mapped = list.map((entry) => {
        const fullPath =
          normalized === '/' ? `/${entry.filename}` : path.posix.join(normalized, entry.filename);
        const isDirectory = Boolean(entry.attrs?.isDirectory?.());
        return {
          name: entry.filename,
          path: fullPath,
          isDirectory,
          size: entry.attrs?.size ?? 0,
          modifyTime: entry.attrs?.mtime ?? 0
        };
      });

      mapped.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      resolve(mapped);
    });
  });

  return items;
}

async function downloadFileToWorkspace(sessionId: string, remotePath: string): Promise<string> {
  const sftp = await getSftp(sessionId);
  const workspace = await ensureWorkspaceDir();
  const baseName = path.posix.basename(remotePath);
  const targetPath = path.join(workspace, baseName);

  let finalPath = targetPath;
  try {
    await fs.access(finalPath);
    finalPath = path.join(workspace, `${Date.now()}-${baseName}`);
  } catch {
    // 文件不存在时直接使用原始路径。
  }

  await new Promise<void>((resolve, reject) => {
    sftp.fastGet(remotePath, finalPath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return finalPath;
}

async function uploadFile(sessionId: string, localPath: string, remoteDir: string): Promise<string> {
  const sftp = await getSftp(sessionId);
  const normalizedDir = normalizeRemotePath(remoteDir);
  const fileName = path.basename(localPath);
  const remotePath = path.posix.join(normalizedDir, fileName);

  await fs.access(localPath);

  await new Promise<void>((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return remotePath;
}

async function openShell(sessionId: string): Promise<string> {
  const session = resolveSession(sessionId);
  const stream = await new Promise<ClientChannel>((resolve, reject) => {
    session.conn.shell((error, channel) => {
      if (error || !channel) {
        reject(error ?? new Error('创建终端失败。'));
        return;
      }
      resolve(channel);
    });
  });

  const shellId = randomUUID();
  session.shellIds.add(shellId);
  shellStreams.set(shellId, stream);
  shellToSession.set(shellId, sessionId);

  stream.on('data', (chunk: Buffer) => {
    emitToRenderer('ssh:shell-data', { sessionId, shellId, data: chunk.toString('utf-8') });
  });

  stream.stderr.on('data', (chunk: Buffer) => {
    emitToRenderer('ssh:shell-data', { sessionId, shellId, data: chunk.toString('utf-8') });
  });

  stream.on('close', (code: number | undefined) => {
    shellStreams.delete(shellId);
    shellToSession.delete(shellId);
    session.shellIds.delete(shellId);
    emitToRenderer('ssh:shell-closed', { sessionId, shellId, code: code ?? 0 });
  });

  return shellId;
}

function getAvailableLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const testServer = net.createServer();
    testServer.once('error', (error) => reject(error));
    testServer.listen(0, '127.0.0.1', () => {
      const address = testServer.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        testServer.close(() => resolve(port));
      } else {
        testServer.close(() => reject(new Error('无法分配本地端口。')));
      }
    });
  });
}

async function validateTunnelTarget(
  session: SessionState,
  remoteHost: string,
  remotePort: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`远程地址 ${remoteHost}:${remotePort} 连接超时，请确认服务可访问。`));
    }, TUNNEL_CONNECT_TIMEOUT_MS);

    session.conn.forwardOut('127.0.0.1', 0, remoteHost, remotePort, (error, stream) => {
      if (settled) {
        stream?.end();
        return;
      }

      if (error || !stream) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(toTunnelErrorMessage(remoteHost, remotePort, error)));
        return;
      }

      stream.once('error', (streamError: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(new Error(toTunnelErrorMessage(remoteHost, remotePort, streamError)));
      });

      // 只验证目标端口是否可连通，不等待远端主动关闭连接。
      settled = true;
      clearTimeout(timer);
      stream.end();
      resolve();
    });
  });
}

async function openRemoteBrowser(
  request: OpenRemoteBrowserRequest
): Promise<OpenRemoteBrowserResult> {
  const session = resolveSession(request.sessionId);
  await validateTunnelTarget(session, request.remoteHost, request.remotePort);
  const localPort = await getAvailableLocalPort();

  const server = net.createServer((socket) => {
    socket.on('error', () => {
      // 浏览器断开、隧道失败时避免把 socket 错误升级成主进程未捕获异常。
    });

    session.conn.forwardOut(
      socket.remoteAddress ?? '127.0.0.1',
      socket.remotePort ?? 0,
      request.remoteHost,
      request.remotePort,
      (error, stream) => {
        if (error || !stream) {
          socket.destroy(new Error(toTunnelErrorMessage(request.remoteHost, request.remotePort, error)));
          return;
        }

        socket.pipe(stream);
        stream.pipe(socket);

        stream.on('error', (streamError: Error) => {
          socket.destroy(new Error(toTunnelErrorMessage(request.remoteHost, request.remotePort, streamError)));
        });
        socket.on('error', () => stream.end());
      }
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (error) => reject(error));
    server.listen(localPort, '127.0.0.1', () => resolve());
  });

  tunnelServers.set(localPort, server);
  session.tunnelPorts.add(localPort);

  const normalizedPath = request.pathname.startsWith('/') ? request.pathname : `/${request.pathname}`;
  const url = `${request.protocol}://127.0.0.1:${localPort}${normalizedPath}`;

  const browserWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: `Remote Browser - ${request.remoteHost}:${request.remotePort}`
  });

  void browserWindow.loadURL(url).catch(async (error) => {
    browserWindow.destroy();
    await closeTunnel(localPort);
    session.tunnelPorts.delete(localPort);
    emitToRenderer('ssh:remote-browser-error', {
      sessionId: request.sessionId,
      message: toTunnelErrorMessage(request.remoteHost, request.remotePort, error)
    });
  });

  browserWindow.on('closed', () => {
    void closeTunnel(localPort);
    session.tunnelPorts.delete(localPort);
  });

  return { localPort, url };
}

ipcMain.handle('ssh:connect', async (_event, config: SshConnectConfig) => {
  try {
    return await connectSsh(config);
  } catch (error) {
    throw new Error(`SSH 连接失败: ${toErrorMessage(error)}`);
  }
});

ipcMain.handle('ssh:disconnect', async (_event, sessionId: string) => {
  await closeSession(sessionId);
});

ipcMain.handle('ssh:list-dir', async (_event, payload: { sessionId: string; remotePath: string }) => {
  try {
    return await listRemoteDir(payload.sessionId, payload.remotePath);
  } catch (error) {
    throw new Error(`读取目录失败: ${toErrorMessage(error)}`);
  }
});

ipcMain.handle(
  'ssh:download-file-to-workspace',
  async (_event, payload: { sessionId: string; remotePath: string }) => {
    try {
      const localPath = await downloadFileToWorkspace(payload.sessionId, payload.remotePath);
      return { localPath };
    } catch (error) {
      throw new Error(`下载文件失败: ${toErrorMessage(error)}`);
    }
  }
);

ipcMain.handle(
  'ssh:upload-file',
  async (_event, payload: { sessionId: string; localPath: string; remoteDir: string }) => {
    try {
      const remotePath = await uploadFile(payload.sessionId, payload.localPath, payload.remoteDir);
      return { remotePath };
    } catch (error) {
      throw new Error(`上传文件失败: ${toErrorMessage(error)}`);
    }
  }
);

ipcMain.handle('file:pick-local', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: '选择要上传的本地文件'
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('file:pick-private-key', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: '选择私钥文件'
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('workspace:get-path', async () => ensureWorkspaceDir());

ipcMain.handle('workspace:reveal', async () => {
  const workspacePath = await ensureWorkspaceDir();
  await shell.openPath(workspacePath);
  return workspacePath;
});

ipcMain.handle('connection:list-profiles', async () => {
  return await loadConnectionProfiles();
});

ipcMain.handle('connection:list-recent', async () => {
  return await loadRecentConnections();
});

ipcMain.handle('connection:upsert-profile', async (_event, input: UpsertConnectionProfileInput) => {
  return await upsertConnectionProfile(input);
});

ipcMain.handle('connection:delete-profile', async (_event, id: string) => {
  await deleteConnectionProfile(id);
});

ipcMain.handle('ssh:open-shell', async (_event, sessionId: string) => {
  try {
    return await openShell(sessionId);
  } catch (error) {
    throw new Error(`创建终端失败: ${toErrorMessage(error)}`);
  }
});

ipcMain.handle('ssh:close-shell', async (_event, shellId: string) => {
  await closeShell(shellId);
});

ipcMain.on('ssh:shell-write', (_event, payload: { shellId: string; data: string }) => {
  const stream = shellStreams.get(payload.shellId);
  if (!stream) {
    return;
  }
  stream.write(payload.data);
});

ipcMain.on('ssh:shell-resize', (_event, payload: { shellId: string; cols: number; rows: number }) => {
  const stream = shellStreams.get(payload.shellId);
  if (!stream) {
    return;
  }

  // SSH 的 window-change 只用于交互体验，不影响业务一致性。
  stream.setWindow(payload.rows, payload.cols, 0, 0);
});

ipcMain.handle('ssh:open-remote-browser', async (_event, request: OpenRemoteBrowserRequest) => {
  try {
    return await openRemoteBrowser(request);
  } catch (error) {
    throw new Error(`打开远程浏览器失败: ${toErrorMessage(error)}`);
  }
});

app.whenReady().then(async () => {
  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  for (const sessionId of sessions.keys()) {
    void closeSession(sessionId);
  }
});
