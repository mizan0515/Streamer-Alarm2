import { contextBridge, ipcRenderer } from 'electron';
import { IpcEvents } from '@shared/types';

// IPC API를 안전하게 renderer 프로세스에 노출
const electronAPI = {
  // 스트리머 관련
  getStreamers: () => ipcRenderer.invoke('get-streamers'),
  addStreamer: (streamerData: any) => ipcRenderer.invoke('add-streamer', streamerData),
  updateStreamer: (streamerData: any) => ipcRenderer.invoke('update-streamer', streamerData),
  deleteStreamer: (streamerId: number) => ipcRenderer.invoke('delete-streamer', streamerId),

  // 알림 관련
  getNotifications: (options?: any) => ipcRenderer.invoke('get-notifications', options),
  deleteAllNotifications: () => ipcRenderer.invoke('delete-all-notifications'),
  markNotificationRead: (notificationId: number) => ipcRenderer.invoke('mark-notification-read', notificationId),
  markAllNotificationsRead: () => ipcRenderer.invoke('mark-all-notifications-read'),
  getUnreadCount: () => ipcRenderer.invoke('get-unread-count'),
  testNotification: () => ipcRenderer.invoke('test-notification'),
  recoverMissedNotifications: () => ipcRenderer.invoke('recover-missed-notifications'),

  // 설정 관련
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSetting: (key: string, value: any) => ipcRenderer.invoke('update-setting', { key, value }),

  // 모니터링 관련
  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  getLiveStatus: () => ipcRenderer.invoke('get-live-status'),
  getMonitoringStatus: () => ipcRenderer.invoke('get-monitoring-status'),

  // 네이버 로그인/로그아웃
  naverLogin: () => ipcRenderer.invoke('naver-login'),
  naverLogout: () => ipcRenderer.invoke('naver-logout'),

  // 유틸리티
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  showTrayMenu: () => ipcRenderer.invoke('show-tray-menu'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  
  // 카페 모니터링 상태 초기화
  clearCafeStates: () => ipcRenderer.invoke('clear-cafe-states'),

  // 이벤트 리스너
  onStreamerDataUpdated: (callback: (streamers: any[]) => void) => {
    ipcRenderer.on('streamer-data-updated', (_, streamers) => callback(streamers));
  },
  onNotificationReceived: (callback: (notification: any) => void) => {
    ipcRenderer.on('notification-received', (_, notification) => callback(notification));
  },
  onLiveStatusUpdated: (callback: (liveStatus: any[]) => void) => {
    ipcRenderer.on('live-status-updated', (_, liveStatus) => callback(liveStatus));
  },
  onMonitoringStatusChanged: (callback: (isMonitoring: boolean) => void) => {
    ipcRenderer.on('monitoring-status-changed', (_, isMonitoring) => callback(isMonitoring));
  },
  onSettingsUpdated: (callback: (settings: Record<string, any>) => void) => {
    ipcRenderer.on('settings-updated', (_, settings) => callback(settings));
  },
  onNaverLoginStatusChanged: (callback: (status: { needLogin: boolean }) => void) => {
    ipcRenderer.on('naver-login-status-changed', (_, status) => callback(status));
  },

  // 일반적인 이벤트 리스너 메서드
  on: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_, ...args) => callback(...args));
  },
  
  // 이벤트 리스너 해제
  removeListener: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },
  
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // 앱 정보
  getAppVersion: () => process.env.npm_package_version || '2.0.0',
  getPlatform: () => process.platform,
  
  // 개발 환경 감지
  isDev: () => process.env.NODE_ENV === 'development'
};

// Context Bridge를 통해 안전하게 API 노출
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// TypeScript 타입 선언 (renderer 프로세스에서 사용)
declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}