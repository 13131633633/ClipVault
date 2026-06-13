const { contextBridge, ipcRenderer } = require('electron');

const stateListeners = new Set();

ipcRenderer.on('clipvault:state-changed', (_event, state) => {
  stateListeners.forEach((listener) => listener(state));
});

contextBridge.exposeInMainWorld('clipVaultDesktop', {
  start: () => ipcRenderer.invoke('clipvault:start'),
  getState: () => ipcRenderer.invoke('clipvault:get-state'),
  refreshPairing: () => ipcRenderer.invoke('clipvault:refresh-pairing'),
  connectWithPayload: (payload) => ipcRenderer.invoke('clipvault:connect', payload),
  disconnectPeer: (peerId) => ipcRenderer.invoke('clipvault:disconnect-peer', peerId),
  disconnectAll: () => ipcRenderer.invoke('clipvault:disconnect-all'),
  copyHistory: (entryId) => ipcRenderer.invoke('clipvault:copy-history', entryId),
  deleteHistory: (entryId) => ipcRenderer.invoke('clipvault:delete-history', entryId),
  clearHistory: () => ipcRenderer.invoke('clipvault:clear-history'),
  updateSettings: (patch) => ipcRenderer.invoke('clipvault:update-settings', patch),
  openPermissionGuide: () => ipcRenderer.invoke('clipvault:open-permission-guide'),
  onStateChanged: (listener) => {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  },
});
