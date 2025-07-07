// 공유 타입 정의

export interface StreamerData {
  id: number;
  name: string;
  chzzkId?: string;
  twitterUsername?: string;
  naverCafeUserId?: string;
  cafeClubId: string;
  profileImageUrl?: string;
  isActive: boolean;
  notifications: {
    chzzk: boolean;
    cafe: boolean;
    twitter: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface NotificationSettings {
  id: number;
  streamerId: number;
  platform: 'chzzk' | 'cafe' | 'twitter';
  enabled: boolean;
}

export interface NotificationRecord {
  id: number;
  streamerId: number;
  type: 'live' | 'cafe' | 'twitter' | 'system';
  title: string;
  content?: string;
  url: string;
  uniqueKey: string;
  profileImageUrl?: string;
  isRead: boolean;
  createdAt: string;
}

export interface AppSettings {
  key: string;
  value: string;
  updatedAt: string;
}

export interface MonitoringStatus {
  id: number;
  lastCheckTime: string;
  isMonitoring: boolean;
  lastRecoveryTime?: string;
}

export interface LiveStatus {
  streamerId: number;
  streamerName: string;
  isLive: boolean;
  title?: string;
  url?: string;
  thumbnailUrl?: string;
}

export interface NotificationData {
  type: 'live' | 'cafe' | 'twitter' | 'system';
  streamerName: string;
  title: string;
  content?: string;
  url?: string;
  profileImageUrl?: string;
  uniqueKey: string;
}

export interface CafePost {
  id: string;
  title: string;
  url: string;
  author: string;
  timestamp: string;
}

export interface TwitterTweet {
  id: string;
  content: string;
  url: string;
  timestamp: string;
}

// IPC 통신 이벤트 타입
export interface IpcEvents {
  // Main → Renderer
  'streamer-data-updated': StreamerData[];
  'notification-received': NotificationData;
  'notification-history-updated': NotificationRecord[];
  'live-status-updated': LiveStatus[];
  'monitoring-status-changed': boolean;
  'settings-updated': Record<string, any>;
  
  // Renderer → Main
  'get-streamers': void;
  'add-streamer': Omit<StreamerData, 'id' | 'createdAt' | 'updatedAt'>;
  'update-streamer': StreamerData;
  'delete-streamer': number;
  'get-notifications': { limit?: number; type?: string };
  'delete-all-notifications': void;
  'mark-notification-read': number;
  'mark-all-notifications-read': void;
  'get-unread-count': void;
  'test-notification': void;
  'recover-missed-notifications': void;
  'get-settings': void;
  'update-setting': { key: string; value: any };
  'start-monitoring': void;
  'stop-monitoring': void;
  'naver-login': void;
  'naver-logout': void;
  'get-live-status': void;
  'open-external': string;
  'show-tray-menu': void;
  'quit-app': void;
}

// 설정 키 타입
export type SettingKey = 
  | 'checkInterval'
  | 'autoStart'
  | 'minimizeToTray'
  | 'showDesktopNotifications'
  | 'cacheCleanupInterval'
  | 'theme'
  | 'needNaverLogin';

// 알림 설정 컨텍스트
export interface NotificationConfig {
  chzzk: boolean;
  cafe: boolean;
  twitter: boolean;
}

// 모니터링 통계
export interface MonitoringStats {
  totalStreamers: number;
  activeStreamers: number;
  liveStreamers: number;
  totalNotifications: number;
  unreadNotifications: number;
  lastCheckTime?: string;
  isMonitoring: boolean;
}