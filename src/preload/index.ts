import { contextBridge, ipcRenderer } from 'electron'
import type { PiDesktopApi } from '@shared/api'
import type { BrowserBounds, BrowserState, CustomProviderEntry, PiRecord, PiSettings, Settings } from '@shared/types'

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: PiDesktopApi = {
  platform: process.platform,
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('app:update-settings', patch),
  updatePiSettings: (patch: PiSettings) => ipcRenderer.invoke('app:update-pi-settings', patch),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  pickFile: (options) => ipcRenderer.invoke('dialog:pick-file', options),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  deleteSession: (path: string) => ipcRenderer.invoke('sessions:delete', path),
  restoreSession: (trashPath: string, path: string) =>
    ipcRenderer.invoke('sessions:restore', trashPath, path),
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
  browserOpen: (url: string) => ipcRenderer.invoke('browser:open', url),
  browserNavigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
  browserBack: () => ipcRenderer.invoke('browser:back'),
  browserForward: () => ipcRenderer.invoke('browser:forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),
  browserStop: () => ipcRenderer.invoke('browser:stop'),
  browserClose: () => ipcRenderer.invoke('browser:close'),
  browserBounds: (bounds: BrowserBounds) => ipcRenderer.invoke('browser:bounds', bounds),
  browserVisible: (visible: boolean) => ipcRenderer.invoke('browser:visible', visible),
  onBrowserState: (callback: (state: BrowserState) => void) => subscribe('browser:state', callback),
  chromeProfiles: () => ipcRenderer.invoke('chrome:profiles'),
  chromePreview: (profileId: string) => ipcRenderer.invoke('chrome:preview', profileId),
  chromeImport: (profileId: string, domains: string[]) => ipcRenderer.invoke('chrome:import', profileId, domains),
  showItem: (path: string) => ipcRenderer.invoke('shell:show-item', path),
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
  notify: (payload) => ipcRenderer.invoke('notify:desktop', payload),
  pickSavePath: (options) => ipcRenderer.invoke('dialog:pick-save', options),
  writeTextFile: (path: string, content: string) =>
    ipcRenderer.invoke('fs:write-text', path, content),
  readDir: (path: string, options) => ipcRenderer.invoke('fs:read-dir', path, options),
  readText: (path: string, maxBytes?: number) =>
    ipcRenderer.invoke('fs:read-text', path, maxBytes),
  gitStatus: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
  gitDiff: (cwd: string, path: string, staged?: boolean) =>
    ipcRenderer.invoke('git:diff', cwd, path, staged),
  listSkills: (cwd: string) => ipcRenderer.invoke('skills:list', cwd),
  countSkills: (cwd: string) => ipcRenderer.invoke('skills:count', cwd),
  listConnectors: (cwd: string) => ipcRenderer.invoke('connectors:list', cwd),
  readSkill: (path: string) => ipcRenderer.invoke('skills:read', path),
  listPackages: (cwd: string) => ipcRenderer.invoke('packages:list', cwd),
  installPackage: (source, options) => ipcRenderer.invoke('packages:install', source, options),
  removePackage: (source, cwd) => ipcRenderer.invoke('packages:remove', source, cwd),
  updatePackage: (source, cwd) => ipcRenderer.invoke('packages:update', source, cwd),
  onPackageProgress: (callback) => subscribe('packages:progress', callback),
  listSchedules: () => ipcRenderer.invoke('schedules:list'),
  getSchedule: (id) => ipcRenderer.invoke('schedules:get', id),
  getSessionNotices: (sessionPath: string) => ipcRenderer.invoke('session:notices', sessionPath),
  usageSummary: (range: string) => ipcRenderer.invoke('usage:summary', range),
  createSchedule: (input) => ipcRenderer.invoke('schedules:create', input),
  updateSchedule: (id, patch) => ipcRenderer.invoke('schedules:update', id, patch),
  deleteSchedule: (id) => ipcRenderer.invoke('schedules:delete', id),
  setScheduleEnabled: (id, enabled) => ipcRenderer.invoke('schedules:set-enabled', id, enabled),
  runScheduleNow: (id) => ipcRenderer.invoke('schedules:run-now', id),
  previewSchedule: (cadence, count, timezone) => ipcRenderer.invoke('schedules:preview', cadence, count, timezone),
  validateCron: (expression) => ipcRenderer.invoke('schedules:validate-cron', expression),
  getBackgroundScheduler: () => ipcRenderer.invoke('scheduler:background-status'),
  setBackgroundScheduler: (enabled) => ipcRenderer.invoke('scheduler:set-background', enabled),
  onSchedulesChanged: (callback) => subscribe('schedules:changed', callback),
  onScheduleEvent: (callback) => subscribe('schedules:event', callback),
  onScheduleOpen: (callback) => subscribe('schedules:open', callback),
  onRecord: (callback: (record: PiRecord) => void) => subscribe('pi:record', callback),
  onStatus: (callback) => subscribe('pi:status', callback),
  onStderr: (callback) => subscribe('pi:stderr', callback),
  onAppEvent: (callback) => subscribe('app:event', callback),
  onSettings: (callback) => subscribe('app:settings', callback)
}

contextBridge.exposeInMainWorld('pi', api)
