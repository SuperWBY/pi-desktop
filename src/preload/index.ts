import { contextBridge, ipcRenderer } from 'electron'
import type { PiDesktopApi } from '@shared/api'
import type { CustomProviderEntry, PiRecord, PiSettings, Settings } from '@shared/types'

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: PiDesktopApi = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('app:update-settings', patch),
  updatePiSettings: (patch: PiSettings) => ipcRenderer.invoke('app:update-pi-settings', patch),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  pickFile: (options) => ipcRenderer.invoke('dialog:pick-file', options),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  deleteSession: (path: string) => ipcRenderer.invoke('sessions:delete', path),
  readModelsConfig: () => ipcRenderer.invoke('models:read'),
  saveProvider: (id: string, entry: CustomProviderEntry) =>
    ipcRenderer.invoke('models:save-provider', id, entry),
  removeProvider: (id: string) => ipcRenderer.invoke('models:remove-provider', id),
  listPiModels: () => ipcRenderer.invoke('models:list'),
  refreshModelCatalog: () => ipcRenderer.invoke('models:refresh-catalog'),
  openSession: (options) => ipcRenderer.invoke('session:open', options),
  closeSession: () => ipcRenderer.invoke('session:close'),
  command: (command, timeoutMs) => ipcRenderer.invoke('pi:command', command, timeoutMs),
  uiResponse: (response) => ipcRenderer.send('pi:ui-response', response),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  showItem: (path: string) => ipcRenderer.invoke('shell:show-item', path),
  onRecord: (callback: (record: PiRecord) => void) => subscribe('pi:record', callback),
  onStatus: (callback) => subscribe('pi:status', callback),
  onStderr: (callback) => subscribe('pi:stderr', callback),
  onAppEvent: (callback) => subscribe('app:event', callback),
  onSettings: (callback) => subscribe('app:settings', callback)
}

contextBridge.exposeInMainWorld('pi', api)
