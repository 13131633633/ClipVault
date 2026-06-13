import { createEmptyState, defaultSettings, type AppState, type PairingPayload, type Settings } from '../lib/models';
import type { PlatformBridge } from './types';

const STORAGE_KEY = 'clipvault-browser-state';

interface BrowserPersistedState {
  state: AppState;
}

const listeners = new Set<(state: AppState) => void>();

const generateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `cv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const getPreviewAddress = () => '192.168.3.2';

const generatePairingSecret = () => String(Math.floor(Math.random() * 1000)).padStart(3, '0');

const buildPairingCode = (address: string, secret = generatePairingSecret()) => {
  const suffix = Number(address.split('.').at(-1) ?? 0);
  const hostCode = Number.isInteger(suffix) ? String(suffix).padStart(3, '0') : '000';
  return `${hostCode}${secret.padStart(3, '0').slice(-3)}`;
};

const readPersisted = (): AppState => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const fresh = createEmptyState();
    const deviceId = generateId();
    fresh.device = {
      id: deviceId,
      name: 'ClipVault Desktop',
      platform: 'windows',
      role: 'desktop',
    };
    fresh.settings = { ...defaultSettings };
    fresh.capabilities = {
      canGenerateQr: true,
      canScanQr: false,
      canGuidePermissions: false,
      backgroundMode: 'desktop-preview',
    };
    fresh.localAddress = getPreviewAddress();
    fresh.serviceStatus = 'online';
    fresh.statusMessage = '等待设备连接';
    fresh.advancedAdbStatus = '浏览器预览不支持';
    fresh.pairingPayload = createPairingPayload(fresh.settings.serverPort);
    persist(fresh);
    return fresh;
  }
  const normalized = normalizePreviewState((JSON.parse(raw) as BrowserPersistedState).state);
  persist(normalized);
  return normalized;
};

const persist = (state: AppState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state }));
};

const emit = (state: AppState) => {
  persist(state);
  listeners.forEach((listener) => listener(structuredClone(state)));
};

const createPairingPayload = (port: number): PairingPayload => ({
  version: 1,
  host: getPreviewAddress(),
  port,
  serverId: generateId(),
  serverName: 'ClipVault Desktop',
  platform: 'windows',
  token: generateId(),
  pairingCode: buildPairingCode(getPreviewAddress()),
  issuedAt: Date.now(),
});

const normalizePreviewState = (state: AppState): AppState => {
  const address = getPreviewAddress();
  const pairingPayload = state.pairingPayload ?? createPairingPayload(defaultSettings.serverPort);
  const currentSecret = /^\d{6}$/.test(pairingPayload.pairingCode)
    ? pairingPayload.pairingCode.slice(-3)
    : generatePairingSecret();
  return {
    ...state,
    device: {
      ...state.device,
      name: state.device.name.includes('Browser') ? 'ClipVault Desktop' : state.device.name,
      platform: state.device.platform === 'browser' ? 'windows' : state.device.platform,
      role: 'desktop',
    },
    localAddress: address,
    peers: state.peers.filter((peer) => peer.host !== '127.0.0.1:49372'),
    settings: {
      ...state.settings,
      serverPort: defaultSettings.serverPort,
    },
    capabilities: {
      ...state.capabilities,
      backgroundMode: 'desktop-preview',
    },
    advancedAdbStatus: state.advancedAdbStatus || '浏览器预览不支持',
    pairingPayload: {
      ...pairingPayload,
      host: address,
      port: defaultSettings.serverPort,
      serverName: 'ClipVault Desktop',
      platform: 'windows',
      pairingCode: buildPairingCode(address, currentSecret),
    },
  };
};

class BrowserBridge implements PlatformBridge {
  private state = readPersisted();

  async start() {
    return structuredClone(this.state);
  }

  async getState() {
    return structuredClone(this.state);
  }

  async refreshPairing() {
    this.state = {
      ...this.state,
      pairingPayload: createPairingPayload(this.state.settings.serverPort),
      statusMessage: '配对信息已刷新',
    };
    emit(this.state);
    return structuredClone(this.state);
  }

  async scanAndConnect() {
    return Promise.reject(new Error('当前运行环境不支持扫码。'));
  }

  async connectWithPayload(payload: string): Promise<AppState> {
    const normalized = payload.trim();
    if (/^\d{6}$/.test(normalized)) {
      throw new Error('请在 Windows 客户端或手机端连接真实设备，网页环境不创建模拟连接。');
    }
    const parsed = JSON.parse(normalized) as PairingPayload | null;
    if (!parsed?.host || !parsed?.port || !parsed?.serverId) {
      throw new Error('请使用 ClipVault 生成的二维码内容或 6 位配对码。');
    }
    throw new Error('请在 Windows 客户端或手机端连接真实设备，网页环境不创建模拟连接。');
  }

  async disconnectPeer(peerId: string) {
    this.state = {
      ...this.state,
      peers: this.state.peers.filter((peer) => peer.id !== peerId),
      statusMessage: '已断开设备',
    };
    emit(this.state);
    return structuredClone(this.state);
  }

  async disconnectAll() {
    this.state = {
      ...this.state,
      peers: [],
      statusMessage: '已断开全部设备',
    };
    emit(this.state);
    return structuredClone(this.state);
  }

  async copyHistory(entryId: string) {
    const entry = this.state.history.find((item) => item.id === entryId);
    if (entry?.text) {
      await navigator.clipboard.writeText(entry.text);
    }
    this.state = {
      ...this.state,
      statusMessage: '历史记录已复制到浏览器剪贴板',
    };
    emit(this.state);
    return structuredClone(this.state);
  }

  async deleteHistory(entryId: string) {
    this.state = {
      ...this.state,
      history: this.state.history.filter((entry) => entry.id !== entryId),
      statusMessage: '已删除记录',
    };
    emit(this.state);
    return structuredClone(this.state);
  }

  async clearHistory() {
    this.state = {
      ...this.state,
      history: [],
      statusMessage: '历史记录已清空',
    };
    emit(this.state);
    return structuredClone(this.state);
  }

  async updateSettings(patch: Partial<Settings>) {
    this.state = {
      ...this.state,
      settings: {
        ...this.state.settings,
        ...patch,
      },
      statusMessage: '设置已保存',
    };
    emit(this.state);
    return structuredClone(this.state);
  }

  async openPermissionGuide() {
    return;
  }

  async startAdvancedAdbPairing() {
    return structuredClone(this.state);
  }

  subscribe(listener: (state: AppState) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
}

export const browserBridge = new BrowserBridge();
