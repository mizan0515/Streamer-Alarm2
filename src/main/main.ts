import { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import { DatabaseManager } from './services/DatabaseManager';
import { MonitoringService } from './services/MonitoringService';
import { NotificationService } from './services/NotificationService';
import { TrayService } from './services/TrayService';
import { SettingsService } from './services/SettingsService';
import { StreamerSearchService } from './services/StreamerSearchService';
import { IpcEvents } from '@shared/types';

class StreamerAlarmApp {
  private mainWindow: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private databaseManager: DatabaseManager;
  private monitoringService: MonitoringService;
  private notificationService: NotificationService;
  private trayService: TrayService;
  private settingsService: SettingsService;
  private streamerSearchService: StreamerSearchService;
  private isDev: boolean;

  constructor() {
    this.isDev = process.env.NODE_ENV === 'development';
    
    // 서비스 초기화
    this.databaseManager = new DatabaseManager();
    this.settingsService = new SettingsService(this.databaseManager);
    this.notificationService = new NotificationService(this.databaseManager);
    this.monitoringService = new MonitoringService(
      this.databaseManager,
      this.notificationService
    );
    this.trayService = new TrayService(this);
    this.streamerSearchService = new StreamerSearchService();
  }

  async initialize(): Promise<void> {
    console.log('Starting app initialization...');
    
    // 🚨 중복 실행 방지 (Single Instance Lock)
    const gotTheLock = app.requestSingleInstanceLock();
    
    if (!gotTheLock) {
      console.log('⚠️ Application is already running. Exiting...');
      app.quit();
      return;
    }
    
    // 두 번째 인스턴스 실행 시 기존 창을 활성화
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      console.log('🔄 Second instance detected, showing existing window');
      if (this.mainWindow) {
        if (this.mainWindow.isMinimized()) {
          this.mainWindow.restore();
        }
        this.mainWindow.focus();
        this.mainWindow.show();
      }
    });
    
    // 앱 준비 대기
    await app.whenReady();
    console.log('Electron app ready (Single Instance)');

    // 데이터베이스 초기화
    try {
      await this.databaseManager.initialize();
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Database initialization failed:', error);
      // 데이터베이스 실패 시에도 앱 계속 실행
    }

    // 기존 데이터 마이그레이션 (필요한 경우)
    await this.migrateExistingData();

    // 메인 윈도우 생성
    try {
      this.createMainWindow();
      console.log('Main window created successfully');
      
      // 설정 서비스에 메인 윈도우 전달
      if (this.mainWindow) {
        this.settingsService.setMainWindow(this.mainWindow);
      }
      
      // 설정 서비스에 트레이 서비스 전달
      this.settingsService.setTrayService(this.trayService);
    } catch (error) {
      console.error('Main window creation failed:', error);
      throw error; // 메인 창 생성 실패는 치명적이므로 앱 종료
    }

    // 시스템 트레이 설정
    try {
      this.setupTray();
      // TrayService에 MonitoringService 전달
      this.trayService.setMonitoringService(this.monitoringService);
      
      // MonitoringService에 TrayService 전달 (양방향 참조)
      this.monitoringService.setTrayService(this.trayService);
      
      // 초기화 완료 후 트레이 메뉴 상태 동기화
      setTimeout(async () => {
        try {
          const needNaverLogin = await this.monitoringService.checkNaverLoginStatus();
          const stats = await this.monitoringService.getMonitoringStats();
          this.trayService.updateContextMenu({
            ...stats,
            needNaverLogin: needNaverLogin
          });
          console.log('🔄 Initial tray menu sync completed');
        } catch (error) {
          console.error('Failed to sync initial tray menu:', error);
        }
      }, 5000); // 5초 후 동기화 (초기화 완료 후)
      
      console.log('Tray setup successfully');
    } catch (error) {
      console.error('Tray setup failed:', error);
      // 트레이 실패 시에도 앱 계속 실행
    }

    // IPC 핸들러 설정
    this.setupIpcHandlers();

    // 알림 서비스 중복 체크 초기화 (모니터링 서비스 시작 전)
    try {
      await this.notificationService.initializeDuplicateCheck();
      console.log('Notification service duplicate check initialized successfully');
    } catch (error) {
      console.error('Notification service duplicate check initialization failed:', error);
      // 초기화 실패 시에도 앱 계속 실행
    }

    // 모니터링 서비스 시작
    try {
      await this.monitoringService.start();
      console.log('Monitoring service started successfully');
    } catch (error) {
      console.error('Monitoring service failed to start:', error);
      // 모니터링 실패 시에도 앱 계속 실행
    }

    // 자동 시작 설정 확인
    await this.checkAutoStart();
  }

  private createMainWindow(): void {
    console.log('Creating main window...');
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
      icon: path.join(__dirname, '../../assets/icon.png'),
      title: 'Streamer Alarm System',
      show: true, // 시작 시 표시
    });

    // 개발/프로덕션 환경에 따른 URL 로드
    if (this.isDev) {
      this.mainWindow.loadURL('http://localhost:3000');
      this.mainWindow.webContents.openDevTools();
    } else {
      this.mainWindow.loadFile(path.join(__dirname, 'index.html'));
    }

    // 윈도우 이벤트 핸들링
    this.mainWindow.on('ready-to-show', () => {
      if (this.mainWindow) {
        // 기본적으로 창을 표시 (숨김 플래그가 없는 한)
        if (!this.shouldStartMinimized()) {
          this.mainWindow.show();
          this.mainWindow.focus();
        }
      }
    });

    this.mainWindow.on('close', (event) => {
      if (this.shouldMinimizeToTray()) {
        event.preventDefault();
        this.mainWindow?.hide();
      }
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  private setupTray(): void {
    this.tray = this.trayService.createTray();
  }

  private setupIpcHandlers(): void {
    // 스트리머 관련 IPC
    ipcMain.handle('get-streamers', async () => {
      console.log('🎯 IPC: get-streamers received');
      try {
        const result = await this.databaseManager.getStreamers();
        console.log('✅ IPC: get-streamers success, count:', result.length);
        return result;
      } catch (error) {
        console.error('❌ IPC: get-streamers failed:', error);
        throw error;
      }
    });

    ipcMain.handle('add-streamer', async (_, streamerData) => {
      console.log('🎯 IPC: add-streamer received:', streamerData);
      try {
        // 스트리머 추가
        const result = await this.databaseManager.addStreamer(streamerData);
        console.log('✅ IPC: add-streamer success:', result);
        
        // CHZZK ID가 있으면 프로필 이미지 자동 가져오기
        if (result.chzzkId) {
          console.log('🖼️ Fetching profile image for:', result.name);
          try {
            const profileImageUrl = await this.monitoringService.chzzkMonitor.getProfileImage(result.chzzkId);
            if (profileImageUrl && profileImageUrl !== result.profileImageUrl) {
              const updatedStreamer = { ...result, profileImageUrl };
              await this.databaseManager.updateStreamer(updatedStreamer);
              console.log('✅ Profile image updated for:', result.name);
              return updatedStreamer;
            }
          } catch (profileError) {
            console.warn('⚠️ Failed to fetch profile image:', profileError);
            // 프로필 이미지 실패해도 스트리머 추가는 성공
          }
        }
        
        return result;
      } catch (error) {
        console.error('❌ IPC: add-streamer failed:', error);
        throw error;
      }
    });

    ipcMain.handle('update-streamer', async (_, streamerData) => {
      console.log('🎯 IPC: update-streamer received:', streamerData.name);
      try {
        // 스트리머 업데이트
        const result = await this.databaseManager.updateStreamer(streamerData);
        console.log('✅ IPC: update-streamer success:', result.name);
        
        // CHZZK ID가 변경되었거나 프로필 이미지가 없으면 새로 가져오기
        if (result.chzzkId && (!result.profileImageUrl || result.chzzkId !== streamerData.chzzkId)) {
          console.log('🖼️ Updating profile image for:', result.name);
          try {
            const profileImageUrl = await this.monitoringService.chzzkMonitor.getProfileImage(result.chzzkId);
            if (profileImageUrl && profileImageUrl !== result.profileImageUrl) {
              const updatedStreamer = { ...result, profileImageUrl };
              await this.databaseManager.updateStreamer(updatedStreamer);
              console.log('✅ Profile image updated for:', result.name);
              return updatedStreamer;
            }
          } catch (profileError) {
            console.warn('⚠️ Failed to update profile image:', profileError);
            // 프로필 이미지 실패해도 업데이트는 성공
          }
        }
        
        return result;
      } catch (error) {
        console.error('❌ IPC: update-streamer failed:', error);
        throw error;
      }
    });

    ipcMain.handle('delete-streamer', async (_, streamerId: number) => {
      return await this.databaseManager.deleteStreamer(streamerId);
    });

    // 알림 관련 IPC
    ipcMain.handle('get-notifications', async (_, options) => {
      return await this.databaseManager.getNotifications(options);
    });

    ipcMain.handle('get-total-notification-count', async (_, options) => {
      return await this.databaseManager.getTotalNotificationCount(options);
    });

    ipcMain.handle('delete-all-notifications', async () => {
      await this.databaseManager.deleteAllNotifications();
      
      // UI 업데이트를 위해 메인 윈도우에 빈 알림 목록 전송
      const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed());
      if (mainWindow) {
        mainWindow.webContents.send('notification-history-updated', []);
      }
      
      return true;
    });

    ipcMain.handle('mark-notification-read', async (_, notificationId: number) => {
      await this.databaseManager.markNotificationAsRead(notificationId);
      
      // UI 업데이트를 위해 메인 윈도우에 업데이트된 알림 목록 전송
      const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed());
      if (mainWindow) {
        const notifications = await this.databaseManager.getNotifications({ limit: 100 });
        mainWindow.webContents.send('notification-history-updated', notifications);
      }
      
      return true;
    });

    ipcMain.handle('mark-all-notifications-read', async () => {
      await this.databaseManager.markAllNotificationsAsRead();
      
      // UI 업데이트를 위해 메인 윈도우에 업데이트된 알림 목록 전송
      const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed());
      if (mainWindow) {
        const notifications = await this.databaseManager.getNotifications({ limit: 100 });
        mainWindow.webContents.send('notification-history-updated', notifications);
      }
      
      return true;
    });

    ipcMain.handle('get-unread-count', async () => {
      return await this.databaseManager.getUnreadNotificationCount();
    });

    ipcMain.handle('test-notification', async () => {
      return await this.notificationService.sendTestNotification();
    });

    ipcMain.handle('recover-missed-notifications', async () => {
      return await this.monitoringService.recoverMissedNotifications();
    });

    // 설정 관련 IPC
    ipcMain.handle('get-settings', async () => {
      const settings = await this.settingsService.getAllSettings();
      
      // 시스템의 실제 자동 시작 상태도 함께 반환
      const systemAutoStart = this.settingsService.isAutoStartEnabled();
      
      return {
        ...settings,
        autoStart: systemAutoStart // 시스템 상태로 덮어쓰기
      };
    });

    ipcMain.handle('update-setting', async (_, { key, value }) => {
      console.log(`🔧 IPC: Updating setting ${key} to ${value}`);
      await this.settingsService.updateSetting(key, value);
      
      // 자동 시작 설정이 변경된 경우 즉시 동기화
      if (key === 'autoStart') {
        console.log('🚀 Auto-start setting changed, syncing...');
        const systemEnabled = this.settingsService.isAutoStartEnabled();
        console.log(`System auto-start status after update: ${systemEnabled}`);
      }
      
      return true;
    });

    // 모니터링 관련 IPC
    ipcMain.handle('start-monitoring', async () => {
      return await this.monitoringService.start();
    });

    ipcMain.handle('stop-monitoring', async () => {
      return await this.monitoringService.stop();
    });

    ipcMain.handle('get-live-status', async () => {
      return await this.monitoringService.getLiveStatus();
    });

    ipcMain.handle('get-monitoring-status', async () => {
      return this.monitoringService.isMonitoring();
    });

    // 네이버 로그인/로그아웃 IPC
    ipcMain.handle('naver-login', async () => {
      return await this.monitoringService.initiateNaverLogin();
    });

    ipcMain.handle('naver-logout', async () => {
      return await this.monitoringService.initiateNaverLogout();
    });

    // 위버스 관련 IPC
    ipcMain.handle('weverse-login', async () => {
      return await this.monitoringService.initiateWeverseLogin();
    });

    ipcMain.handle('weverse-logout', async () => {
      return await this.monitoringService.initiateWeverseLogout();
    });

    ipcMain.handle('get-weverse-artists', async () => {
      return await this.monitoringService.getWeverseArtists();
    });

    ipcMain.handle('update-weverse-artist', async (_, data: { artistName: string; isEnabled: boolean }) => {
      await this.monitoringService.updateWeverseArtistStatus(data.artistName, data.isEnabled);
      
      // 업데이트된 아티스트 목록을 모든 창에 브로드캐스트
      const artists = await this.monitoringService.getWeverseArtists();
      this.broadcastToAll('weverse-artists-updated', artists);
      
      return true;
    });

    ipcMain.handle('refresh-weverse-artists', async () => {
      await this.monitoringService.refreshWeverseArtists();
      
      // 업데이트된 아티스트 목록을 모든 창에 브로드캐스트
      const artists = await this.monitoringService.getWeverseArtists();
      this.broadcastToAll('weverse-artists-updated', artists);
      
      return true;
    });

    // 유틸리티 IPC
    ipcMain.handle('open-external', async (_, url: string) => {
      return await shell.openExternal(url);
    });

    ipcMain.handle('show-tray-menu', async () => {
      this.trayService.showContextMenu();
    });

    ipcMain.handle('quit-app', async () => {
      this.quit();
    });

    // 자동 시작 디버깅용 IPC
    ipcMain.handle('get-auto-start-debug', async () => {
      try {
        const settings = app.getLoginItemSettings();
        const dbAutoStart = this.settingsService.getAutoStart();
        const systemAutoStart = this.settingsService.isAutoStartEnabled();
        
        return {
          systemSettings: settings,
          dbAutoStart: dbAutoStart,
          systemAutoStart: systemAutoStart,
          execPath: process.execPath,
          platform: process.platform,
          isDev: process.env.NODE_ENV === 'development',
          args: process.argv
        };
      } catch (error) {
        console.error('Failed to get auto-start debug info:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    });

    // 위버스 데이터 클리어 IPC (개발자 콘솔용)
    ipcMain.handle('clear-weverse-data', async () => {
      try {
        console.log('🧹 [DEV] Clearing weverse notification data...');
        await this.databaseManager.clearWeverseNotifications();
        console.log('✅ [DEV] Weverse notification data cleared');
        return { success: true };
      } catch (error) {
        console.error('❌ [DEV] Failed to clear weverse data:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    ipcMain.handle('clear-weverse-artists', async () => {
      try {
        console.log('🧹 [DEV] Clearing weverse artists data...');
        await this.databaseManager.clearWeverseArtists();
        console.log('✅ [DEV] Weverse artists data cleared');
        return { success: true };
      } catch (error) {
        console.error('❌ [DEV] Failed to clear weverse artists:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    ipcMain.handle('reset-weverse-notifications', async () => {
      try {
        console.log('🔄 [DEV] Resetting weverse notifications to live type...');
        await this.databaseManager.resetWeverseNotificationsToLive();
        console.log('✅ [DEV] Weverse notifications reset to live type');
        return { success: true };
      } catch (error) {
        console.error('❌ [DEV] Failed to reset weverse notifications:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    ipcMain.handle('diagnostic-weverse-database', async () => {
      try {
        console.log('🔍 [DEV] Starting Weverse database diagnostic...');
        const result = await this.databaseManager.diagnosticWeverseDatabase();
        console.log('✅ [DEV] Weverse database diagnostic completed');
        return { success: true, data: result };
      } catch (error) {
        console.error('❌ [DEV] Failed to run database diagnostic:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    // 스트리머 검색 IPC
    ipcMain.handle('search-streamer', async (_, name: string) => {
      console.log('🔍 IPC: search-streamer received for:', name);
      try {
        const result = await this.streamerSearchService.searchStreamer(name);
        console.log('✅ IPC: search-streamer success:', {
          chzzk: result.chzzk.length,
          twitter: result.twitter.length,
          cafe: result.cafe.length
        });
        return result;
      } catch (error) {
        console.error('❌ IPC: search-streamer failed:', error);
        throw error;
      }
    });

    ipcMain.handle('parse-streamer-url', async (_, url: string) => {
      console.log('🔗 IPC: parse-streamer-url received:', url);
      try {
        const result = StreamerSearchService.parseUrl(url);
        console.log('✅ IPC: parse-streamer-url result:', result);
        return result;
      } catch (error) {
        console.error('❌ IPC: parse-streamer-url failed:', error);
        throw error;
      }
    });

    // 카페 모니터링 상태 초기화 IPC
    ipcMain.handle('clear-cafe-states', async () => {
      try {
        await this.databaseManager.clearCafeMonitorStates();
        // 메모리 캐시도 함께 초기화
        this.monitoringService.clearCafeMemoryCache();
        return { success: true, message: '카페 모니터링 상태가 초기화되었습니다.' };
      } catch (error) {
        console.error('Failed to clear cafe monitor states:', error);
        return { success: false, message: '카페 모니터링 상태 초기화에 실패했습니다.' };
      }
    });

    // 트레이 네이버 로그인/로그아웃은 TrayService에서 직접 처리
    
    // 네이버 로그인 상태 변경 시 트레이 메뉴 업데이트
    this.mainWindow?.webContents.on('ipc-message', (event, channel, data) => {
      if (channel === 'update-tray-menu') {
        this.updateTrayMenuWithStatus(data);
      }
    });
  }

  private async migrateExistingData(): Promise<void> {
    try {
      // 기존 JSON 파일들이 있는지 확인하고 마이그레이션
      const dataDir = path.join(__dirname, '../../data');
      const streamersFile = path.join(dataDir, 'streamers.json');
      const notificationsFile = path.join(dataDir, 'notifications.json');
      const settingsFile = path.join(dataDir, 'settings.json');

      const fs = require('fs').promises;

      // 스트리머 데이터 마이그레이션
      try {
        const streamersData = await fs.readFile(streamersFile, 'utf8');
        const streamers = JSON.parse(streamersData);
        await this.databaseManager.migrateStreamers(streamers);
        console.log('Streamers data migrated successfully');
      } catch (error) {
        console.log('No existing streamers data to migrate');
      }

      // 알림 데이터 마이그레이션
      try {
        const notificationsData = await fs.readFile(notificationsFile, 'utf8');
        const notifications = JSON.parse(notificationsData);
        await this.databaseManager.migrateNotifications(notifications);
        console.log('Notifications data migrated successfully');
      } catch (error) {
        console.log('No existing notifications data to migrate');
      }

      // 설정 데이터 마이그레이션
      try {
        const settingsData = await fs.readFile(settingsFile, 'utf8');
        const settings = JSON.parse(settingsData);
        await this.settingsService.migrateSettings(settings);
        console.log('Settings data migrated successfully');
      } catch (error) {
        console.log('No existing settings data to migrate');
      }
    } catch (error) {
      console.error('Error during data migration:', error);
    }
  }

  private shouldStartMinimized(): boolean {
    // 개발 환경에서는 항상 창을 표시
    if (this.isDev) {
      return false;
    }
    // 명시적으로 --hidden 플래그가 있을 때만 숨김
    return process.argv.includes('--hidden');
  }

  private shouldMinimizeToTray(): boolean {
    return this.settingsService.getSetting('minimizeToTray') === 'true';
  }

  private async checkAutoStart(): Promise<void> {
    try {
      console.log('🚀 Checking and syncing auto-start settings...');
      
      // 설정 서비스의 동기화 메서드 호출
      await this.settingsService.syncAutoStartSetting();
      
      // 자동 시작으로 실행된 경우 최소화 상태로 시작
      const isAutoStarted = process.argv.includes('--auto-start') || process.argv.includes('--hidden');
      if (isAutoStarted) {
        console.log('🔄 App started via auto-start, hiding window');
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.hide();
        }
      }
      
      console.log('✅ Auto-start settings synced successfully');
    } catch (error) {
      console.error('❌ Failed to check auto-start settings:', error);
    }
  }

  public showMainWindow(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  public hideMainWindow(): void {
    if (this.mainWindow) {
      this.mainWindow.hide();
    }
  }

  public quit(): void {
    this.monitoringService.stop();
    app.quit();
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  private async updateTrayMenu(): Promise<void> {
    try {
      const stats = await this.monitoringService.getMonitoringStats();
      const needNaverLogin = await this.monitoringService.checkNaverLoginStatus();
      
      this.trayService.updateContextMenu({
        ...stats,
        needNaverLogin: needNaverLogin
      });
    } catch (error) {
      console.error('Failed to update tray menu:', error);
    }
  }

  private updateTrayMenuWithStatus(statusData: any): void {
    try {
      console.log('🔄 Updating tray menu with status:', statusData);
      this.monitoringService.getMonitoringStats().then(stats => {
        this.trayService.updateContextMenu({
          ...stats,
          needNaverLogin: statusData.needNaverLogin
        });
      }).catch(error => {
        console.error('Failed to get monitoring stats for tray update:', error);
        // 기본값으로 업데이트
        this.trayService.updateContextMenu({
          totalStreamers: 0,
          activeStreamers: 0,
          liveStreamers: 0,
          isMonitoring: this.monitoringService.isMonitoring(),
          needNaverLogin: statusData.needNaverLogin
        });
      });
    } catch (error) {
      console.error('Failed to update tray menu with status:', error);
    }
  }

  // MonitoringService에서 직접 호출할 수 있는 메서드
  updateTrayMenuWithLoginStatus(needLogin: boolean): void {
    try {
      console.log('🔄 Direct tray menu update: needLogin =', needLogin);
      this.monitoringService.getMonitoringStats().then(stats => {
        this.trayService.updateContextMenu({
          ...stats,
          needNaverLogin: needLogin
        });
      }).catch(error => {
        console.error('Failed to get monitoring stats for direct tray update:', error);
        // 기본값으로 업데이트
        this.trayService.updateContextMenu({
          totalStreamers: 0,
          activeStreamers: 0,
          liveStreamers: 0,
          isMonitoring: this.monitoringService.isMonitoring(),
          needNaverLogin: needLogin
        });
      });
    } catch (error) {
      console.error('Failed to update tray menu with login status:', error);
    }
  }

  // 모든 렌더러 프로세스에 메시지 브로드캐스트
  broadcastToAll(channel: string, ...args: any[]): void {
    try {
      const allWindows = BrowserWindow.getAllWindows();
      allWindows.forEach(window => {
        if (window && !window.isDestroyed()) {
          window.webContents.send(channel, ...args);
        }
      });
    } catch (error) {
      console.error('Failed to broadcast message:', error);
    }
  }
}

// 앱 인스턴스 생성 및 초기화
const streamerAlarmApp = new StreamerAlarmApp();

// MonitoringService에서 접근할 수 있도록 전역 참조 설정
(app as any).streamerAlarmApp = streamerAlarmApp;

// 앱 이벤트 핸들링
app.on('ready', () => {
  console.log('App ready event triggered');
  streamerAlarmApp.initialize().catch((error) => {
    console.error('App initialization failed:', error);
    // 초기화 실패 시 간단한 창이라도 표시
    const { BrowserWindow } = require('electron');
    const errorWindow = new BrowserWindow({
      width: 600,
      height: 400,
      show: true,
      title: 'Streamer Alarm System - Error'
    });
    errorWindow.loadURL('data:text/html;charset=utf-8,<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><h1>초기화 오류</h1><p>앱 초기화 중 오류가 발생했습니다.</p><pre>' + error.message + '</pre></body></html>');
  });
});

app.on('window-all-closed', () => {
  // macOS가 아닌 경우 앱 종료
  if (process.platform !== 'darwin') {
    streamerAlarmApp.quit();
  }
});

app.on('activate', () => {
  // macOS에서 독 아이콘 클릭 시 윈도우 재생성
  if (BrowserWindow.getAllWindows().length === 0) {
    streamerAlarmApp.showMainWindow();
  }
});

app.on('before-quit', () => {
  // 앱 종료 전 정리 작업
  streamerAlarmApp.quit();
});

// 개발 환경에서 핫 리로드 지원
if (process.env.NODE_ENV === 'development') {
  // HMR 지원
}