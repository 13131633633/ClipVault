import { clipboard, nativeImage } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DISCOVERY_PORT = 49373;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopIconPath = path.resolve(__dirname, '..', 'assets', 'desktop-icon.png');

const DEFAULT_SETTINGS = {
  syncEnabled: true,
  launchAtStartup: true,
  minimizeToTray: true,
  historyLimit: 200,
  serverPort: 49372,
  theme: 'hoj-light',
};

const clampHistoryLimit = (value) => Math.max(20, Math.min(1000, Number(value || 200)));

const desktopNotes = [
  '一台电脑可同时连接多部手机。',
  '文本和 PNG 图片都支持双向同步。',
  '断网后保留本地历史，网络恢复自动重连。',
];

const createHashValue = (value) => createHash('sha256').update(value).digest('hex');
const createPairingSecret = () => String(Math.floor(Math.random() * 1000)).padStart(3, '0');

const parseIpv4Parts = (address) => {
  const parts = String(address ?? '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
};

const buildPairingCode = (address, secret) => {
  const parts = parseIpv4Parts(address);
  const hostCode = parts ? String(parts[3]).padStart(3, '0') : '000';
  return `${hostCode}${String(secret ?? '').padStart(3, '0').slice(-3)}`;
};

const resolveHostFromPairingCode = (localAddress, pairingCode) => {
  const parts = parseIpv4Parts(localAddress);
  if (!parts) {
    throw new Error('当前设备未连接到局域网，请先连接同一 Wi-Fi 或有线网络。');
  }
  const targetSuffix = Number(pairingCode.slice(0, 3));
  if (!Number.isInteger(targetSuffix) || targetSuffix < 1 || targetSuffix > 254) {
    throw new Error('配对码格式不正确，请输入有效的 6 位配对码。');
  }
  return `${parts[0]}.${parts[1]}.${parts[2]}.${targetSuffix}`;
};

const previewText = (text) => {
  const flattened = text.replace(/\s+/g, ' ').trim();
  return flattened.length > 96 ? `${flattened.slice(0, 96)}...` : flattened;
};

const inferLocalAddress = () => {
  const interfaces = os.networkInterfaces();
  for (const values of Object.values(interfaces)) {
    for (const item of values ?? []) {
      if (item.family === 'IPv4' && !item.internal) {
        return item.address;
      }
    }
  }
  return '127.0.0.1';
};

const encodeFrame = (payload) => {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(raw.length, 0);
  return Buffer.concat([header, raw]);
};

const parseFrames = (state) => {
  const messages = [];
  while (state.buffer.length >= 4) {
    const length = state.buffer.readUInt32BE(0);
    if (state.buffer.length < 4 + length) {
      break;
    }
    const body = state.buffer.subarray(4, 4 + length);
    messages.push(JSON.parse(body.toString('utf8')));
    state.buffer = state.buffer.subarray(4 + length);
  }
  return messages;
};

export class DesktopSyncService extends EventEmitter {
  constructor({ dataRoot, appName, onSettingsChanged }) {
    super();
    this.dataRoot = dataRoot;
    this.appName = appName;
    this.onSettingsChanged = onSettingsChanged;
    this.storePath = path.join(this.dataRoot, 'clipvault-store.json');
    this.logPath = path.join(this.dataRoot, 'clipvault-sync.log');
    this.server = null;
    this.discoverySocket = null;
    this.peers = new Map();
    this.interval = null;
    this.lastClipboardSignature = '';
    this.suppressedSignature = '';
    this.recentRoutes = new Map();
    this.state = {
      device: {
        id: randomUUID(),
        name: os.hostname() || 'ClipVault Desktop',
        platform: process.platform === 'win32' ? 'windows' : 'linux',
        role: 'desktop',
      },
      serviceStatus: 'offline',
      statusMessage: '等待启动',
      localAddress: inferLocalAddress(),
      pairingPayload: null,
      peers: [],
      history: [],
      settings: { ...DEFAULT_SETTINGS },
      capabilities: {
        canGenerateQr: true,
        canScanQr: false,
        canGuidePermissions: false,
        backgroundMode: 'tray-resident',
      },
      notes: desktopNotes,
    };
    this.serverIdentity = {
      serverId: randomUUID(),
      token: randomUUID(),
      pairingCode: buildPairingCode(inferLocalAddress(), createPairingSecret()),
    };
  }

  async init() {
    await fs.mkdir(this.dataRoot, { recursive: true });
    await this.load();
    try {
      await this.startServer();
    } catch (error) {
      this.state.serviceStatus = 'offline';
      this.state.statusMessage = this.describeServerError(error);
      this.emitState();
    }
    this.startClipboardWatcher();
    this.emitState();
    return this.getState();
  }

  getState() {
    return structuredClone(this.state);
  }

  getTrayIcon() {
    const icon = nativeImage.createFromPath(desktopIconPath);
    if (icon.isEmpty()) {
      return nativeImage.createEmpty();
    }
    return icon;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.state.device = { ...this.state.device, ...(parsed.device ?? {}) };
      this.state.history = Array.isArray(parsed.history) ? parsed.history : [];
      this.state.settings = {
        ...DEFAULT_SETTINGS,
        ...(parsed.settings ?? {}),
        serverPort: DEFAULT_SETTINGS.serverPort,
        historyLimit: clampHistoryLimit(parsed?.settings?.historyLimit ?? DEFAULT_SETTINGS.historyLimit),
      };
      this.serverIdentity = {
        serverId: parsed.serverIdentity?.serverId ?? this.serverIdentity.serverId,
        token: parsed.serverIdentity?.token ?? this.serverIdentity.token,
        pairingCode: parsed.serverIdentity?.pairingCode ?? this.serverIdentity.pairingCode,
      };
    } catch {
      await this.persist();
    }
  }

  async persist() {
    const payload = {
      device: this.state.device,
      settings: this.state.settings,
      history: this.state.history.slice(0, this.state.settings.historyLimit),
      serverIdentity: this.serverIdentity,
    };
    await fs.writeFile(this.storePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  emitState() {
    this.state.localAddress = inferLocalAddress();
    const pairingSecret = this.serverIdentity.pairingCode.slice(-3).padStart(3, '0');
    this.serverIdentity.pairingCode = buildPairingCode(this.state.localAddress, pairingSecret);
    this.state.pairingPayload = {
      version: 1,
      host: this.state.localAddress,
      port: this.state.settings.serverPort,
      serverId: this.serverIdentity.serverId,
      serverName: this.state.device.name,
      platform: this.state.device.platform,
      token: this.serverIdentity.token,
      pairingCode: this.serverIdentity.pairingCode,
      pairingSecret,
      issuedAt: Date.now(),
    };
    this.state.peers = [...this.peers.values()]
      .filter((peer) => peer.id)
      .map((peer) => ({
        id: peer.id,
        name: peer.name,
        platform: peer.platform,
        host: peer.host,
        status: peer.status,
        lastSeen: peer.lastSeen,
      }))
      .sort((left, right) => right.lastSeen - left.lastSeen);
    this.emit('stateChanged', this.getState());
  }

  async startServer() {
    if (this.server) {
      await this.stopServer();
    }

    this.server = net.createServer((socket) => {
      const peerState = {
        socket,
        buffer: Buffer.alloc(0),
        id: null,
        name: '未认证设备',
        platform: 'android',
        host: `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`,
        status: 'syncing',
        lastSeen: Date.now(),
      };
      socket.setKeepAlive(true, 5000);

      socket.on('data', async (chunk) => {
        peerState.buffer = Buffer.concat([peerState.buffer, chunk]);
        for (const message of parseFrames(peerState)) {
          await this.handleSocketMessage(peerState, message);
        }
      });

      socket.on('close', () => {
        if (peerState.id) {
          this.peers.delete(peerState.id);
          this.state.statusMessage = this.peers.size > 0 ? '部分设备已断开' : '等待新设备连接';
          this.emitState();
        }
      });

      socket.on('error', () => {
        socket.destroy();
      });
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server = null;
        reject(error);
      };
      this.server.once('error', onError);
      this.server.listen(this.state.settings.serverPort, '0.0.0.0', resolve);
    });

    this.state.serviceStatus = 'online';
    this.state.statusMessage = '等待手机扫码连接';
    await this.startDiscoveryServer();
    this.emitState();
  }

  async stopServer() {
    if (!this.server) {
      return;
    }
    for (const peer of this.peers.values()) {
      peer.socket.destroy();
    }
    this.peers.clear();
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    await this.stopDiscoveryServer();
  }

  async debugLog(message) {
    try {
      await fs.mkdir(this.dataRoot, { recursive: true });
      await fs.appendFile(this.logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
    } catch {
      // Runtime diagnostics must never interrupt sync.
    }
  }

  describeServerError(error) {
    if (error?.code === 'EADDRINUSE') {
      return `默认端口 ${this.state.settings.serverPort} 已被占用，请关闭另一个 ClipVault 或占用该端口的程序后刷新配对信息。`;
    }
    return `同步服务启动失败：${error instanceof Error ? error.message : String(error)}`;
  }

  startClipboardWatcher() {
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.interval = setInterval(() => {
      void this.pollClipboard();
    }, 700);
  }

  async pollClipboard() {
    if (!this.state.settings.syncEnabled) {
      return;
    }

    const text = clipboard.readText();
    const image = clipboard.readImage();
    let signature = '';
    let entry = null;

    if (text.trim()) {
      signature = `text:${createHashValue(text)}`;
      if (signature !== this.lastClipboardSignature) {
        entry = {
          id: randomUUID(),
          mimeType: 'text/plain',
          preview: previewText(text),
          text,
          createdAt: Date.now(),
          sourceDeviceId: this.state.device.id,
          sourceDeviceName: this.state.device.name,
          sha256: createHashValue(text),
          direction: this.peers.size > 0 ? 'outbound' : 'local',
        };
      }
    } else if (!image.isEmpty()) {
      const png = image.toPNG();
      signature = `image:${createHashValue(png)}`;
      if (signature !== this.lastClipboardSignature) {
        entry = {
          id: randomUUID(),
          mimeType: 'image/png',
          preview: 'PNG 图片',
          imageBase64: png.toString('base64'),
          createdAt: Date.now(),
          sourceDeviceId: this.state.device.id,
          sourceDeviceName: this.state.device.name,
          sha256: createHashValue(png),
          direction: this.peers.size > 0 ? 'outbound' : 'local',
        };
      }
    }

    if (!signature) {
      return;
    }

    if (signature === this.suppressedSignature) {
      this.lastClipboardSignature = signature;
      this.suppressedSignature = '';
      return;
    }

    if (!entry) {
      this.lastClipboardSignature = signature;
      return;
    }

    this.lastClipboardSignature = signature;
    await this.publishClipboardEntry(entry, { routeId: randomUUID(), originPeerId: null, applyLocally: false });
  }

  async handleSocketMessage(peerState, message) {
    if (message.type === 'hello') {
      const tokenMatched = message.token && message.token === this.serverIdentity.token;
      const secretMatched = message.pairingSecret && message.pairingSecret === this.serverIdentity.pairingCode.slice(-3);
      if (!tokenMatched && !secretMatched) {
        peerState.socket.end();
        return;
      }
      peerState.id = message.device.id;
      peerState.name = message.device.name;
      peerState.platform = message.device.platform;
      peerState.host = peerState.host;
      peerState.status = 'online';
      peerState.lastSeen = Date.now();
      this.peers.set(peerState.id, peerState);
      await this.debugLog(`hello accepted from ${peerState.id} ${peerState.name} ${peerState.host}`);
      this.writeToPeer(peerState, {
        type: 'welcome',
        server: {
          id: this.state.device.id,
          name: this.state.device.name,
          platform: this.state.device.platform,
        },
        peers: this.state.peers,
      });
      this.state.statusMessage = '设备已连接，实时同步中';
      this.emitState();
      return;
    }

    if (message.type === 'welcome') {
      const server = message.server ?? {};
      const previousId = peerState.id;
      peerState.id = server.id ?? peerState.id;
      peerState.name = server.name ?? peerState.name;
      peerState.platform = server.platform ?? peerState.platform;
      peerState.status = 'online';
      peerState.lastSeen = Date.now();
      if (previousId !== peerState.id) {
        this.peers.delete(previousId);
      }
      this.peers.set(peerState.id, peerState);
      this.state.serviceStatus = 'online';
      this.state.statusMessage = '连接已建立';
      await this.debugLog(`welcome from ${peerState.id} ${peerState.name} ${peerState.host}`);
      this.emitState();
      return;
    }

    if (!peerState.id) {
      peerState.socket.end();
      return;
    }

    peerState.lastSeen = Date.now();

    if (message.type === 'clipboard_update' && message.entry) {
      await this.debugLog(`clipboard_update received from ${peerState.id} route=${message.routeId ?? ''} preview=${message.entry.preview ?? ''}`);
      await this.publishClipboardEntry(
        {
          ...message.entry,
          direction: 'inbound',
        },
        {
          routeId: message.routeId ?? randomUUID(),
          originPeerId: peerState.id,
          applyLocally: true,
        },
      );
    }
  }

  async publishClipboardEntry(entry, { routeId, originPeerId, applyLocally }) {
    if (this.recentRoutes.has(routeId)) {
      return;
    }

    this.recentRoutes.set(routeId, Date.now());
    if (this.recentRoutes.size > 512) {
      const expired = [...this.recentRoutes.entries()]
        .sort((left, right) => left[1] - right[1])
        .slice(0, 128);
      expired.forEach(([key]) => this.recentRoutes.delete(key));
    }

    if (applyLocally && this.state.settings.syncEnabled) {
      this.writeClipboard(entry);
    }

    this.pushHistory(entry);
    await this.debugLog(`history pushed direction=${entry.direction} origin=${originPeerId ?? 'local'} route=${routeId} preview=${entry.preview ?? ''}`);

    for (const peer of this.peers.values()) {
      if (!peer.id || peer.id === originPeerId) {
        continue;
      }
      this.writeToPeer(peer, {
        type: 'clipboard_update',
        routeId,
        entry: {
          ...entry,
          direction: 'outbound',
        },
      });
      await this.debugLog(`clipboard_update sent to ${peer.id} route=${routeId} preview=${entry.preview ?? ''}`);
    }

    this.state.serviceStatus = this.peers.size > 0 ? 'syncing' : 'online';
    this.state.statusMessage = this.peers.size > 0 ? '剪贴板已同步到已连接设备' : '本地记录已更新';
    this.emitState();
    await this.persist();
    this.state.serviceStatus = 'online';
    this.emitState();
  }

  pushHistory(entry) {
    this.state.history = [
      entry,
      ...this.state.history.filter((item) => item.id !== entry.id && item.sha256 !== entry.sha256),
    ].slice(0, clampHistoryLimit(this.state.settings.historyLimit));
  }

  writeClipboard(entry) {
    if (entry.mimeType === 'text/plain' && entry.text) {
      clipboard.writeText(entry.text);
      this.suppressedSignature = `text:${entry.sha256}`;
      this.lastClipboardSignature = this.suppressedSignature;
      return;
    }

    if (entry.mimeType === 'image/png' && entry.imageBase64) {
      const image = nativeImage.createFromBuffer(Buffer.from(entry.imageBase64, 'base64'));
      clipboard.writeImage(image);
      this.suppressedSignature = `image:${entry.sha256}`;
      this.lastClipboardSignature = this.suppressedSignature;
    }
  }

  writeToPeer(peerState, payload) {
    try {
      peerState.socket.write(encodeFrame(payload));
    } catch {
      peerState.socket.destroy();
    }
  }

  async refreshPairing() {
    this.serverIdentity.token = randomUUID();
    this.serverIdentity.pairingCode = buildPairingCode(inferLocalAddress(), createPairingSecret());
    if (!this.server) {
      try {
        await this.startServer();
      } catch (error) {
        this.state.serviceStatus = 'offline';
        this.state.statusMessage = this.describeServerError(error);
        this.emitState();
        await this.persist();
        return this.getState();
      }
    }
    this.state.statusMessage = '二维码和配对码已刷新';
    this.emitState();
    await this.persist();
    return this.getState();
  }

  async startDiscoveryServer() {
    if (this.discoverySocket) {
      return;
    }

    this.discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.discoverySocket.on('message', (message, rinfo) => {
      try {
        const request = JSON.parse(message.toString('utf8'));
        if (request.type !== 'clipvault_pairing_lookup' || request.pairingCode !== this.serverIdentity.pairingCode) {
          return;
        }
        const response = Buffer.from(
          JSON.stringify({
            type: 'clipvault_pairing_offer',
            payload: this.state.pairingPayload,
          }),
          'utf8',
        );
        this.discoverySocket?.send(response, rinfo.port, rinfo.address);
      } catch {
        // Ignore malformed discovery packets from other LAN software.
      }
    });
    this.discoverySocket.on('error', () => {
      this.discoverySocket?.close();
      this.discoverySocket = null;
    });
    await new Promise((resolve) => this.discoverySocket.bind(DISCOVERY_PORT, '0.0.0.0', resolve));
  }

  async stopDiscoveryServer() {
    if (!this.discoverySocket) {
      return;
    }
    await new Promise((resolve) => this.discoverySocket.close(resolve));
    this.discoverySocket = null;
  }

  async resolvePairingInput(input) {
    const normalized = String(input ?? '').trim();
    if (!normalized) {
      throw new Error('请输入配对码或二维码内容。');
    }
    if (!/^\d{6}$/.test(normalized)) {
      return JSON.parse(normalized);
    }

    const host = resolveHostFromPairingCode(inferLocalAddress(), normalized);
    return {
      version: 1,
      host,
      port: this.state.settings.serverPort,
      serverId: `pairing-${host}`,
      serverName: 'ClipVault 设备',
      platform: 'unknown',
      token: '',
      pairingCode: normalized,
      pairingSecret: normalized.slice(-3),
      issuedAt: Date.now(),
    };
  }

  async connectWithPayload(payload) {
    const normalizedPayload = String(payload ?? '').trim();
    const fromPairingCode = /^\d{6}$/.test(normalizedPayload);
    const parsed = await this.resolvePairingInput(payload);
    if (!parsed?.host || !parsed?.port || !parsed?.serverId || (!parsed?.token && !parsed?.pairingSecret)) {
      throw new Error('配对内容无效。');
    }
    const localAddress = inferLocalAddress();
    if (
      parsed.serverId === this.serverIdentity.serverId ||
      (parsed.host === localAddress && parsed.pairingSecret === this.serverIdentity.pairingCode.slice(-3))
    ) {
      throw new Error('不能连接本机生成的配对码。');
    }

    const peerId = parsed.serverId;
    this.peers.get(peerId)?.socket?.destroy();
    this.state.serviceStatus = 'syncing';
    this.state.statusMessage = `正在连接 ${parsed.serverName ?? 'ClipVault 设备'}`;
    this.emitState();

    await new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setKeepAlive(true, 5000);
      let settled = false;
      const peerState = {
        socket,
        buffer: Buffer.alloc(0),
        id: peerId,
        name: parsed.serverName ?? 'ClipVault 设备',
        platform: parsed.platform ?? 'windows',
        host: `${parsed.host}:${parsed.port}`,
        status: 'syncing',
        lastSeen: Date.now(),
      };

      const finish = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(handshakeTimer);
        if (error) {
          this.peers.delete(peerState.id);
          socket.destroy();
          this.state.serviceStatus = this.peers.size > 0 ? 'online' : 'offline';
          this.state.statusMessage = error.message;
          this.emitState();
          reject(error);
          return;
        }
        resolve();
      };

      const handshakeTimer = setTimeout(() => {
        finish(new Error('配对码错误，或目标设备没有确认连接。'));
      }, fromPairingCode ? 3000 : 6500);

      socket.once('connect', () => {
        this.peers.set(peerId, peerState);
        const hello = {
          type: 'hello',
          device: {
            id: this.state.device.id,
            name: this.state.device.name,
            platform: this.state.device.platform,
            role: this.state.device.role,
          },
        };
        if (parsed.token) {
          hello.token = parsed.token;
        }
        if (parsed.pairingSecret) {
          hello.pairingSecret = parsed.pairingSecret;
        }
        this.writeToPeer(peerState, hello);
        this.state.statusMessage = '正在等待设备确认';
        this.emitState();
      });
      socket.on('data', async (chunk) => {
        peerState.buffer = Buffer.concat([peerState.buffer, chunk]);
        for (const message of parseFrames(peerState)) {
          await this.handleSocketMessage(peerState, message);
          if (message.type === 'welcome') {
            finish();
          }
        }
      });
      socket.on('close', () => {
        if (peerState.id) {
          this.peers.delete(peerState.id);
          this.state.statusMessage = this.peers.size > 0 ? '部分设备已断开' : '等待新设备连接';
          this.emitState();
        }
        if (!settled) {
          finish(new Error('配对码错误，或目标设备拒绝了连接。'));
        }
      });
      socket.once('error', (error) => {
        finish(new Error(`连接失败：${error.message}`));
      });
      socket.setTimeout(fromPairingCode ? 2500 : 6000, () => {
        finish(new Error('连接超时，请确认两台设备在同一局域网，且对方 ClipVault 已打开。'));
      });
      socket.connect({ host: parsed.host, port: parsed.port });
    });

    await this.persist();
    return this.getState();
  }

  async disconnectPeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.socket.destroy();
      this.peers.delete(peerId);
      this.state.statusMessage = '设备已断开';
      this.emitState();
      await this.persist();
    }
    return this.getState();
  }

  async disconnectAll() {
    for (const peer of this.peers.values()) {
      peer.socket.destroy();
    }
    this.peers.clear();
    this.state.statusMessage = '已断开全部设备';
    this.emitState();
    await this.persist();
    return this.getState();
  }

  async copyHistory(entryId) {
    const entry = this.state.history.find((item) => item.id === entryId);
    if (!entry) {
      return this.getState();
    }

    const copied = {
      ...entry,
      id: randomUUID(),
      createdAt: Date.now(),
      sourceDeviceId: this.state.device.id,
      sourceDeviceName: this.state.device.name,
      direction: 'outbound',
    };
    this.writeClipboard(copied);
    this.lastClipboardSignature = `${copied.mimeType === 'text/plain' ? 'text' : 'image'}:${copied.sha256}`;
    await this.publishClipboardEntry(copied, {
      routeId: randomUUID(),
      originPeerId: null,
      applyLocally: false,
    });
    return this.getState();
  }

  async deleteHistory(entryId) {
    this.state.history = this.state.history.filter((item) => item.id !== entryId);
    this.state.statusMessage = '已删除记录';
    this.emitState();
    await this.persist();
    return this.getState();
  }

  async clearHistory() {
    this.state.history = [];
    this.state.statusMessage = '历史记录已清空';
    this.emitState();
    await this.persist();
    return this.getState();
  }

  async updateSettings(patch) {
    this.state.settings = {
      ...this.state.settings,
      ...patch,
      serverPort: DEFAULT_SETTINGS.serverPort,
      historyLimit: clampHistoryLimit(patch.historyLimit ?? this.state.settings.historyLimit),
    };

    this.state.history = this.state.history.slice(0, this.state.settings.historyLimit);
    this.state.statusMessage = '设置已保存';
    await this.persist();
    this.emitState();
    await this.onSettingsChanged?.(this.state.settings);
    return this.getState();
  }

  async openPermissionGuide() {
    return;
  }
}
