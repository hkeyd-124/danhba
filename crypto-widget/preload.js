'use strict';
/**
 * Preload bridge. The renderer gets a narrow, explicit API — never `require`,
 * never `ipcRenderer`, never a network primitive.
 */
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('cpw', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveTrade: (t) => ipcRenderer.invoke('save-trade', t),
  deleteTrade: (id) => ipcRenderer.invoke('delete-trade', id),
  saveAlert: (a) => ipcRenderer.invoke('save-alert', a),
  deleteAlert: (id) => ipcRenderer.invoke('delete-alert', id),
  toggleAlert: (id, enabled) => ipcRenderer.invoke('toggle-alert', { id, enabled }),
  testAlert: () => ipcRenderer.invoke('test-alert'),
  patchSettings: (p) => ipcRenderer.invoke('patch-settings', p),
  window: (action) => ipcRenderer.invoke('window', action),
  blurGuard: (on) => ipcRenderer.invoke('blur-guard', on),
  // test-only; the main process registers these only when CPW_TEST=1
  testBlur: () => ipcRenderer.invoke('test-blur'),
  testGeometry: () => ipcRenderer.invoke('test-geometry'),
  testResize: (opts) => ipcRenderer.invoke('test-resize', opts),
  resizeStart: (edge) => ipcRenderer.invoke('resize-start', edge),
  resizeEnd: () => ipcRenderer.invoke('resize-end'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),

  onState: (cb) => on('state', cb),
  onPrices: (cb) => on('prices', cb),
  onHistory: (cb) => on('history', cb),
  onKlines: (cb) => on('klines', cb),
  onFeedStatus: (cb) => on('feed-status', cb),
  onCollapsed: (cb) => on('collapsed', cb),
  onAlertFired: (cb) => on('alert-fired', cb),
});
