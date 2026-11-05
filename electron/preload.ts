import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../src/shared/contracts';

const api: DesktopApi = {
  selectFolder: () => ipcRenderer.invoke('folder:select'),
  scanFolder: () => ipcRenderer.invoke('folder:scan'),
  previewRename: (selectedPaths) => ipcRenderer.invoke('rename:preview', selectedPaths),
  executeRename: (selectedPaths) => ipcRenderer.invoke('rename:execute', selectedPaths),
  listHistory: () => ipcRenderer.invoke('history:list'),
  listUnverified: () => ipcRenderer.invoke('unverified:list'),
  restoreHistory: (id) => ipcRenderer.invoke('history:restore', id),
};

contextBridge.exposeInMainWorld('nameBack', api);