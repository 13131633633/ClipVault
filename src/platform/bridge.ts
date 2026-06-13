import { browserBridge } from './browserBridge';
import { capacitorBridge, isNativeCapacitor } from './capacitorBridge';
import type { AppState, Settings } from '../lib/models';
import type { PlatformBridge } from './types';

declare global {
  interface Window {
    clipVaultDesktop?: {
      start: () => Promise<AppState>;
      getState: () => Promise<AppState>;
      refreshPairing: () => Promise<AppState>;
      connectWithPayload: (payload: string) => Promise<AppState>;
      disconnectPeer: (peerId: string) => Promise<AppState>;
      disconnectAll: () => Promise<AppState>;
      copyHistory: (entryId: string) => Promise<AppState>;
      deleteHistory: (entryId: string) => Promise<AppState>;
      clearHistory: () => Promise<AppState>;
      updateSettings: (patch: Partial<Settings>) => Promise<AppState>;
      openPermissionGuide: () => Promise<void>;
      startAdvancedAdbPairing?: () => Promise<AppState>;
      onStateChanged: (listener: (state: AppState) => void) => () => void;
    };
  }
}

class DesktopBridge implements PlatformBridge {
  async start() {
    return window.clipVaultDesktop!.start();
  }

  async getState() {
    return window.clipVaultDesktop!.getState();
  }

  async refreshPairing() {
    return window.clipVaultDesktop!.refreshPairing();
  }

  async scanAndConnect() {
    return Promise.reject(new Error('桌面端通过生成二维码配对。'));
  }

  async connectWithPayload(payload: string) {
    return window.clipVaultDesktop!.connectWithPayload(payload);
  }

  async disconnectPeer(peerId: string) {
    return window.clipVaultDesktop!.disconnectPeer(peerId);
  }

  async disconnectAll() {
    return window.clipVaultDesktop!.disconnectAll();
  }

  async copyHistory(entryId: string) {
    return window.clipVaultDesktop!.copyHistory(entryId);
  }

  async deleteHistory(entryId: string) {
    return window.clipVaultDesktop!.deleteHistory(entryId);
  }

  async clearHistory() {
    return window.clipVaultDesktop!.clearHistory();
  }

  async updateSettings(patch: Partial<Settings>) {
    return window.clipVaultDesktop!.updateSettings(patch);
  }

  async openPermissionGuide() {
    return window.clipVaultDesktop!.openPermissionGuide();
  }

  async startAdvancedAdbPairing() {
    return undefined;
  }

  subscribe(listener: (state: AppState) => void) {
    return window.clipVaultDesktop!.onStateChanged(listener);
  }
}

const createBridge = (): PlatformBridge => {
  if (typeof window !== 'undefined' && window.clipVaultDesktop) {
    return new DesktopBridge();
  }
  if (isNativeCapacitor) {
    return capacitorBridge;
  }
  return browserBridge;
};

export const platformBridge = createBridge();
