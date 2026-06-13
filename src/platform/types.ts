import type { AppState, Settings } from '../lib/models';

export interface PlatformBridge {
  start(): Promise<AppState>;
  getState(): Promise<AppState>;
  refreshPairing(): Promise<AppState>;
  scanAndConnect(): Promise<AppState>;
  connectWithPayload(payload: string): Promise<AppState>;
  disconnectPeer(peerId: string): Promise<AppState>;
  disconnectAll(): Promise<AppState>;
  copyHistory(entryId: string): Promise<AppState>;
  deleteHistory(entryId: string): Promise<AppState>;
  clearHistory(): Promise<AppState>;
  updateSettings(patch: Partial<Settings>): Promise<AppState>;
  openPermissionGuide(): Promise<void>;
  startAdvancedAdbPairing?(): Promise<AppState | void>;
  subscribe(listener: (state: AppState) => void): () => void;
}
