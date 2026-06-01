import { useEffect, useMemo, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { AuthType, ConnectionProfile, RecentBrowserVisit, RecentConnection, RemoteEntry } from '../../shared/types';

interface TreeNode extends RemoteEntry {
  children?: TreeNode[];
  loaded?: boolean;
  expanded?: boolean;
}

interface TerminalWindow {
  id: string;
  shellId: string;
  title: string;
  buffer: string;
  closed: boolean;
}

interface SessionTab {
  sessionId: string;
  title: string;
  host: string;
  username: string;
  tree: TreeNode[];
  selectedPath: string;
  loadingPathSet: Set<string>;
  terminals: TerminalWindow[];
  activeTerminalId: string;
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

function createTerminalWindow(shellId: string, index: number): TerminalWindow {
  return {
    id: shellId,
    shellId,
    title: `终端 ${index}`,
    buffer: '',
    closed: false
  };
}

function getActiveTerminal(session: SessionTab | null): TerminalWindow | null {
  if (!session) {
    return null;
  }
  return session.terminals.find((terminal) => terminal.id === session.activeTerminalId) ?? session.terminals[0] ?? null;
}

function formatRecentTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatBrowserVisit(visit: RecentBrowserVisit): string {
  return `${visit.protocol}://${visit.remoteHost}:${visit.remotePort}${visit.pathname}`;
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
  const [recentBrowserVisits, setRecentBrowserVisits] = useState<RecentBrowserVisit[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  const [sessions, setSessions] = useState<SessionTab[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewMode>('connect');

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('等待连接');

  const [workspacePath, setWorkspacePath] = useState('');
  const [browserRemoteHost, setBrowserRemoteHost] = useState('127.0.0.1');
  const [browserRemotePort, setBrowserRemotePort] = useState('80');
  const [browserProtocol, setBrowserProtocol] = useState<'http' | 'https'>('http');
  const [browserPathname, setBrowserPathname] = useState('/');

  const statusTone = message.includes('失败') || message.includes('错误') ? 'error' : 'normal';
  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );
  const activeTerminal = useMemo(() => getActiveTerminal(activeSession), [activeSession]);
  const navigationItems: NavigationItem[] = [
    { key: 'connect', label: '连接管理', hint: '管理配置并快速连接' },
    { key: 'files', label: '文件传输', hint: '浏览并传输远程文件' },
    { key: 'terminal', label: 'SSH 终端', hint: '命令行交互' },
    { key: 'browser', label: '远程浏览器', hint: '访问远程站点' }
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

  async function reloadRecentBrowserVisits(): Promise<void> {
    const loaded = await window.sshApi.listRecentBrowserVisits();
    setRecentBrowserVisits(loaded);
  }

  useEffect(() => {
    void window.sshApi
      .getWorkspacePath()
      .then(setWorkspacePath)
      .catch(() => {
        setWorkspacePath('暂时无法读取本地工作区路径');
      });

    void reloadProfiles().catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });

    void reloadRecentConnections().catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });

    void reloadRecentBrowserVisits().catch((error) => {
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

  function renderActiveTerminal(): void {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    terminal.clear();
    const current = getActiveSessionFromRef();
    const currentTerminal = getActiveTerminal(current);
    if (!currentTerminal) {
      return;
    }

    if (currentTerminal.buffer) {
      terminal.write(currentTerminal.buffer);
    }

    fitAddon.fit();
    if (!currentTerminal.closed && currentTerminal.shellId) {
      window.sshApi.resizeShell(currentTerminal.shellId, terminal.cols, terminal.rows);
    }
  }

  useEffect(() => {
    if (!terminalContainerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
      fontSize: 12,
      letterSpacing: 0,
      lineHeight: 1.2,
      theme: {
        background: '#1f2024',
        foreground: '#e5e5ea',
        cursor: '#0a84ff',
        selectionBackground: '#2f5f8f',
        black: '#3a3a3c',
        red: '#ff6961',
        green: '#4cd964',
        yellow: '#ffd60a',
        blue: '#0a84ff',
        magenta: '#bf5af2',
        cyan: '#5ac8fa',
        white: '#d1d1d6',
        brightBlack: '#636366',
        brightRed: '#ff8a80',
        brightGreen: '#66d37e',
        brightYellow: '#ffe066',
        brightBlue: '#64b5ff',
        brightMagenta: '#d78cff',
        brightCyan: '#8adcf8',
        brightWhite: '#f5f5f7'
      }
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);
    const initialFitFrame = window.requestAnimationFrame(() => {
      fitAddon.fit();
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const dataDisposable = terminal.onData((data) => {
      const active = getActiveSessionFromRef();
      const currentTerminal = getActiveTerminal(active);
      if (!currentTerminal || currentTerminal.closed || !currentTerminal.shellId) {
        return;
      }
      window.sshApi.writeShell(currentTerminal.shellId, data);
    });

    const resizeHandler = (): void => {
      fitAddon.fit();
      const active = getActiveSessionFromRef();
      const currentTerminal = getActiveTerminal(active);
      if (currentTerminal && !currentTerminal.closed && currentTerminal.shellId) {
        window.sshApi.resizeShell(currentTerminal.shellId, terminal.cols, terminal.rows);
      }
    };

    window.addEventListener('resize', resizeHandler);

    return () => {
      window.cancelAnimationFrame(initialFitFrame);
      dataDisposable.dispose();
      window.removeEventListener('resize', resizeHandler);
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    const offData = window.sshApi.onShellData((payload) => {
      updateSession(payload.sessionId, (session) => ({
        ...session,
        terminals: session.terminals.map((terminalWindow) =>
          terminalWindow.shellId === payload.shellId
            ? {
                ...terminalWindow,
                buffer: appendTerminalBuffer(terminalWindow.buffer, payload.data)
              }
            : terminalWindow
        )
      }));

      const active = getActiveSessionFromRef();
      const currentTerminal = getActiveTerminal(active);
      if (active && active.sessionId === payload.sessionId && currentTerminal?.shellId === payload.shellId) {
        terminalRef.current?.write(payload.data);
      }
    });

    const offClosed = window.sshApi.onShellClosed((payload) => {
      const closeTip = `\r\n[shell closed: ${payload.code}]\r\n`;

      updateSession(payload.sessionId, (session) => ({
        ...session,
        terminals: session.terminals.map((terminalWindow) =>
          terminalWindow.shellId === payload.shellId
            ? {
                ...terminalWindow,
                shellId: '',
                closed: true,
                buffer: appendTerminalBuffer(terminalWindow.buffer, closeTip)
              }
            : terminalWindow
        )
      }));

      const active = getActiveSessionFromRef();
      const currentTerminal = getActiveTerminal(active);
      if (active && active.sessionId === payload.sessionId && currentTerminal?.shellId === payload.shellId) {
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
    renderActiveTerminal();
  }, [activeSessionId, activeTerminal?.id]);

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
      const currentTerminal = getActiveTerminal(active);
      if (currentTerminal && !currentTerminal.closed && currentTerminal.shellId) {
        window.sshApi.resizeShell(currentTerminal.shellId, terminal.cols, terminal.rows);
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeView, activeSessionId, activeTerminal?.id]);

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
      shellState: activeTerminal && !activeTerminal.closed ? `运行中 · ${activeSession.terminals.length} 个` : `已关闭 · ${activeSession.terminals.length} 个`
    };
  }, [activeSession, activeTerminal, selectedNode]);

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
      setMessage('私钥登录需要先选择私钥文件。');
      return;
    }

    setBusy(true);
    setMessage('正在连接服务器...');

    try {
      const result = await window.sshApi.connect(config);

      const newShellId = await window.sshApi.openShell(result.sessionId);
      const title = `${config.username}@${config.host}:${config.port}`;
      const initialTerminal = createTerminalWindow(newShellId, 1);

      setSessions((prev) => [
        ...prev,
        {
          sessionId: result.sessionId,
          title,
          host: config.host,
          username: config.username,
          tree: [createRootNode()],
          selectedPath: '/',
          loadingPathSet: new Set(),
          terminals: [initialTerminal],
          activeTerminalId: initialTerminal.id
        }
      ]);
      setActiveSessionId(result.sessionId);
      setActiveView('terminal');

      await loadChildren(result.sessionId, '/');
      await reloadRecentConnections();
      setMessage(`已连接到 ${title}`);

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
      if (target.terminals.length > 0) {
        await Promise.all(
          target.terminals
            .filter((terminalWindow) => terminalWindow.shellId)
            .map((terminalWindow) => window.sshApi.closeShell(terminalWindow.shellId))
        );
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

      setMessage(`已断开 ${target.title}`);
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

  async function openNewTerminalTab(): Promise<void> {
    if (!activeSession || busy) {
      return;
    }

    setBusy(true);
    try {
      const shellId = await window.sshApi.openShell(activeSession.sessionId);
      const nextTerminal = createTerminalWindow(shellId, activeSession.terminals.length + 1);
      updateSession(activeSession.sessionId, (session) => ({
        ...session,
        terminals: [...session.terminals, nextTerminal],
        activeTerminalId: nextTerminal.id
      }));
      setMessage(`已创建 ${nextTerminal.title}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function selectTerminalTab(terminalId: string): void {
    if (!activeSession) {
      return;
    }

    updateSession(activeSession.sessionId, (session) => ({
      ...session,
      activeTerminalId: terminalId
    }));
  }

  async function closeTerminalTab(terminalId: string): Promise<void> {
    if (!activeSession) {
      return;
    }

    const targetTerminal = activeSession.terminals.find((terminalWindow) => terminalWindow.id === terminalId);
    if (!targetTerminal) {
      return;
    }

    if (targetTerminal.shellId) {
      await window.sshApi.closeShell(targetTerminal.shellId);
    }

    const remainingTerminals = activeSession.terminals.filter((terminalWindow) => terminalWindow.id !== terminalId);
    updateSession(activeSession.sessionId, (session) => {
      const nextTerminals = session.terminals.filter((terminalWindow) => terminalWindow.id !== terminalId);
      return {
        ...session,
        terminals: nextTerminals,
        activeTerminalId:
          session.activeTerminalId === terminalId
            ? nextTerminals[0]?.id ?? ''
            : session.activeTerminalId
      };
    });

    if (remainingTerminals.length === 0) {
      terminalRef.current?.clear();
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
      setMessage(`已刷新目录 ${targetPath}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function downloadSelected(): Promise<void> {
    if (!activeSession) {
      return;
    }

    const selectedNode = activeNodeMap.get(activeSession.selectedPath);
    if (!selectedNode) {
      setMessage('请先选择要下载的文件或文件夹。');
      return;
    }

    if (selectedNode.isDirectory && selectedNode.path === '/') {
      setMessage('暂不支持直接下载远程根目录，请选择具体文件夹。');
      return;
    }

    setBusy(true);
    try {
      if (selectedNode.isDirectory) {
        setMessage(`正在下载文件夹 ${selectedNode.path} 到本地工作区...`);
        const result = await window.sshApi.downloadDirectoryToWorkspace(activeSession.sessionId, selectedNode.path);
        setMessage(`已下载文件夹到 ${result.localPath}`);
        return;
      }

      setMessage(`正在下载文件 ${selectedNode.path} 到本地工作区...`);
      const result = await window.sshApi.downloadFileToWorkspace(activeSession.sessionId, selectedNode.path);
      setMessage(`已下载文件到 ${result.localPath}`);
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
      setMessage(`已上传到 ${result.remotePath}`);
      await loadChildren(activeSession.sessionId, remoteDir);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFolderToSelectedDir(): Promise<void> {
    if (!activeSession) {
      return;
    }

    const selectedNode = activeNodeMap.get(activeSession.selectedPath);
    const remoteDir = selectedNode?.isDirectory
      ? selectedNode.path
      : getParentPath(activeSession.selectedPath);

    try {
      const localDirectory = await window.sshApi.pickLocalDirectory();
      if (!localDirectory) {
        return;
      }

      setBusy(true);
      const result = await window.sshApi.uploadDirectory(activeSession.sessionId, localDirectory, remoteDir);
      setMessage(`已上传文件夹到 ${result.remotePath}`);
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
      setMessage('请先连接服务器。');
      return;
    }

    const trimmedBrowserPort = browserRemotePort.trim();
    if (!/^\d+$/.test(trimmedBrowserPort)) {
      setMessage('远程端口必须是 1 到 65535 之间的整数。');
      return;
    }

    const parsedBrowserPort = Number(trimmedBrowserPort);
    if (parsedBrowserPort < 1 || parsedBrowserPort > 65535) {
      setMessage('远程端口必须是 1 到 65535 之间的整数。');
      return;
    }

    setBusy(true);
    try {
      const result = await window.sshApi.openRemoteBrowser({
        sessionId: activeSession.sessionId,
        remoteHost: browserRemoteHost,
        remotePort: parsedBrowserPort,
        protocol: browserProtocol,
        pathname: browserPathname
      });

      await reloadRecentBrowserVisits();
      setMessage(`已打开远程页面 ${result.url}`);
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
      setMessage(`已保存连接配置 ${saved.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile(): Promise<void> {
    if (!selectedProfileId) {
      setMessage('请先选择要删除的连接配置。');
      return;
    }

    setBusy(true);
    try {
      await window.sshApi.deleteConnectionProfile(selectedProfileId);
      await reloadProfiles();
      setSelectedProfileId('');
      setProfileName('');
      setMessage('已删除连接配置。');
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

  function applyRecentBrowserVisit(visit: RecentBrowserVisit): void {
    setBrowserProtocol(visit.protocol);
    setBrowserRemoteHost(visit.remoteHost);
    setBrowserRemotePort(String(visit.remotePort));
    setBrowserPathname(visit.pathname);
  }

  async function deleteRecentBrowserVisit(visit: RecentBrowserVisit): Promise<void> {
    const confirmed = window.confirm(`确定删除访问记录 ${formatBrowserVisit(visit)} 吗？`);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      await window.sshApi.deleteRecentBrowserVisit(visit.id);
      await reloadRecentBrowserVisits();
      setMessage('已删除浏览器访问记录。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
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
          <div className="brand-mark">ZT</div>
          <div>
            <h1>ZakiTerm</h1>
            <p>更轻松地连接服务器、管理文件并访问远程服务。</p>
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
                aria-label={item.label}
                title={item.label}
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
            {sessions.length === 0 ? <div className="sidebar-empty">还没有会话，先在“连接管理”中创建连接。</div> : null}
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
            <p>连接后可在这里查看主机信息、终端状态和文件概览。</p>
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
            <span className="eyebrow">当前视图</span>
            <h2>{navigationItems.find((item) => item.key === activeView)?.label}</h2>
          </div>
          <div className="workspace-summary">
            <span>{activeSession ? activeSession.title : '尚未连接服务器'}</span>
            <span>{activeSession ? `当前位置 ${activeSession.selectedPath}` : '连接后即可开始使用各项功能'}</span>
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
                    <h3>连接服务器</h3>
                  </div>
                </div>

                <div className="connect-row">
                  <label>
                    主机地址
                    <input value={host} onChange={(event) => setHost(event.target.value)} disabled={busy} />
                  </label>
                  <label>
                    端口
                    <input
                      type="number"
                      value={port}
                      onChange={(event) => setPort(Number(event.target.value))}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    用户名
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
                      登录密码
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
                    立即连接
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
                    <h3>文件浏览</h3>
                  </div>
                  <div className="card-actions">
                    <button className="btn-secondary" onClick={() => void refreshSelectedDir()} disabled={!activeSession || busy}>
                      刷新
                    </button>
                    <button className="btn-secondary" onClick={() => void openWorkspace()}>
                      打开本地工作区
                    </button>
                  </div>
                </div>

                <div className="selection-bar">
                  <span>当前选中: {activeSession.selectedPath}</span>
                  <span>{selectedNode ? (selectedNode.isDirectory ? '文件夹' : '文件') : '未选择'}</span>
                </div>

                <div className="tree-wrap panel-scroll">
                  {renderNodes(activeSession.tree, 0, activeSession)}
                </div>

                <div className="file-actions">
                  <button className="btn-secondary" onClick={() => void downloadSelected()} disabled={!activeSession || busy}>
                    下载到本地工作区
                  </button>
                  <button className="btn-secondary" onClick={() => void uploadToSelectedDir()} disabled={!activeSession || busy}>
                    上传文件到当前目录
                  </button>
                  <button className="btn-secondary" onClick={() => void uploadFolderToSelectedDir()} disabled={!activeSession || busy}>
                    上传文件夹到当前目录
                  </button>
                </div>
              </section>
            ) : (
              renderEmptyState('还没有连接', '先连接服务器，再浏览和传输远程文件。')
            )}
          </div>

          <div className={`content-panel ${activeView === 'terminal' ? 'active' : 'hidden'}`}>
            <section className={`content-card panel-fill terminal-panel-view ${activeSession ? '' : 'terminal-panel-empty'}`}>
              {activeSession ? (
                <>
                  <div className="card-head">
                    <div>
                      <span className="card-kicker">Terminal</span>
                      <h3>SSH 终端</h3>
                    </div>
                    <div className="terminal-head-actions">
                      <div className="session-chip">{activeSession.title}</div>
                      <button className="btn-secondary" onClick={() => void openNewTerminalTab()} disabled={busy}>
                        新建终端
                      </button>
                    </div>
                  </div>
                  <div className="terminal-tab-strip">
                    {activeSession.terminals.length === 0 ? (
                      <span className="terminal-tab-empty">暂无终端，点击“新建终端”开始。</span>
                    ) : null}
                    {activeSession.terminals.map((terminalWindow) => (
                      <button
                        key={terminalWindow.id}
                        className={`terminal-tab ${activeSession.activeTerminalId === terminalWindow.id ? 'active' : ''} ${
                          terminalWindow.closed ? 'closed' : ''
                        }`}
                        onClick={() => selectTerminalTab(terminalWindow.id)}
                      >
                        <span>{terminalWindow.title}</span>
                        <small>{terminalWindow.closed ? '已关闭' : '运行中'}</small>
                        <span
                          className="terminal-tab-close"
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            void closeTerminalTab(terminalWindow.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              void closeTerminalTab(terminalWindow.id);
                            }
                          }}
                        >
                          x
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <div className={`terminal-wrap panel-fill ${activeSession ? '' : 'hidden-terminal-surface'}`} ref={terminalContainerRef} />
              {activeSession ? null : renderEmptyState('终端尚未就绪', '连接服务器后，即可在这里开始命令行操作。')}
            </section>
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
                <p className="card-intro">将远程 Web 服务映射到本地窗口，方便直接访问和调试。</p>
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
                    远程主机
                    <input value={browserRemoteHost} onChange={(event) => setBrowserRemoteHost(event.target.value)} />
                  </label>
                  <label>
                    远程端口
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={browserRemotePort}
                      onChange={(event) => setBrowserRemotePort(event.target.value)}
                    />
                  </label>
                  <label>
                    路径
                    <input value={browserPathname} onChange={(event) => setBrowserPathname(event.target.value)} />
                  </label>
                  <button className="btn-primary" onClick={() => void openRemoteBrowserWindow()} disabled={!activeSession || busy}>
                    立即打开
                  </button>
                </div>

                <div className="recent-section browser-recent-section">
                  <div className="recent-head">
                    <div>
                      <span className="card-kicker">History</span>
                      <h4>最近访问</h4>
                    </div>
                    <span>{recentBrowserVisits.length} 条</span>
                  </div>

                  {recentBrowserVisits.length === 0 ? (
                    <p className="recent-empty">还没有远程浏览器访问记录，成功打开页面后会自动出现在这里。</p>
                  ) : (
                    <div className="recent-list">
                      {recentBrowserVisits.map((visit) => (
                        <div key={visit.id} className="recent-item browser-recent-item">
                          <button
                            className="recent-item-main"
                            onClick={() => applyRecentBrowserVisit(visit)}
                            disabled={busy}
                          >
                            <strong>{formatBrowserVisit(visit)}</strong>
                            <span>最近访问于 {formatRecentTime(visit.lastOpenedAt)}</span>
                          </button>
                          <button
                            className="btn-danger recent-item-action"
                            onClick={() => void deleteRecentBrowserVisit(visit)}
                            disabled={busy}
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ) : (
              renderEmptyState('远程访问暂不可用', '连接服务器后，即可通过 SSH 隧道访问远程站点。')
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
