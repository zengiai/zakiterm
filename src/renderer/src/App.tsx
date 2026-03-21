import { useEffect, useMemo, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { AuthType, ConnectionProfile, RecentConnection, RemoteEntry } from '../../shared/types';

interface TreeNode extends RemoteEntry {
  children?: TreeNode[];
  loaded?: boolean;
  expanded?: boolean;
}

interface SessionTab {
  sessionId: string;
  shellId: string;
  title: string;
  host: string;
  username: string;
  tree: TreeNode[];
  selectedPath: string;
  loadingPathSet: Set<string>;
  terminalBuffer: string;
}

type ViewMode = 'connect' | 'files' | 'terminal' | 'browser';

interface NavigationItem {
  key: ViewMode;
  label: string;
  hint: string;
}

function renderNavIcon(view: ViewMode): JSX.Element {
  switch (view) {
    case 'connect':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7.5h14M5 12h10M5 16.5h8" />
          <path d="M17 14l3 3-3 3" />
        </svg>
      );
    case 'files':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7.5h5l2 2H20v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          <path d="M4 7.5V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1.5" />
        </svg>
      );
    case 'terminal':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
          <path d="M7 10l2.5 2L7 14.5" />
          <path d="M12 15h4.5" />
        </svg>
      );
    case 'browser':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M4.5 9h15" />
          <path d="M4.5 15h15" />
          <path d="M12 4a13 13 0 0 1 0 16" />
          <path d="M12 4a13 13 0 0 0 0 16" />
        </svg>
      );
  }
}

function toTreeNode(entry: RemoteEntry): TreeNode {
  return {
    ...entry,
    children: entry.isDirectory ? [] : undefined,
    loaded: !entry.isDirectory,
    expanded: false
  };
}

function createRootNode(): TreeNode {
  return {
    name: '/',
    path: '/',
    isDirectory: true,
    size: 0,
    modifyTime: 0,
    children: [],
    loaded: false,
    expanded: true
  };
}

function getParentPath(remotePath: string): string {
  if (remotePath === '/') {
    return '/';
  }

  const trimmed = remotePath.endsWith('/') ? remotePath.slice(0, -1) : remotePath;
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) {
    return '/';
  }
  return trimmed.slice(0, idx);
}

function updateNode(nodes: TreeNode[], targetPath: string, updater: (node: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return updater(node);
    }

    if (!node.children || node.children.length === 0) {
      return node;
    }

    return {
      ...node,
      children: updateNode(node.children, targetPath, updater)
    };
  });
}

function flattenNode(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  const stack = [...nodes];

  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) {
      continue;
    }

    result.push(current);
    if (current.children && current.children.length > 0) {
      stack.unshift(...current.children);
    }
  }

  return result;
}

function appendTerminalBuffer(current: string, next: string): string {
  const merged = current + next;
  const maxSize = 200_000;
  if (merged.length <= maxSize) {
    return merged;
  }
  return merged.slice(-maxSize);
}

function formatRecentTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function App(): JSX.Element {
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionsRef = useRef<SessionTab[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);

  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('root');
  const [authType, setAuthType] = useState<AuthType>('password');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const [profileName, setProfileName] = useState('');
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  const [sessions, setSessions] = useState<SessionTab[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewMode>('connect');

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('未连接');

  const [workspacePath, setWorkspacePath] = useState('');
  const [browserRemoteHost, setBrowserRemoteHost] = useState('127.0.0.1');
  const [browserRemotePort, setBrowserRemotePort] = useState(80);
  const [browserProtocol, setBrowserProtocol] = useState<'http' | 'https'>('http');
  const [browserPathname, setBrowserPathname] = useState('/');

  const statusTone = message.includes('失败') || message.includes('错误') ? 'error' : 'normal';
  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );
  const navigationItems: NavigationItem[] = [
    { key: 'connect', label: '连接管理', hint: '配置与新建连接' },
    { key: 'files', label: '文件传输', hint: '浏览、上传、下载' },
    { key: 'terminal', label: 'SSH 终端', hint: '命令行交互' },
    { key: 'browser', label: '远程浏览器', hint: 'SSH 隧道访问' }
  ];

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  async function reloadProfiles(): Promise<void> {
    const loaded = await window.sshApi.listConnectionProfiles();
    setProfiles(loaded);
  }

  async function reloadRecentConnections(): Promise<void> {
    const loaded = await window.sshApi.listRecentConnections();
    setRecentConnections(loaded);
  }

  useEffect(() => {
    void window.sshApi
      .getWorkspacePath()
      .then(setWorkspacePath)
      .catch(() => {
        setWorkspacePath('工作区路径获取失败');
      });

    void reloadProfiles().catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });

    void reloadRecentConnections().catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });
  }, []);

  function getSessionById(sessionId: string): SessionTab | undefined {
    return sessionsRef.current.find((session) => session.sessionId === sessionId);
  }

  function getActiveSessionFromRef(): SessionTab | null {
    const currentId = activeSessionIdRef.current;
    if (!currentId) {
      return null;
    }
    return getSessionById(currentId) ?? null;
  }

  function updateSession(sessionId: string, updater: (session: SessionTab) => SessionTab): void {
    setSessions((prev) => prev.map((session) => (session.sessionId === sessionId ? updater(session) : session)));
  }

  useEffect(() => {
    if (!terminalContainerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      theme: {
        background: '#0f1722',
        foreground: '#d6deeb'
      }
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const dataDisposable = terminal.onData((data) => {
      const active = getActiveSessionFromRef();
      if (!active || !active.shellId) {
        return;
      }
      window.sshApi.writeShell(active.shellId, data);
    });

    const resizeHandler = (): void => {
      fitAddon.fit();
      const active = getActiveSessionFromRef();
      if (active?.shellId) {
        window.sshApi.resizeShell(active.shellId, terminal.cols, terminal.rows);
      }
    };

    window.addEventListener('resize', resizeHandler);

    return () => {
      dataDisposable.dispose();
      window.removeEventListener('resize', resizeHandler);
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    const offData = window.sshApi.onShellData((payload) => {
      updateSession(payload.sessionId, (session) => {
        if (session.shellId !== payload.shellId) {
          return session;
        }
        return {
          ...session,
          terminalBuffer: appendTerminalBuffer(session.terminalBuffer, payload.data)
        };
      });

      const active = getActiveSessionFromRef();
      if (active && active.sessionId === payload.sessionId && active.shellId === payload.shellId) {
        terminalRef.current?.write(payload.data);
      }
    });

    const offClosed = window.sshApi.onShellClosed((payload) => {
      const closeTip = `\r\n[shell closed: ${payload.code}]\r\n`;

      updateSession(payload.sessionId, (session) => {
        if (session.shellId !== payload.shellId) {
          return session;
        }
        return {
          ...session,
          shellId: '',
          terminalBuffer: appendTerminalBuffer(session.terminalBuffer, closeTip)
        };
      });

      const active = getActiveSessionFromRef();
      if (active && active.sessionId === payload.sessionId) {
        terminalRef.current?.write(closeTip);
      }

      setMessage(`会话终端已关闭: ${payload.code}`);
    });

    return () => {
      offData();
      offClosed();
    };
  }, []);

  useEffect(() => {
    const offRemoteBrowserError = window.sshApi.onRemoteBrowserError((payload) => {
      setMessage(payload.message);
    });

    return () => {
      offRemoteBrowserError();
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    terminal.clear();

    if (!activeSessionId) {
      return;
    }

    const current = sessionsRef.current.find((session) => session.sessionId === activeSessionId);
    if (!current) {
      return;
    }

    if (current.terminalBuffer) {
      terminal.write(current.terminalBuffer);
    }

    fitAddon.fit();
    if (current.shellId) {
      window.sshApi.resizeShell(current.shellId, terminal.cols, terminal.rows);
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (activeView !== 'terminal') {
      return;
    }

    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    const timer = window.setTimeout(() => {
      fitAddon.fit();
      const active = getActiveSessionFromRef();
      if (active?.shellId) {
        window.sshApi.resizeShell(active.shellId, terminal.cols, terminal.rows);
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeView, activeSessionId]);

  const activeNodeMap = useMemo(() => {
    const map = new Map<string, TreeNode>();
    if (!activeSession) {
      return map;
    }

    for (const node of flattenNode(activeSession.tree)) {
      map.set(node.path, node);
    }
    return map;
  }, [activeSession]);
  const selectedNode = activeSession ? activeNodeMap.get(activeSession.selectedPath) ?? null : null;
  const activeSessionStats = useMemo(() => {
    if (!activeSession) {
      return null;
    }

    const nodes = flattenNode(activeSession.tree);
    const directoryCount = nodes.filter((node) => node.isDirectory).length;
    const fileCount = nodes.length - directoryCount;

    return {
      directoryCount,
      fileCount,
      selectedType: selectedNode ? (selectedNode.isDirectory ? '目录' : '文件') : '未选中',
      shellState: activeSession.shellId ? '运行中' : '已关闭'
    };
  }, [activeSession, selectedNode]);

  async function loadChildren(sessionId: string, targetPath: string): Promise<void> {
    updateSession(sessionId, (session) => {
      const nextLoadingSet = new Set(session.loadingPathSet);
      nextLoadingSet.add(targetPath);
      return {
        ...session,
        loadingPathSet: nextLoadingSet
      };
    });

    try {
      const entries = await window.sshApi.listDir(sessionId, targetPath);
      const children = entries.map(toTreeNode);

      updateSession(sessionId, (session) => ({
        ...session,
        tree: updateNode(session.tree, targetPath, (node) => ({
          ...node,
          children,
          loaded: true,
          expanded: true
        }))
      }));
    } finally {
      updateSession(sessionId, (session) => {
        const nextLoadingSet = new Set(session.loadingPathSet);
        nextLoadingSet.delete(targetPath);
        return {
          ...session,
          loadingPathSet: nextLoadingSet
        };
      });
    }
  }

  async function connectWithConfig(config: {
    host: string;
    port: number;
    username: string;
    authType: AuthType;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
  }): Promise<void> {
    if (busy) {
      return;
    }

    if (config.authType === 'privateKey' && !config.privateKeyPath?.trim()) {
      setMessage('私钥模式下必须选择私钥文件。');
      return;
    }

    setBusy(true);
    setMessage('正在建立 SSH 连接...');

    try {
      const result = await window.sshApi.connect(config);

      const newShellId = await window.sshApi.openShell(result.sessionId);
      const title = `${config.username}@${config.host}:${config.port}`;

      setSessions((prev) => [
        ...prev,
        {
          sessionId: result.sessionId,
          shellId: newShellId,
          title,
          host: config.host,
          username: config.username,
          tree: [createRootNode()],
          selectedPath: '/',
          loadingPathSet: new Set(),
          terminalBuffer: ''
        }
      ]);
      setActiveSessionId(result.sessionId);
      setActiveView('terminal');

      await loadChildren(result.sessionId, '/');
      await reloadRecentConnections();
      setMessage(`连接成功: ${title}`);

      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (terminal && fitAddon) {
        terminal.clear();
        fitAddon.fit();
        window.sshApi.resizeShell(newShellId, terminal.cols, terminal.rows);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function connect(): Promise<void> {
    await connectWithConfig({
      host,
      port,
      username,
      authType,
      password: authType === 'password' ? password : undefined,
      privateKeyPath: authType === 'privateKey' ? privateKeyPath : undefined,
      passphrase: authType === 'privateKey' ? passphrase : undefined
    });
  }

  async function disconnectSession(sessionId: string): Promise<void> {
    const target = getSessionById(sessionId);
    if (!target) {
      return;
    }

    setBusy(true);
    try {
      if (target.shellId) {
        await window.sshApi.closeShell(target.shellId);
      }
      await window.sshApi.disconnect(sessionId);

      const before = sessionsRef.current;
      const currentIndex = before.findIndex((item) => item.sessionId === sessionId);
      const nextSessions = before.filter((item) => item.sessionId !== sessionId);

      setSessions(nextSessions);

      if (activeSessionIdRef.current === sessionId) {
        const fallback = nextSessions[currentIndex - 1] ?? nextSessions[0] ?? null;
        setActiveSessionId(fallback?.sessionId ?? null);
      }

      if (nextSessions.length === 0) {
        terminalRef.current?.clear();
      }

      setMessage(`连接已断开: ${target.title}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleFolder(node: TreeNode): Promise<void> {
    if (!activeSession || !node.isDirectory) {
      return;
    }

    const shouldExpand = !node.expanded;
    const currentSessionId = activeSession.sessionId;

    updateSession(currentSessionId, (session) => ({
      ...session,
      tree: updateNode(session.tree, node.path, (current) => ({
        ...current,
        expanded: shouldExpand
      }))
    }));

    if (shouldExpand && !node.loaded) {
      try {
        await loadChildren(currentSessionId, node.path);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function refreshSelectedDir(): Promise<void> {
    if (!activeSession) {
      return;
    }

    const selectedNode = activeNodeMap.get(activeSession.selectedPath);
    const targetPath = selectedNode?.isDirectory
      ? selectedNode.path
      : getParentPath(activeSession.selectedPath);

    try {
      await loadChildren(activeSession.sessionId, targetPath);
      setMessage(`目录已刷新: ${targetPath}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function downloadSelected(): Promise<void> {
    if (!activeSession) {
      return;
    }

    const selectedNode = activeNodeMap.get(activeSession.selectedPath);
    if (!selectedNode || selectedNode.isDirectory) {
      setMessage('请选择一个文件再下载。');
      return;
    }

    setBusy(true);
    try {
      const result = await window.sshApi.downloadFileToWorkspace(activeSession.sessionId, selectedNode.path);
      setMessage(`下载完成: ${result.localPath}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadToSelectedDir(): Promise<void> {
    if (!activeSession) {
      return;
    }

    const selectedNode = activeNodeMap.get(activeSession.selectedPath);
    const remoteDir = selectedNode?.isDirectory
      ? selectedNode.path
      : getParentPath(activeSession.selectedPath);

    try {
      const localFile = await window.sshApi.pickLocalFile();
      if (!localFile) {
        return;
      }

      setBusy(true);
      const result = await window.sshApi.uploadFile(activeSession.sessionId, localFile, remoteDir);
      setMessage(`上传成功: ${result.remotePath}`);
      await loadChildren(activeSession.sessionId, remoteDir);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function openWorkspace(): Promise<void> {
    try {
      const resolved = await window.sshApi.revealWorkspace();
      setWorkspacePath(resolved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openRemoteBrowserWindow(): Promise<void> {
    if (!activeSession) {
      setMessage('请先建立 SSH 连接。');
      return;
    }

    setBusy(true);
    try {
      const result = await window.sshApi.openRemoteBrowser({
        sessionId: activeSession.sessionId,
        remoteHost: browserRemoteHost,
        remotePort: browserRemotePort,
        protocol: browserProtocol,
        pathname: browserPathname
      });

      setMessage(`远程浏览器已打开: ${result.url}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function pickPrivateKey(): Promise<void> {
    try {
      const selected = await window.sshApi.pickPrivateKeyFile();
      if (!selected) {
        return;
      }
      setPrivateKeyPath(selected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveProfile(): Promise<void> {
    if (busy) {
      return;
    }

    const finalName = profileName.trim() || `${username}@${host}:${port}`;

    setBusy(true);
    try {
      const saved = await window.sshApi.upsertConnectionProfile({
        id: selectedProfileId || undefined,
        name: finalName,
        host,
        port,
        username,
        authType,
        password: authType === 'password' ? password : undefined,
        privateKeyPath: authType === 'privateKey' ? privateKeyPath : undefined,
        passphrase: authType === 'privateKey' ? passphrase : undefined
      });

      await reloadProfiles();
      setSelectedProfileId(saved.id);
      setProfileName(saved.name);
      setMessage(`配置已保存: ${saved.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile(): Promise<void> {
    if (!selectedProfileId) {
      setMessage('请先选择要删除的配置。');
      return;
    }

    setBusy(true);
    try {
      await window.sshApi.deleteConnectionProfile(selectedProfileId);
      await reloadProfiles();
      setSelectedProfileId('');
      setProfileName('');
      setMessage('配置已删除。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function applyProfile(profileId: string): void {
    setSelectedProfileId(profileId);
    if (!profileId) {
      setProfileName('');
      return;
    }

    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    setProfileName(profile.name);
    setHost(profile.host);
    setPort(profile.port);
    setUsername(profile.username);
    setAuthType(profile.authType);
    setPassword(profile.password ?? '');
    setPrivateKeyPath(profile.privateKeyPath ?? '');
    setPassphrase(profile.passphrase ?? '');
  }

  function applyRecentConnection(connection: RecentConnection): void {
    setSelectedProfileId('');
    setProfileName(connection.name);
    setHost(connection.host);
    setPort(connection.port);
    setUsername(connection.username);
    setAuthType(connection.authType);
    setPassword(connection.password ?? '');
    setPrivateKeyPath(connection.privateKeyPath ?? '');
    setPassphrase(connection.passphrase ?? '');
  }

  async function quickConnectRecent(connection: RecentConnection): Promise<void> {
    applyRecentConnection(connection);

    await connectWithConfig({
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authType: connection.authType,
      password: connection.password,
      privateKeyPath: connection.privateKeyPath,
      passphrase: connection.passphrase
    });
  }

  function selectPath(targetPath: string): void {
    if (!activeSessionId) {
      return;
    }

    updateSession(activeSessionId, (session) => ({
      ...session,
      selectedPath: targetPath
    }));
  }

  function renderNodes(nodes: TreeNode[], depth: number, session: SessionTab): JSX.Element[] {
    return nodes.flatMap((node) => {
      const isSelected = session.selectedPath === node.path;
      const isLoading = session.loadingPathSet.has(node.path);

      const line = (
        <div
          key={node.path}
          className={`tree-line ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => selectPath(node.path)}
          onDoubleClick={() => {
            void toggleFolder(node);
          }}
        >
          <span className="tree-caret">{node.isDirectory ? (node.expanded ? 'v' : '>') : '-'}</span>
          <span className={`tree-type ${node.isDirectory ? 'dir' : 'file'}`}>
            {node.isDirectory ? 'DIR' : 'FILE'}
          </span>
          <span className="tree-name">{node.name}</span>
          {isLoading ? <span className="tree-loading">加载中...</span> : null}
        </div>
      );

      if (node.isDirectory && node.expanded && node.children && node.children.length > 0) {
        return [line, ...renderNodes(node.children, depth + 1, session)];
      }
      return [line];
    });
  }

  function renderEmptyState(title: string, description: string): JSX.Element {
    return (
      <div className="empty-state">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">SSH</div>
          <div>
            <h1>ZakiTerm</h1>
            <p>把连接、文件、终端和隧道访问拆成独立工作区。</p>
          </div>
        </div>

        <div className={`status-card ${statusTone === 'error' ? 'error' : 'normal'}`}>
          <span className="status-label">当前状态</span>
          <strong>{message}</strong>
        </div>

        <nav className="nav-list">
          {navigationItems.map((item) => {
            const disabled = item.key !== 'connect' && !activeSession;

            return (
              <button
                key={item.key}
                className={`nav-tab ${activeView === item.key ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => setActiveView(item.key)}
                disabled={disabled}
              >
                <span className="nav-tab-icon">{renderNavIcon(item.key)}</span>
                <span className="nav-tab-copy">
                  <span className="nav-tab-label">{item.label}</span>
                  <span className="nav-tab-hint">{item.hint}</span>
                </span>
                <span className="nav-tab-state">{disabled ? '待连接' : '可用'}</span>
              </button>
            );
          })}
        </nav>

        <section className="session-sidebar">
          <div className="sidebar-section-head">
            <h3>会话</h3>
            <span>{sessions.length} 个</span>
          </div>

          <div className="session-list">
            {sessions.length === 0 ? <div className="sidebar-empty">暂无连接，先去“连接管理”创建会话。</div> : null}
            {sessions.map((session) => (
              <div
                key={session.sessionId}
                className={`session-card ${activeSessionId === session.sessionId ? 'active' : ''}`}
              >
                <button
                  className="session-card-main"
                  onClick={() => {
                    setActiveSessionId(session.sessionId);
                    setActiveView('terminal');
                  }}
                >
                  <strong>{session.title}</strong>
                  <span>{session.selectedPath}</span>
                </button>
                <button className="session-card-close" onClick={() => void disconnectSession(session.sessionId)}>
                  断开
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="sidebar-meta">
          <div className="sidebar-section-head">
            <h3>当前会话</h3>
            <span>{activeSession ? '已连接' : '未连接'}</span>
          </div>
          {activeSession && activeSessionStats ? (
            <div className="session-stats">
              <div className="stat-pill">
                <span>主机</span>
                <strong>{activeSession.host}</strong>
              </div>
              <div className="stat-pill">
                <span>用户</span>
                <strong>{activeSession.username}</strong>
              </div>
              <div className="stat-pill">
                <span>终端</span>
                <strong>{activeSessionStats.shellState}</strong>
              </div>
              <div className="stat-pill">
                <span>选中项</span>
                <strong>{activeSessionStats.selectedType}</strong>
              </div>
              <div className="stat-pill">
                <span>目录数</span>
                <strong>{activeSessionStats.directoryCount}</strong>
              </div>
              <div className="stat-pill">
                <span>文件数</span>
                <strong>{activeSessionStats.fileCount}</strong>
              </div>
            </div>
          ) : (
            <p>建立连接后，这里会展示当前会话的主机、终端状态和文件概览。</p>
          )}

          <div className="sidebar-section-head workspace-meta-head">
            <h3>工作区</h3>
            <button className="btn-secondary" onClick={() => void openWorkspace()}>
              打开
            </button>
          </div>
          <p>{workspacePath}</p>
        </section>
      </aside>

      <main className="workspace-shell">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">当前工作区</span>
            <h2>{navigationItems.find((item) => item.key === activeView)?.label}</h2>
          </div>
          <div className="workspace-summary">
            <span>{activeSession ? activeSession.title : '未选择会话'}</span>
            <span>{activeSession ? `当前路径 ${activeSession.selectedPath}` : '请先建立 SSH 连接'}</span>
          </div>
        </header>

        <section className="content-stack">
          <div className={`content-panel ${activeView === 'connect' ? 'active' : 'hidden'}`}>
            <div className="panel-grid two-column">
              <section className="content-card">
                <div className="card-head">
                  <div>
                    <span className="card-kicker">Profiles</span>
                    <h3>连接配置</h3>
                  </div>
                </div>
                <div className="profile-row">
                  <label>
                    配置
                    <select value={selectedProfileId} onChange={(event) => applyProfile(event.target.value)} disabled={busy}>
                      <option value="">未选择</option>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    配置名称
                    <input value={profileName} onChange={(event) => setProfileName(event.target.value)} disabled={busy} />
                  </label>

                  <button className="btn-secondary" onClick={() => void saveProfile()} disabled={busy}>
                    保存配置
                  </button>
                  <button className="btn-danger" onClick={() => void deleteProfile()} disabled={busy || !selectedProfileId}>
                    删除配置
                  </button>
                </div>

                <div className="recent-section">
                  <div className="recent-head">
                    <div>
                      <span className="card-kicker">Recent</span>
                      <h4>最近连接</h4>
                    </div>
                    <span>{recentConnections.length} 条</span>
                  </div>

                  {recentConnections.length === 0 ? (
                    <p className="recent-empty">还没有成功连接记录，建立一次连接后会自动出现在这里。</p>
                  ) : (
                    <div className="recent-list">
                      {recentConnections.map((connection) => (
                        <div key={connection.id} className="recent-item">
                          <button
                            className="recent-item-main"
                            onClick={() => applyRecentConnection(connection)}
                            disabled={busy}
                          >
                            <strong>{connection.name}</strong>
                            <span>
                              {connection.authType === 'password' ? '密码登录' : '私钥登录'} · 最近连接于{' '}
                              {formatRecentTime(connection.lastConnectedAt)}
                            </span>
                          </button>
                          <button
                            className="btn-secondary recent-item-action"
                            onClick={() => void quickConnectRecent(connection)}
                            disabled={busy}
                          >
                            一键连接
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="content-card">
                <div className="card-head">
                  <div>
                    <span className="card-kicker">Connect</span>
                    <h3>新建 SSH 连接</h3>
                  </div>
                </div>

                <div className="connect-row">
                  <label>
                    Host
                    <input value={host} onChange={(event) => setHost(event.target.value)} disabled={busy} />
                  </label>
                  <label>
                    Port
                    <input
                      type="number"
                      value={port}
                      onChange={(event) => setPort(Number(event.target.value))}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Username
                    <input value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} />
                  </label>
                  <label>
                    认证方式
                    <select value={authType} onChange={(event) => setAuthType(event.target.value as AuthType)} disabled={busy}>
                      <option value="password">密码</option>
                      <option value="privateKey">私钥</option>
                    </select>
                  </label>

                  {authType === 'password' ? (
                    <label>
                      Password
                      <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        disabled={busy}
                      />
                    </label>
                  ) : (
                    <>
                      <label>
                        私钥路径
                        <input
                          value={privateKeyPath}
                          onChange={(event) => setPrivateKeyPath(event.target.value)}
                          disabled={busy}
                        />
                      </label>
                      <button className="btn-secondary" onClick={() => void pickPrivateKey()} disabled={busy}>
                        选择私钥
                      </button>
                      <label>
                        私钥口令
                        <input
                          type="password"
                          value={passphrase}
                          onChange={(event) => setPassphrase(event.target.value)}
                          disabled={busy}
                        />
                      </label>
                    </>
                  )}

                  <button className="btn-primary" onClick={() => void connect()} disabled={busy}>
                    新建连接
                  </button>
                </div>
              </section>
            </div>
          </div>

          <div className={`content-panel ${activeView === 'files' ? 'active' : 'hidden'}`}>
            {activeSession ? (
              <section className="content-card panel-fill">
                <div className="card-head">
                  <div>
                    <span className="card-kicker">Files</span>
                    <h3>远程文件浏览</h3>
                  </div>
                  <div className="card-actions">
                    <button className="btn-secondary" onClick={() => void refreshSelectedDir()} disabled={!activeSession || busy}>
                      刷新目录
                    </button>
                    <button className="btn-secondary" onClick={() => void openWorkspace()}>
                      打开工作区
                    </button>
                  </div>
                </div>

                <div className="selection-bar">
                  <span>选中路径: {activeSession.selectedPath}</span>
                  <span>{selectedNode ? (selectedNode.isDirectory ? '目录' : '文件') : '未选中'}</span>
                </div>

                <div className="tree-wrap panel-scroll">
                  {renderNodes(activeSession.tree, 0, activeSession)}
                </div>

                <div className="file-actions">
                  <button className="btn-secondary" onClick={() => void downloadSelected()} disabled={!activeSession || busy}>
                    下载到工作区
                  </button>
                  <button className="btn-secondary" onClick={() => void uploadToSelectedDir()} disabled={!activeSession || busy}>
                    上传到选中目录
                  </button>
                </div>
              </section>
            ) : (
              renderEmptyState('暂无活动会话', '先在“连接管理”建立 SSH 连接，再进入文件传输视图。')
            )}
          </div>

          <div className={`content-panel ${activeView === 'terminal' ? 'active' : 'hidden'}`}>
            {activeSession ? (
              <section className="content-card panel-fill terminal-panel-view">
                <div className="card-head">
                  <div>
                    <span className="card-kicker">Terminal</span>
                    <h3>SSH 终端</h3>
                  </div>
                  <div className="session-chip">{activeSession.title}</div>
                </div>
                <div className="terminal-wrap panel-fill" ref={terminalContainerRef} />
              </section>
            ) : (
              <>
                <section className="content-card terminal-mount hidden-terminal-host">
                  <div className="terminal-wrap panel-fill" ref={terminalContainerRef} />
                </section>
                {renderEmptyState('终端待连接', '建立 SSH 会话后，这里会展示独立终端，不再和文件区混在一起。')}
              </>
            )}
          </div>

          <div className={`content-panel ${activeView === 'browser' ? 'active' : 'hidden'}`}>
            {activeSession ? (
              <section className="content-card">
                <div className="card-head">
                  <div>
                    <span className="card-kicker">Tunnel</span>
                    <h3>远程浏览器</h3>
                  </div>
                  <div className="session-chip">{activeSession.title}</div>
                </div>
                <p className="card-intro">通过 SSH 隧道把远程 Web 服务映射到本地端口，再用新窗口打开。</p>
                <div className="browser-row">
                  <label>
                    协议
                    <select
                      value={browserProtocol}
                      onChange={(event) => setBrowserProtocol(event.target.value as 'http' | 'https')}
                    >
                      <option value="http">http</option>
                      <option value="https">https</option>
                    </select>
                  </label>
                  <label>
                    远程Host
                    <input value={browserRemoteHost} onChange={(event) => setBrowserRemoteHost(event.target.value)} />
                  </label>
                  <label>
                    远程Port
                    <input
                      type="number"
                      value={browserRemotePort}
                      onChange={(event) => setBrowserRemotePort(Number(event.target.value))}
                    />
                  </label>
                  <label>
                    路径
                    <input value={browserPathname} onChange={(event) => setBrowserPathname(event.target.value)} />
                  </label>
                  <button className="btn-primary" onClick={() => void openRemoteBrowserWindow()} disabled={!activeSession || busy}>
                    打开远程网页
                  </button>
                </div>
              </section>
            ) : (
              renderEmptyState('浏览器功能未激活', '只有建立 SSH 会话后，才能通过隧道打开远程站点。')
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
