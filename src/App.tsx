import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import dayjs from 'dayjs';
import QRCode from 'qrcode';
import {
  Clipboard,
  ChevronRight,
  ChevronLeft,
  Copy,
  Database,
  History,
  Home,
  Image as ImageIcon,
  Laptop,
  Link2,
  MonitorSmartphone,
  Power,
  QrCode,
  RefreshCw,
  Search,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { createEmptyState, isImageEntry, type AppState, type HistoryEntry } from './lib/models';
import { platformBridge } from './platform/bridge';

const desktopTabs = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'pair', label: '连接', icon: QrCode },
  { id: 'history', label: '历史', icon: History },
  { id: 'devices', label: '设备', icon: MonitorSmartphone },
  { id: 'settings', label: '设置', icon: SettingsIcon },
] as const;

const mobileTabs = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'pair', label: '连接', icon: QrCode },
  { id: 'history', label: '历史', icon: History },
  { id: 'devices', label: '设备', icon: MonitorSmartphone },
  { id: 'settings', label: '设置', icon: SettingsIcon },
] as const;

type MobileTabId = (typeof mobileTabs)[number]['id'];
type DesktopTabId = (typeof desktopTabs)[number]['id'];

const statusTone: Record<AppState['serviceStatus'], { label: string; className: string; icon: typeof Wifi }> = {
  online: { label: '在线', className: 'status-chip success', icon: Wifi },
  offline: { label: '离线', className: 'status-chip danger', icon: WifiOff },
  syncing: { label: '同步中', className: 'status-chip info', icon: RefreshCw },
};

const summaryCopy = {
  desktop: '当前设备作为局域网主机，手机扫一扫即可完成配对。',
  mobile: '当前设备保持前后台连接，扫码后会自动加入局域网同步。',
};

function normalizeActionError(actionError: unknown) {
  const message = actionError instanceof Error ? actionError.message : '操作失败';
  if (message.includes('已取消扫码') || message.includes('扫码已取消') || message.toLowerCase().includes('cancel')) {
    return '扫码已取消';
  }
  if (message.includes('Google Barcode Scanner Module')) {
    return '扫码组件还没准备好，已尝试自动安装。请确认手机已安装并启用 Google Play 服务，然后再点一次扫码。';
  }
  if (message.includes('Permission denied') || message.includes('camera')) {
    return '相机权限没有打开，请在系统权限里允许 ClipVault 使用相机。';
  }
  if (
    message.includes('JSONException') ||
    message.includes('JSONObject') ||
    message.includes('JSON') ||
    message.includes('Value ') ||
    message.includes('Expected')
  ) {
    return '请扫描本软件生成的二维码，或输入 6 位配对码。';
  }
  return message;
}

function getAdvancedSyncTone(status: string) {
  if (status.includes('已连接')) {
    return 'success';
  }
  if (status.includes('失败') || status.includes('重新配对')) {
    return 'danger';
  }
  if (status.includes('正在') || status.includes('等待') || status.includes('已配对')) {
    return 'info';
  }
  return 'idle';
}

function App() {
  const [state, setState] = useState<AppState>(createEmptyState());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [pairingInput, setPairingInput] = useState('');
  const [notice, setNotice] = useState('');
  const [activeDesktopTab, setActiveDesktopTab] = useState<DesktopTabId>('home');
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTabId>('home');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let mounted = true;
    const boot = async () => {
      try {
        const next = await platformBridge.start();
        if (mounted) {
          setState(next);
          setLoading(false);
        }
      } catch (bootError) {
        if (mounted) {
          setError(bootError instanceof Error ? bootError.message : '启动失败');
          setLoading(false);
        }
      }
    };
    void boot();
    const unsubscribe = platformBridge.subscribe((next) => {
      if (mounted) {
        setState(next);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const renderQr = async () => {
      if (!state.pairingPayload) {
        setQrDataUrl('');
        return;
      }
      const value = JSON.stringify(state.pairingPayload);
      const dataUrl = await QRCode.toDataURL(value, {
        color: {
          dark: '#1F2937',
          light: '#FFFFFF',
        },
        margin: 1,
        width: 280,
      });
      setQrDataUrl(dataUrl);
    };
    void renderQr();
  }, [state.pairingPayload]);

  const filteredHistory = useMemo(() => {
    const keyword = historySearch.trim().toLowerCase();
    if (!keyword) {
      return state.history;
    }
    return state.history.filter((entry) => {
      const haystack = `${entry.preview} ${entry.sourceDeviceName}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [historySearch, state.history]);

  const currentStatus = statusTone[state.serviceStatus];
  const StatusIcon = currentStatus.icon;

  const runAction = async (runner: () => Promise<AppState | void>) => {
    setError('');
    setNotice('');
    try {
      const next = await runner();
      if (next) {
        const previousOnline = state.peers.filter((peer) => peer.status === 'online').length;
        const nextOnline = next.peers.filter((peer) => peer.status === 'online').length;
        setState(next);
        if (
          nextOnline > previousOnline ||
          next.statusMessage.includes('连接已建立') ||
          next.statusMessage.includes('设备已连接')
        ) {
          setNotice('连接成功，剪贴板同步已开启。');
        }
      }
      return next;
    } catch (actionError) {
      setError(normalizeActionError(actionError));
      return undefined;
    }
  };

  const connectFromInput = async () => {
    const normalizedInput = pairingInput.trim();
    if (!normalizedInput) {
      setError('请输入六位配对码，或粘贴二维码中的完整内容。');
      return;
    }
    if (/^\d+$/.test(normalizedInput) && normalizedInput.length !== 6) {
      setError('配对码必须是 6 位数字。');
      return;
    }
    setConnecting(true);
    try {
      const next = await runAction(() => platformBridge.connectWithPayload(normalizedInput));
      if (next) {
        setPairingInput('');
        setNotice('连接成功，剪贴板同步已开启。');
      }
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = window.setTimeout(() => setError(''), 2200);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(''), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <>
      <MobileErrorBoundary
        resetKey={activeMobileTab}
        onReset={() => {
          setError('');
          setActiveMobileTab('home');
        }}
      >
        <MobileApp
          state={state}
          loading={loading}
          error={error}
          notice={notice}
          historySearch={historySearch}
          setHistorySearch={setHistorySearch}
          pairingInput={pairingInput}
          setPairingInput={setPairingInput}
          connecting={connecting}
          filteredHistory={filteredHistory}
          qrDataUrl={qrDataUrl}
          currentStatus={currentStatus}
          StatusIcon={StatusIcon}
          activeTab={activeMobileTab}
          setActiveTab={setActiveMobileTab}
          runAction={runAction}
          connectFromInput={connectFromInput}
        />
      </MobileErrorBoundary>
      <div className="app-shell desktop-app-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">CV</div>
            <div>
              <h1>ClipVault</h1>
              <p>{desktopTabs.find((tab) => tab.id === activeDesktopTab)?.label}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <div className={currentStatus.className}>
              <StatusIcon size={16} />
              <span>{currentStatus.label}</span>
            </div>
            <button className="icon-button" onClick={() => runAction(() => platformBridge.getState())} title="刷新状态">
              <RefreshCw size={16} />
            </button>
          </div>
        </header>

        <main className={`desktop-content desktop-content-${activeDesktopTab}`}>
          {activeDesktopTab === 'home' ? (
            <section className="section desktop-page">
              <div className="section-header">
                <div>
                  <h2>首页</h2>
                  <p>{summaryCopy[state.device.role]}</p>
                </div>
                <div className="device-chip">
                  {state.device.role === 'desktop' ? <Laptop size={16} /> : <Smartphone size={16} />}
                  <span>{state.device.name}</span>
                </div>
              </div>

              <div className="overview-grid desktop-overview-compact">
                <article className="panel">
                  <div className="panel-title">
                    <Clipboard size={18} />
                    <span>服务状态</span>
                  </div>
                  <h3>{state.statusMessage}</h3>
                  <p>本机地址：{state.localAddress || '等待网络'}</p>
                  <div className="metric-row">
                    <div>
                      <strong>{state.peers.length}</strong>
                      <span>已连接设备</span>
                    </div>
                    <div>
                      <strong>{state.history.length}</strong>
                      <span>本地历史记录</span>
                    </div>
                  </div>
                </article>
              </div>
            </section>
          ) : null}

          {activeDesktopTab === 'pair' ? (
            <section className="section desktop-page">
              <div className="section-header">
                <div>
                  <h2>连接</h2>
                  <p>二维码给手机扫码，6 位配对码用于电脑和电脑之间直接连接。</p>
                </div>
              </div>

              <div className="pairing-layout">
                <article className="panel pairing-panel">
                  <div className="panel-title">
                    <QrCode size={18} />
                    <span>我的配对二维码</span>
                  </div>
                  <div className="qr-box">
                    {qrDataUrl ? <img src={qrDataUrl} alt="ClipVault pairing QR" /> : <div className="qr-placeholder">二维码准备中</div>}
                  </div>
                  <div className="pairing-code-box">
                    <span>六位配对码</span>
                    <strong>{state.pairingPayload?.pairingCode ?? '------'}</strong>
                  </div>
                  <div className="button-row">
                    <button className="primary-button" onClick={() => runAction(() => platformBridge.refreshPairing())}>
                      <RefreshCw size={16} />
                      <span>刷新配对信息</span>
                    </button>
                  </div>
                </article>

                <article className="panel pairing-panel">
                  <div className="panel-title">
                    <Link2 size={18} />
                    <span>配对码连接</span>
                  </div>
                  <div className="scan-copy">
                    <p>输入另一台电脑或手机显示的 6 位配对码，直接建立局域网连接。</p>
                  </div>
                  <div className="desktop-code-connect">
                    <input
                      value={pairingInput}
                      onChange={(event) => setPairingInput(event.target.value)}
                      placeholder="输入 6 位配对码"
                      inputMode="numeric"
                      maxLength={6}
                    />
                  <button className="secondary-button" onClick={() => void connectFromInput()}>
                    {connecting ? '正在连接…' : '用配对码连接'}
                  </button>
                </div>
              </article>
            </div>
          </section>
          ) : null}

          {activeDesktopTab === 'history' ? (
            <section className="section desktop-page">
              <div className="section-header">
                <div>
                  <h2>历史记录</h2>
                  <p>按时间排序，支持搜索、复制、删除和清空。</p>
                </div>
                <div className="search-box">
                  <Search size={16} />
                  <input
                    value={historySearch}
                    onChange={(event) => setHistorySearch(event.target.value)}
                    placeholder="搜索内容或设备名"
                  />
                </div>
              </div>

              <article className="panel history-panel">
                <div className="button-row justify-end">
                  <button className="secondary-button danger-text" onClick={() => runAction(() => platformBridge.clearHistory())}>
                    <Trash2 size={16} />
                    <span>清空记录</span>
                  </button>
                </div>
                <div className="history-list">
                  {loading ? <p className="empty-state">正在加载设备状态…</p> : null}
                  {!loading && filteredHistory.length === 0 ? <p className="empty-state">还没有剪贴记录。</p> : null}
                  {filteredHistory.map((entry) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      onCopy={() => runAction(() => platformBridge.copyHistory(entry.id))}
                      onDelete={() => runAction(() => platformBridge.deleteHistory(entry.id))}
                    />
                  ))}
                </div>
              </article>
            </section>
          ) : null}

          {activeDesktopTab === 'devices' ? (
            <section className="section desktop-page">
              <div className="section-header">
                <div>
                  <h2>设备管理</h2>
                  <p>查看已配对设备，按需断开指定连接或全部连接。</p>
                </div>
                <button className="secondary-button" onClick={() => runAction(() => platformBridge.disconnectAll())}>
                  <Power size={16} />
                  <span>全部断开</span>
                </button>
              </div>

              <div className="device-list">
                {state.peers.length === 0 ? <p className="empty-state">当前没有在线配对设备。</p> : null}
                {state.peers.map((peer) => (
                  <article key={peer.id} className="device-row">
                    <div className="device-row-main">
                      <div className="device-row-icon">
                        {peer.platform === 'android' || peer.platform === 'ios' ? <Smartphone size={18} /> : <Laptop size={18} />}
                      </div>
                      <div>
                        <h3>{peer.name}</h3>
                        <p>
                          {peer.host} · {dayjs(peer.lastSeen).format('YYYY-MM-DD HH:mm:ss')}
                        </p>
                      </div>
                    </div>
                    <div className="device-row-actions">
                      <span className={statusTone[peer.status].className}>{statusTone[peer.status].label}</span>
                      <button className="icon-button" onClick={() => runAction(() => platformBridge.disconnectPeer(peer.id))} title="断开设备">
                        <Power size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {activeDesktopTab === 'settings' ? (
            <section className="section desktop-page">
              <div className="section-header">
                <div>
                  <h2>基础设置</h2>
                  <p>全部设置会持久化到本地，重启后自动恢复。</p>
                </div>
              </div>

              <article className="panel settings-panel">
                <SettingToggle
                  title="开启同步"
                  description="关闭后仍保留连接和历史记录，但不再推送新的剪贴板内容。"
                  checked={state.settings.syncEnabled}
                  onChange={(checked) => runAction(() => platformBridge.updateSettings({ syncEnabled: checked }))}
                />
                <SettingToggle
                  title="开机自启"
                  description="Windows / Linux 会注册登录启动项，移动端保留后台服务设置。"
                  checked={state.settings.launchAtStartup}
                  onChange={(checked) => runAction(() => platformBridge.updateSettings({ launchAtStartup: checked }))}
                />
                <SettingToggle
                  title="最小化到托盘"
                  description="仅桌面端生效，关闭窗口后保持在系统托盘常驻。"
                  checked={state.settings.minimizeToTray}
                  onChange={(checked) => runAction(() => platformBridge.updateSettings({ minimizeToTray: checked }))}
                />

                <div className="setting-row number-row">
                  <div>
                    <h3>历史记录上限</h3>
                    <p>超过上限后会自动删除最旧的记录。</p>
                  </div>
                  <input
                    className="number-input"
                    type="number"
                    min={20}
                    max={1000}
                    value={state.settings.historyLimit}
                    onChange={(event) =>
                      runAction(() =>
                        platformBridge.updateSettings({
                          historyLimit: Number(event.target.value || 200),
                        }),
                      )
                    }
                  />
                </div>
              </article>
            </section>
          ) : null}

          {error ? <div className="error-banner">{error}</div> : null}
          {notice ? <div className="success-banner">{notice}</div> : null}
        </main>

        <nav className="desktop-bottom-nav">
          {desktopTabs.map((tab) => {
            const selected = tab.id === activeDesktopTab;
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                className={selected ? 'desktop-nav-item active' : 'desktop-nav-item'}
                onClick={() => setActiveDesktopTab(tab.id)}
              >
                <TabIcon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}

class MobileErrorBoundary extends Component<
  { children: ReactNode; resetKey: string; onReset: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(previousProps: { resetKey: string }) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  private reset = () => {
    this.setState({ hasError: false });
    this.props.onReset();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="mobile-shell">
        <main className="mobile-content">
          <section className="mobile-page">
            <div className="mobile-fallback">
              <div className="mobile-mark">CV</div>
              <h1>页面没有加载成功</h1>
              <p>当前界面状态已重置，可以返回首页继续使用。</p>
              <button className="mobile-primary-button full" onClick={this.reset}>
                返回首页
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }
}

function MobileApp({
  state,
  loading,
  error,
  notice,
  historySearch,
  setHistorySearch,
  pairingInput,
  setPairingInput,
  connecting,
  filteredHistory,
  qrDataUrl,
  currentStatus,
  StatusIcon,
  activeTab,
  setActiveTab,
  runAction,
  connectFromInput,
}: {
  state: AppState;
  loading: boolean;
  error: string;
  notice: string;
  historySearch: string;
  setHistorySearch: (value: string) => void;
  pairingInput: string;
  setPairingInput: (value: string) => void;
  connecting: boolean;
  filteredHistory: HistoryEntry[];
  qrDataUrl: string;
  currentStatus: { label: string; className: string; icon: typeof Wifi };
  StatusIcon: typeof Wifi;
  activeTab: MobileTabId;
  setActiveTab: (value: MobileTabId) => void;
  runAction: (runner: () => Promise<AppState | void>) => Promise<AppState | void>;
  connectFromInput: () => Promise<void>;
}) {
  const connectedCount = state.peers.filter((peer) => peer.status === 'online').length;
  const latestEntry = state.history[0];
  const [pairView, setPairView] = useState<'hub' | 'mine'>('hub');
  const advancedSyncTone = getAdvancedSyncTone(state.advancedAdbStatus);

  useEffect(() => {
    const page = document.querySelector('.mobile-content');
    page?.scrollTo({ top: 0 });
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'pair') {
      setPairView('hub');
    }
  }, [activeTab]);

  const openPairScreen = async () => {
    await runAction(() => platformBridge.refreshPairing());
    setPairView('mine');
  };

  return (
    <div className={pairView === 'mine' && activeTab === 'pair' ? 'mobile-shell mobile-shell-subpage' : 'mobile-shell'}>
      <header className="mobile-topbar">
        <div className="mobile-brand">
          <div className="mobile-mark">CV</div>
          <div>
            <span>ClipVault</span>
            <strong>{mobileTabs.find((tab) => tab.id === activeTab)?.label}</strong>
          </div>
        </div>
        <button className="mobile-icon-button" onClick={() => runAction(() => platformBridge.getState())} aria-label="刷新状态">
          <RefreshCw size={18} />
        </button>
      </header>

      <main className="mobile-content">
        {activeTab === 'home' ? (
          <section className="mobile-page mobile-home-page">
            <div className="mobile-hero-card">
              <div className="mobile-hero-top">
                <div>
                  <p>局域网同步</p>
                  <h1>{state.statusMessage}</h1>
                </div>
                <div className={currentStatus.className}>
                  <StatusIcon size={15} />
                  <span>{currentStatus.label}</span>
                </div>
              </div>
              <div className="mobile-hero-device">
                <Smartphone size={18} />
                <span>{state.device.name}</span>
              </div>
              <div className="mobile-hero-meta">
                <span>本机 IP：</span>
                <strong>{state.localAddress || '等待网络'}</strong>
              </div>
              <div className="mobile-stat-grid">
                <div>
                  <strong>{connectedCount}</strong>
                  <span>在线设备</span>
                </div>
                <div>
                  <strong>{state.history.length}</strong>
                  <span>剪贴记录</span>
                </div>
                <div>
                  <strong>{state.settings.syncEnabled ? '开' : '关'}</strong>
                  <span>同步开关</span>
                </div>
              </div>
            </div>

            <div className="mobile-action-grid">
              <button className="mobile-action-card primary" onClick={() => setActiveTab('pair')}>
                <QrCode size={22} />
                <span>扫码连接</span>
              </button>
              <button className="mobile-action-card" onClick={() => runAction(() => platformBridge.openPermissionGuide())}>
                <ShieldCheck size={22} />
                <span>权限保活</span>
              </button>
            </div>

            <section className="mobile-card mobile-latest-card">
              <div className="mobile-section-title">
                <Database size={18} />
                <h2>最近同步</h2>
              </div>
              {latestEntry ? (
                <HistoryRow
                  entry={latestEntry}
                  onCopy={() => runAction(() => platformBridge.copyHistory(latestEntry.id))}
                  onDelete={() => runAction(() => platformBridge.deleteHistory(latestEntry.id))}
                />
              ) : (
                <p className="mobile-empty">还没有同步内容。</p>
              )}
            </section>

          </section>
        ) : null}

        {activeTab === 'pair' ? (
          pairView === 'mine' ? (
            <section className="mobile-page mobile-scroll-page">
              <div className="mobile-subpage-head">
                <button className="mobile-back-button" onClick={() => setPairView('hub')} aria-label="返回连接页">
                  <ChevronLeft size={18} />
                </button>
                <div>
                  <h1>我的二维码</h1>
                  <p>给其他设备扫一扫，或输入配对码连接</p>
                </div>
                <button className="mobile-icon-button" onClick={() => runAction(() => platformBridge.refreshPairing())} aria-label="刷新配对信息">
                  <RefreshCw size={18} />
                </button>
              </div>
              <section className="mobile-card mobile-pair-qr-screen">
                <div className="mobile-qr-stage">
                  {qrDataUrl ? <img src={qrDataUrl} alt="ClipVault pairing QR" /> : <div className="qr-placeholder">二维码准备中</div>}
                </div>
                <div className="mobile-code-card">
                  <span>六位配对码</span>
                  <strong>{state.pairingPayload?.pairingCode ?? '------'}</strong>
                </div>
              </section>
              <button className="mobile-primary-button full" onClick={() => setPairView('hub')}>
                返回连接页
              </button>
            </section>
          ) : (
            <section className="mobile-page mobile-pair-page">
              <div className="mobile-screen-heading">
                <h1>连接</h1>
                <p>扫码或输入配对码</p>
              </div>
              <section className="mobile-card mobile-pair-card">
                <button className="mobile-scan-button" onClick={() => runAction(() => platformBridge.scanAndConnect())}>
                  <QrCode size={30} />
                  <strong>扫码连接</strong>
                  <span>扫描 ClipVault 配对二维码</span>
                </button>
                <div className="mobile-code-connect-card">
                  <div className="mobile-field-head">
                    <span>配对码</span>
                    <strong>6 位数字</strong>
                  </div>
                  <input
                    className="mobile-pair-input"
                    placeholder="输入 6 位配对码或粘贴配对内容"
                    value={pairingInput}
                    onChange={(event) => setPairingInput(event.target.value)}
                    inputMode="text"
                  />
                  <button className="mobile-secondary-button full" onClick={() => void connectFromInput()}>
                    {connecting ? '正在连接…' : '连接设备'}
                  </button>
                </div>
              </section>
              <section className="mobile-card mobile-pair-actions">
                {state.capabilities.canGenerateQr ? (
                  <>
                    <button className="mobile-list-button primary" onClick={() => void openPairScreen()}>
                      <div>
                        <strong>生成我的二维码</strong>
                        <span>让手机、电脑或平板连接到这台设备</span>
                      </div>
                      <QrCode size={20} />
                    </button>
                  </>
                ) : null}
                <button className="mobile-list-button" onClick={() => runAction(() => platformBridge.refreshPairing())}>
                  <div>
                    <strong>刷新配对信息</strong>
                    <span>更新当前二维码与配对码</span>
                  </div>
                  <RefreshCw size={20} />
                </button>
              </section>
            </section>
          )
        ) : null}

        {activeTab === 'history' ? (
          <section className="mobile-page mobile-scroll-page">
            <div className="mobile-screen-heading">
              <h1>剪贴历史</h1>
              <p>文本和图片都会保存在本机。</p>
            </div>
            <div className="mobile-search">
              <Search size={16} />
              <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="搜索记录" />
            </div>
            <div className="mobile-list">
              {loading ? <p className="mobile-empty">正在加载…</p> : null}
              {!loading && filteredHistory.length === 0 ? <p className="mobile-empty">还没有剪贴记录。</p> : null}
              {filteredHistory.map((entry) => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  onCopy={() => runAction(() => platformBridge.copyHistory(entry.id))}
                  onDelete={() => runAction(() => platformBridge.deleteHistory(entry.id))}
                />
              ))}
            </div>
          </section>
        ) : null}

        {activeTab === 'devices' ? (
          <section className="mobile-page mobile-scroll-page">
            <div className="mobile-screen-heading">
              <h1>设备</h1>
              <p>查看和管理局域网配对设备。</p>
            </div>
            <div className="mobile-list">
              {state.peers.length === 0 ? <p className="mobile-empty">当前没有在线设备。</p> : null}
              {state.peers.map((peer) => (
                <article key={peer.id} className="mobile-device-card">
                  <div className="device-row-main">
                    <div className="device-row-icon">
                      {peer.platform === 'android' || peer.platform === 'ios' ? <Smartphone size={18} /> : <Server size={18} />}
                    </div>
                    <div>
                      <h3>{peer.name}</h3>
                      <p>{peer.host}</p>
                    </div>
                  </div>
                  <button className="mobile-icon-button" onClick={() => runAction(() => platformBridge.disconnectPeer(peer.id))} aria-label="断开">
                    <Power size={16} />
                  </button>
                </article>
              ))}
            </div>
            <button className="mobile-secondary-button full" onClick={() => runAction(() => platformBridge.disconnectAll())}>
              断开全部设备
            </button>
          </section>
        ) : null}

        {activeTab === 'settings' ? (
          <section className="mobile-page mobile-scroll-page">
            <div className="mobile-screen-heading">
              <h1>设置</h1>
              <p>同步策略、历史数量和权限引导。</p>
            </div>
            <section className="mobile-card mobile-settings-list">
              <SettingToggle
                title="开启同步"
                description="关闭后只保留本地历史。"
                checked={state.settings.syncEnabled}
                onChange={(checked) => runAction(() => platformBridge.updateSettings({ syncEnabled: checked }))}
              />
              <SettingToggle
                title="开机自启"
                description="安卓端会配合前台服务和启动广播。"
                checked={state.settings.launchAtStartup}
                onChange={(checked) => runAction(() => platformBridge.updateSettings({ launchAtStartup: checked }))}
              />
              <div className="setting-row number-row">
                <div>
                  <h3>历史上限</h3>
                  <p>超过后自动清理旧记录。</p>
                </div>
                <input
                  className="number-input"
                  type="number"
                  min={20}
                  max={1000}
                  value={state.settings.historyLimit}
                  onChange={(event) => runAction(() => platformBridge.updateSettings({ historyLimit: Number(event.target.value || 200) }))}
                />
              </div>
              <button className="mobile-primary-button" onClick={() => runAction(() => platformBridge.openPermissionGuide())}>
                <ShieldCheck size={18} />
                打开权限引导
              </button>
              <button
                className="mobile-adb-card"
                onClick={() => runAction(() => platformBridge.startAdvancedAdbPairing?.() ?? Promise.resolve())}
              >
                <div className="mobile-adb-card-icon">
                  <Server size={19} />
                </div>
                <div className="mobile-adb-card-copy">
                  <strong>高级后台同步</strong>
                  <span>{state.advancedAdbStatus}</span>
                </div>
                <div className="mobile-adb-card-side">
                  <em className={`mobile-adb-pill ${advancedSyncTone}`}>{state.advancedAdbStatus.includes('已连接') ? '已连接' : '去处理'}</em>
                  <ChevronRight size={18} />
                </div>
              </button>
              <p className="mobile-adb-hint">已配对过的设备会优先直接连接，只有直连失败时才会再次打开系统配对。</p>
            </section>
          </section>
        ) : null}

      </main>

      {error ? (
        <div className={error === '扫码已取消' ? 'mobile-toast soft' : 'mobile-toast'} role="status">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mobile-toast success" role="status">
          {notice}
        </div>
      ) : null}

      <nav className="mobile-bottom-nav">
        {mobileTabs.map((tab) => {
          const TabIcon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={selected ? 'mobile-nav-item active' : 'mobile-nav-item'}
              onClick={() => setActiveTab(tab.id)}
              aria-label={tab.label}
            >
              <TabIcon size={20} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function HistoryRow({
  entry,
  onCopy,
  onDelete,
}: {
  entry: HistoryEntry;
  onCopy: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="history-row">
      <div className="history-row-main">
        <div className="history-icon">{isImageEntry(entry) ? <ImageIcon size={18} /> : <Clipboard size={18} />}</div>
        <div className="history-content">
          <div className="history-topline">
            <strong>{entry.sourceDeviceName}</strong>
            <span>{dayjs(entry.createdAt).format('YYYY-MM-DD HH:mm:ss')}</span>
          </div>
          <p>{entry.preview}</p>
          {entry.imageBase64 ? <img className="image-preview" src={`data:image/png;base64,${entry.imageBase64}`} alt={entry.preview} /> : null}
        </div>
      </div>
      <div className="history-actions">
        <button className="icon-button" onClick={onCopy} title="复制此条">
          <Copy size={16} />
        </button>
        <button className="icon-button" onClick={onDelete} title="删除此条">
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

function SettingToggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="setting-row">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <input className="toggle" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export default App;
