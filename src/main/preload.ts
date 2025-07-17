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
  getTotalNotificationCount: (options?: any) => ipcRenderer.invoke('get-total-notification-count', options),
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
  
  // 위버스 로그인/로그아웃 및 아티스트 관리
  weverseLogin: () => ipcRenderer.invoke('weverse-login'),
  weverseLogout: () => ipcRenderer.invoke('weverse-logout'),
  getWeverseArtists: () => ipcRenderer.invoke('get-weverse-artists'),
  updateWeverseArtist: (data: { artistName: string; isEnabled: boolean }) => ipcRenderer.invoke('update-weverse-artist', data),
  refreshWeverseArtists: () => ipcRenderer.invoke('refresh-weverse-artists'),

  // 유틸리티
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  showTrayMenu: () => ipcRenderer.invoke('show-tray-menu'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  
  // 카페 모니터링 상태 초기화
  clearCafeStates: () => ipcRenderer.invoke('clear-cafe-states'),

  // 스트리머 검색
  searchStreamer: (name: string) => ipcRenderer.invoke('search-streamer', name),
  parseStreamerUrl: (url: string) => ipcRenderer.invoke('parse-streamer-url', url),

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
  getAppVersion: () => {
    try {
      return require('../../package.json').version;
    } catch {
      return '2.1.0';
    }
  },
  getPlatform: () => process.platform,
  
  // 개발 환경 감지
  isDev: () => process.env.NODE_ENV === 'development',
  
  // 자동 시작 디버깅
  getAutoStartDebug: () => ipcRenderer.invoke('get-auto-start-debug'),
  
  // 위버스 데이터 클리어 (개발자 콘솔용)
  clearWeverseData: () => ipcRenderer.invoke('clear-weverse-data'),
  clearWeverseArtists: () => ipcRenderer.invoke('clear-weverse-artists'),
  resetWeverseNotifications: () => ipcRenderer.invoke('reset-weverse-notifications'),
  diagnosticWeverseDatabase: () => ipcRenderer.invoke('diagnostic-weverse-database')
};

// Context Bridge를 통해 안전하게 API 노출
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// 개발자 콘솔 명령어 추가 (프로덕션 환경에서도 사용 가능)
contextBridge.exposeInMainWorld('clearWeverseData', async () => {
  console.log('🧹 위버스 알림 데이터 클리어 중...');
  try {
    const result = await electronAPI.clearWeverseData();
    if (result.success) {
      console.log('✅ 위버스 알림 데이터 클리어 완료');
    } else {
      console.error('❌ 위버스 알림 데이터 클리어 실패:', result.error);
    }
    return result;
  } catch (error) {
    console.error('❌ 위버스 알림 데이터 클리어 실패:', error);
    return { success: false, error: String(error) };
  }
});

contextBridge.exposeInMainWorld('clearWeverseArtists', async () => {
  console.log('🧹 위버스 아티스트 데이터 클리어 중...');
  try {
    const result = await electronAPI.clearWeverseArtists();
    if (result.success) {
      console.log('✅ 위버스 아티스트 데이터 클리어 완료');
    } else {
      console.error('❌ 위버스 아티스트 데이터 클리어 실패:', result.error);
    }
    return result;
  } catch (error) {
    console.error('❌ 위버스 아티스트 데이터 클리어 실패:', error);
    return { success: false, error: String(error) };
  }
});

contextBridge.exposeInMainWorld('resetWeverseNotifications', async () => {
  console.log('🔄 위버스 알림을 live 타입으로 변경 중...');
  try {
    const result = await electronAPI.resetWeverseNotifications();
    if (result.success) {
      console.log('✅ 위버스 알림 타입 변경 완료');
    } else {
      console.error('❌ 위버스 알림 타입 변경 실패:', result.error);
    }
    return result;
  } catch (error) {
    console.error('❌ 위버스 알림 타입 변경 실패:', error);
    return { success: false, error: String(error) };
  }
});

// 위버스 아티스트 데이터베이스 검증 명령어 추가
contextBridge.exposeInMainWorld('debugWeverseArtists', async () => {
  console.log('🔍 위버스 아티스트 데이터베이스 상태 확인 중...');
  try {
    const artists = await electronAPI.getWeverseArtists();
    console.log('📊 위버스 아티스트 목록:', artists);
    return artists;
  } catch (error) {
    console.error('❌ 위버스 아티스트 데이터 조회 실패:', error);
    return { success: false, error: String(error) };
  }
});

// 위버스 데이터베이스 진단 도구
contextBridge.exposeInMainWorld('diagnosticWeverseDatabase', async () => {
  console.log('🔍 위버스 데이터베이스 진단 중...');
  try {
    const result = await electronAPI.diagnosticWeverseDatabase();
    if (result.success) {
      console.log('📊 진단 결과:', result.data);
      console.log('📊 weverse_artists 테이블:', result.data.weverseArtistsTable);
      console.log('📊 FOREIGN KEY 상태:', result.data.foreignKeyStatus);
      console.log('📊 데이터베이스 무결성:', result.data.integrityCheck);
    } else {
      console.error('❌ 진단 실패:', result.error);
    }
    return result;
  } catch (error) {
    console.error('❌ 위버스 데이터베이스 진단 실패:', error);
    return { success: false, error: String(error) };
  }
});

// TypeScript 타입 선언 (renderer 프로세스에서 사용)
declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}