import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  BarcodeFormat,
  BarcodeScanner,
  LensFacing,
  Resolution,
} from '@capacitor-mlkit/barcode-scanning';
import type { AppState, Settings } from '../lib/models';
import type { PlatformBridge } from './types';

interface NativeResponse {
  state: AppState;
}

interface NativeScanResponse {
  payload: string;
}

interface NativePlugin {
  start(): Promise<NativeResponse>;
  getState(): Promise<NativeResponse>;
  refreshPairing(): Promise<NativeResponse>;
  connectWithPayload(options: { payload: string }): Promise<NativeResponse>;
  disconnectPeer(options: { peerId: string }): Promise<NativeResponse>;
  disconnectAll(): Promise<NativeResponse>;
  copyHistory(options: { entryId: string }): Promise<NativeResponse>;
  deleteHistory(options: { entryId: string }): Promise<NativeResponse>;
  clearHistory(): Promise<NativeResponse>;
  updateSettings(options: { settings: string }): Promise<NativeResponse>;
  openPermissionGuide(): Promise<void>;
  startAdvancedAdbPairing(): Promise<NativeResponse>;
  scanQrCodeNative(): Promise<NativeScanResponse>;
  addListener(
    eventName: 'stateChanged',
    listenerFunc: (event: NativeResponse | AppState) => void,
  ): Promise<PluginListenerHandle>;
}

const ClipVaultNative = registerPlugin<NativePlugin>('ClipVaultNative');

class CapacitorBridge implements PlatformBridge {
  private listeners = new Set<(state: AppState) => void>();
  private handle: PluginListenerHandle | null = null;

  private async ensureListener() {
    if (this.handle) {
      return;
    }
    this.handle = await ClipVaultNative.addListener('stateChanged', (event) => {
      const nextState = 'state' in event ? event.state : event;
      this.listeners.forEach((listener) => listener(nextState));
    });
  }

  async start() {
    await this.ensureListener();
    const result = await ClipVaultNative.start();
    return result.state;
  }

  async getState() {
    const result = await ClipVaultNative.getState();
    return result.state;
  }

  async refreshPairing() {
    const result = await ClipVaultNative.refreshPairing();
    return result.state;
  }

  private async requestCameraPermission() {
    const permissions = await BarcodeScanner.requestPermissions();
    if (permissions.camera !== 'granted' && permissions.camera !== 'limited') {
      throw new Error('未授予相机权限。');
    }
  }

  private createScannerOverlay(onCancel: () => void, onTorchToggle: () => void) {
    const overlay = document.createElement('div');
    overlay.className = 'barcode-scanner-modal';

    const panel = document.createElement('div');
    panel.className = 'barcode-scanner-panel';

    const title = document.createElement('strong');
    title.textContent = '扫描电脑端二维码';

    const subtitle = document.createElement('span');
    subtitle.textContent = '二维码出现在画面里即可，系统会自动识别';

    const frame = document.createElement('div');
    frame.className = 'barcode-scanner-frame';

    const controls = document.createElement('div');
    controls.className = 'barcode-scanner-controls';

    const torch = document.createElement('button');
    torch.type = 'button';
    torch.className = 'barcode-scanner-ghost';
    torch.textContent = '打开补光';
    torch.addEventListener('click', onTorchToggle);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消扫码';
    cancel.addEventListener('click', onCancel);

    controls.append(torch, cancel);
    panel.append(title, subtitle, frame, controls);
    overlay.append(panel);
    document.body.append(overlay);
    document.documentElement.classList.add('barcode-scanner-active');
    document.body.classList.add('barcode-scanner-active');
    return {
      overlay,
      subtitle,
      torch,
    };
  }

  private pickBarcodePayload(barcodes: Array<{ displayValue?: string; rawValue?: string; cornerPoints?: [number, number][] }>) {
    const ranked = [...barcodes].sort((left, right) => {
      const leftArea = this.getBarcodeArea(left.cornerPoints);
      const rightArea = this.getBarcodeArea(right.cornerPoints);
      return rightArea - leftArea;
    });
    const preferred = ranked.find((barcode) => {
      const payload = barcode.displayValue || barcode.rawValue || '';
      return payload.includes('"pairingCode"') || payload.includes('"deviceId"') || /^\d{6}$/.test(payload.trim());
    });
    const candidate = preferred ?? ranked[0];
    return candidate?.displayValue || candidate?.rawValue || '';
  }

  private getBarcodeArea(points?: [number, number][]) {
    if (!points || points.length < 4) {
      return 0;
    }
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  }

  private async scanWithEmbeddedScanner() {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let listener: PluginListenerHandle | null = null;
      let errorListener: PluginListenerHandle | null = null;
      let overlay: { overlay: HTMLDivElement; subtitle: HTMLSpanElement; torch: HTMLButtonElement } | null = null;
      let torchEnabled = false;
      let zoomTimerA = 0;
      let zoomTimerB = 0;
      const timeout = window.setTimeout(() => {
        finish('', new Error('扫码超时，请重新对准电脑端二维码。'));
      }, 120000);

      const finish = (payload = '', error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        window.clearTimeout(zoomTimerA);
        window.clearTimeout(zoomTimerB);
        document.documentElement.classList.remove('barcode-scanner-active');
        document.body.classList.remove('barcode-scanner-active');
        overlay?.overlay.remove();
        void listener?.remove();
        void errorListener?.remove();
        void BarcodeScanner.stopScan();
        if (error) {
          reject(error);
        } else {
          resolve(payload);
        }
      };

      const toggleTorch = async () => {
        try {
          if (!torchEnabled) {
            await BarcodeScanner.enableTorch();
            torchEnabled = true;
            overlay?.torch && (overlay.torch.textContent = '关闭补光');
          } else {
            await BarcodeScanner.disableTorch();
            torchEnabled = false;
            overlay?.torch && (overlay.torch.textContent = '打开补光');
          }
        } catch {
          overlay?.subtitle && (overlay.subtitle.textContent = '当前设备不支持补光，继续直接扫码即可');
        }
      };

      overlay = this.createScannerOverlay(() => finish('', new Error('已取消扫码。')), () => {
        void toggleTorch();
      });

      void BarcodeScanner.addListener('barcodesScanned', (event) => {
        const payload = this.pickBarcodePayload(event.barcodes);
        if (payload) {
          if (overlay?.subtitle) {
            overlay.subtitle.textContent = '识别成功，正在建立连接…';
          }
          finish(payload);
        }
      })
        .then((handle) => {
          listener = handle;
          return BarcodeScanner.addListener('scanError', (event) => {
            if (overlay?.subtitle && event.message) {
              overlay.subtitle.textContent = '相机已开启，请稍微移动手机重新对准二维码';
            }
          });
        })
        .then((handle) => {
          errorListener = handle;
          return BarcodeScanner.startScan({
            formats: [BarcodeFormat.QrCode],
            lensFacing: LensFacing.Back,
            resolution: Resolution['1920x1080'],
          });
        })
        .then(async () => {
          try {
            const { available } = await BarcodeScanner.isTorchAvailable();
            if (!available && overlay?.torch) {
              overlay.torch.style.display = 'none';
            }
          } catch {
            if (overlay?.torch) {
              overlay.torch.style.display = 'none';
            }
          }
          zoomTimerA = window.setTimeout(() => {
            void BarcodeScanner.getMaxZoomRatio()
              .then(({ zoomRatio }) => BarcodeScanner.setZoomRatio({ zoomRatio: Math.min(1.35, zoomRatio) }))
              .then(() => {
                if (overlay?.subtitle) {
                  overlay.subtitle.textContent = '正在自动放大取景，二维码出现在画面里即可';
                }
              })
              .catch(() => undefined);
          }, 3500);
          zoomTimerB = window.setTimeout(() => {
            void BarcodeScanner.getMaxZoomRatio()
              .then(({ zoomRatio }) => BarcodeScanner.setZoomRatio({ zoomRatio: Math.min(1.8, zoomRatio) }))
              .catch(() => undefined);
          }, 7000);
        })
        .catch((error) => {
          finish('', error instanceof Error ? error : new Error('扫码启动失败。'));
        });
    });
  }

  async scanAndConnect() {
    const supported = await BarcodeScanner.isSupported();
    if (!supported.supported) {
      throw new Error('当前设备不支持扫码。');
    }

    await this.requestCameraPermission();

    const payload =
      Capacitor.getPlatform() === 'android'
        ? (await ClipVaultNative.scanQrCodeNative()).payload
        : await this.scanWithEmbeddedScanner();

    if (!payload) {
      throw new Error('未识别到二维码内容。');
    }
    const state = await ClipVaultNative.connectWithPayload({ payload });
    return state.state;
  }

  async connectWithPayload(payload: string) {
    const result = await ClipVaultNative.connectWithPayload({ payload });
    return result.state;
  }

  async disconnectPeer(peerId: string) {
    const result = await ClipVaultNative.disconnectPeer({ peerId });
    return result.state;
  }

  async disconnectAll() {
    const result = await ClipVaultNative.disconnectAll();
    return result.state;
  }

  async copyHistory(entryId: string) {
    const result = await ClipVaultNative.copyHistory({ entryId });
    return result.state;
  }

  async deleteHistory(entryId: string) {
    const result = await ClipVaultNative.deleteHistory({ entryId });
    return result.state;
  }

  async clearHistory() {
    const result = await ClipVaultNative.clearHistory();
    return result.state;
  }

  async updateSettings(patch: Partial<Settings>) {
    const result = await ClipVaultNative.updateSettings({
      settings: JSON.stringify(patch),
    });
    return result.state;
  }

  async openPermissionGuide() {
    await ClipVaultNative.openPermissionGuide();
  }

  async startAdvancedAdbPairing() {
    const result = await ClipVaultNative.startAdvancedAdbPairing();
    return result.state;
  }

  subscribe(listener: (state: AppState) => void) {
    this.listeners.add(listener);
    void this.ensureListener();
    return () => this.listeners.delete(listener);
  }
}

export const capacitorBridge = new CapacitorBridge();
export const isNativeCapacitor = Capacitor.isNativePlatform();
