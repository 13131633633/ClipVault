export type PlatformKind = 'windows' | 'linux' | 'android' | 'ios' | 'browser';
export type DeviceRole = 'desktop' | 'mobile';
export type ClipboardMime = 'text/plain' | 'image/png';
export type DeviceStatus = 'online' | 'offline' | 'syncing';
export type EntryDirection = 'local' | 'inbound' | 'outbound';

export interface DeviceInfo {
  id: string;
  name: string;
  platform: PlatformKind;
  role: DeviceRole;
}

export interface PeerDevice {
  id: string;
  name: string;
  platform: PlatformKind;
  host: string;
  status: DeviceStatus;
  lastSeen: number;
}

export interface HistoryEntry {
  id: string;
  mimeType: ClipboardMime;
  preview: string;
  text?: string;
  imageBase64?: string;
  createdAt: number;
  sourceDeviceId: string;
  sourceDeviceName: string;
  sha256: string;
  direction: EntryDirection;
}

export interface Settings {
  syncEnabled: boolean;
  launchAtStartup: boolean;
  minimizeToTray: boolean;
  historyLimit: number;
  serverPort: number;
  theme: 'hoj-light';
}

export interface PairingPayload {
  version: number;
  host: string;
  port: number;
  serverId: string;
  serverName: string;
  platform?: PlatformKind;
  token: string;
  pairingCode: string;
  issuedAt: number;
}

export interface Capabilities {
  canGenerateQr: boolean;
  canScanQr: boolean;
  canGuidePermissions: boolean;
  backgroundMode: string;
}

export interface AppState {
  device: DeviceInfo;
  serviceStatus: DeviceStatus;
  statusMessage: string;
  advancedAdbStatus: string;
  localAddress: string;
  pairingPayload: PairingPayload | null;
  peers: PeerDevice[];
  history: HistoryEntry[];
  settings: Settings;
  capabilities: Capabilities;
  notes: string[];
}

export const defaultSettings: Settings = {
  syncEnabled: true,
  launchAtStartup: true,
  minimizeToTray: true,
  historyLimit: 200,
  serverPort: 49372,
  theme: 'hoj-light',
};

export const createEmptyState = (): AppState => ({
  device: {
    id: 'clipvault-local',
    name: 'ClipVault',
    platform: 'windows',
    role: 'desktop',
  },
  serviceStatus: 'offline',
  statusMessage: '准备中',
  advancedAdbStatus: '未启用',
  localAddress: '',
  pairingPayload: null,
  peers: [],
  history: [],
  settings: defaultSettings,
  capabilities: {
    canGenerateQr: false,
    canScanQr: false,
    canGuidePermissions: false,
    backgroundMode: 'preview',
  },
  notes: [],
});

export const isImageEntry = (entry: HistoryEntry) => entry.mimeType === 'image/png';

export const sortHistory = (history: HistoryEntry[]) =>
  [...history].sort((left, right) => right.createdAt - left.createdAt);
