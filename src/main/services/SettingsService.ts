import { DatabaseManager } from './DatabaseManager';
import { SettingKey } from '@shared/types';
import { BrowserWindow, app } from 'electron';
import { TrayService } from './TrayService';

export class SettingsService {
  private databaseManager: DatabaseManager;
  private settingsCache: Record<string, string> = {};
  private mainWindow: BrowserWindow | null = null;
  private trayService: TrayService | null = null;

  constructor(databaseManager: DatabaseManager, mainWindow?: BrowserWindow) {
    this.databaseManager = databaseManager;
    this.mainWindow = mainWindow || null;
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  setTrayService(trayService: TrayService): void {
    this.trayService = trayService;
  }

  async initialize(): Promise<void> {
    // 설정 캐시 로드
    this.settingsCache = await this.databaseManager.getAllSettings();
  }

  getSetting(key: SettingKey): string {
    return this.settingsCache[key] || this.getDefaultValue(key);
  }

  async updateSetting(key: SettingKey, value: any): Promise<void> {
    const stringValue = String(value);
    await this.databaseManager.setSetting(key, stringValue);
    this.settingsCache[key] = stringValue;
    
    // Windows 자동 시작 설정 처리
    if (key === 'autoStart') {
      await this.updateAutoStart(value === true || value === 'true');
    }
    
    // 모든 설정 정보 가져오기
    const allSettings = await this.getAllSettings();
    
    // UI에 설정 변경 알림
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('settings-updated', allSettings);
      console.log(`📡 Setting updated: ${key} = ${stringValue}`);
    }
    
    // 트레이 메뉴 업데이트
    if (this.trayService) {
      this.trayService.updateWithSettings(allSettings);
      console.log(`🖱️ Tray menu updated with settings`);
    }
  }

  async getAllSettings(): Promise<Record<string, any>> {
    const settings = await this.databaseManager.getAllSettings();
    
    return {
      checkInterval: parseInt(settings.checkInterval || '30'),
      autoStart: settings.autoStart === 'true',
      minimizeToTray: settings.minimizeToTray === 'true',
      showDesktopNotifications: settings.showDesktopNotifications === 'true',
      cacheCleanupInterval: parseInt(settings.cacheCleanupInterval || '3600'),
      theme: settings.theme || 'dark',
      needNaverLogin: settings.needNaverLogin === 'true',
      needWeverseLogin: settings.needWeverseLogin === 'true',
      needTwitterLogin: settings.needTwitterLogin === 'true',
      twitterCredentials: this.parseJsonSetting(settings.twitterCredentials),
      newStreamerFilterHours: parseInt(settings.newStreamerFilterHours || '24')
    };
  }

  async migrateSettings(settingsData: Record<string, any>): Promise<void> {
    // 기존 설정이 있는지 확인
    const existingSettings = await this.databaseManager.getAllSettings();
    
    if (Object.keys(existingSettings).length > 7) { // 기본 설정보다 많으면 이미 마이그레이션됨
      console.log('Settings already migrated, skipping');
      return;
    }

    // 설정 매핑
    const settingMapping: Record<string, string> = {
      'check_interval': 'checkInterval',
      'start_with_windows': 'autoStart',
      'minimize_to_tray': 'minimizeToTray',
      'show_notifications': 'showDesktopNotifications',
      'cache_cleanup_interval': 'cacheCleanupInterval',
      'theme': 'theme',
      'need_naver_login': 'needNaverLogin'
    };

    for (const [oldKey, newKey] of Object.entries(settingMapping)) {
      if (settingsData[oldKey] !== undefined) {
        await this.updateSetting(newKey as SettingKey, settingsData[oldKey]);
      }
    }

    console.log('Settings migration completed');
  }

  private getDefaultValue(key: SettingKey): string {
    const defaults: Record<SettingKey, string> = {
      checkInterval: '30',
      autoStart: 'false',
      minimizeToTray: 'true',
      showDesktopNotifications: 'true',
      cacheCleanupInterval: '3600',
      theme: 'dark',
      needNaverLogin: 'true',
      needWeverseLogin: 'true',
      needTwitterLogin: 'true',
      twitterCredentials: '{}', // 빈 JSON 객체
      newStreamerFilterHours: '24', // 새 스트리머 과거 알림 필터링 시간 (기본 24시간)
      currentBrowser: 'Chrome', // 기본 브라우저 (Weverse용)
      currentCafeBrowser: 'Chrome' // 기본 브라우저 (Cafe용)
    };

    return defaults[key] || '';
  }

  // 실시간 설정 업데이트를 위한 헬퍼 메서드들
  getCheckInterval(): number {
    return parseInt(this.getSetting('checkInterval'));
  }

  getAutoStart(): boolean {
    return this.getSetting('autoStart') === 'true';
  }

  getMinimizeToTray(): boolean {
    return this.getSetting('minimizeToTray') === 'true';
  }

  getShowDesktopNotifications(): boolean {
    return this.getSetting('showDesktopNotifications') === 'true';
  }

  getCacheCleanupInterval(): number {
    return parseInt(this.getSetting('cacheCleanupInterval'));
  }

  getTheme(): string {
    return this.getSetting('theme');
  }

  getNeedNaverLogin(): boolean {
    return this.getSetting('needNaverLogin') === 'true';
  }

  getNeedWeverseLogin(): boolean {
    return this.getSetting('needWeverseLogin') === 'true';
  }

  getNeedTwitterLogin(): boolean {
    return this.getSetting('needTwitterLogin') === 'true';
  }

  private parseJsonSetting(jsonString: string): any {
    try {
      return jsonString ? JSON.parse(jsonString) : {};
    } catch (error) {
      console.error('Failed to parse JSON setting:', error);
      return {};
    }
  }

  /**
   * Windows 자동 시작 설정 업데이트
   */
  private async updateAutoStart(enable: boolean): Promise<void> {
    try {
      console.log(`🚀 Setting Windows auto-start: ${enable}`);
      
      // 개발 환경에서는 자동 시작 기능을 건너뜀
      if (process.env.NODE_ENV === 'development') {
        console.log('⚠️ Skipping auto-start in development mode');
        return;
      }
      
      // 현재 자동 시작 상태 확인
      const currentSettings = app.getLoginItemSettings();
      console.log('Current login item settings:', currentSettings);
      
      if (enable) {
        // 자동 시작 활성화
        const appPath = process.execPath;
        console.log(`App path: ${appPath}`);
        
        app.setLoginItemSettings({
          openAtLogin: true,
          openAsHidden: true, // 백그라운드에서 시작
          name: 'Streamer Alarm System',
          path: appPath, // 실행 파일 경로 명시
          args: ['--auto-start'], // 자동 시작 플래그 추가
        });
        console.log('✅ Auto-start enabled');
      } else {
        // 자동 시작 비활성화
        app.setLoginItemSettings({
          openAtLogin: false
        });
        console.log('❌ Auto-start disabled');
      }
      
      // 설정 후 상태 확인
      const updatedSettings = app.getLoginItemSettings();
      console.log('Updated login item settings:', updatedSettings);
      
      // Windows에서는 추가 검증
      if (process.platform === 'win32') {
        const finalCheck = app.getLoginItemSettings();
        if (finalCheck.openAtLogin !== enable) {
          console.warn(`⚠️ Auto-start setting mismatch: expected ${enable}, got ${finalCheck.openAtLogin}`);
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to update auto-start setting:', error);
      throw error;
    }
  }

  /**
   * 현재 Windows 자동 시작 상태 확인
   */
  isAutoStartEnabled(): boolean {
    try {
      // 개발 환경에서는 DB 설정만 반환
      if (process.env.NODE_ENV === 'development') {
        return this.getAutoStart();
      }
      
      const settings = app.getLoginItemSettings();
      console.log('🔍 Current login item settings:', settings);
      return settings.openAtLogin;
    } catch (error) {
      console.error('Failed to get auto-start status:', error);
      return false;
    }
  }

  /**
   * 앱 시작 시 자동 시작 설정 동기화
   */
  async syncAutoStartSetting(): Promise<void> {
    try {
      const systemAutoStart = this.isAutoStartEnabled();
      const dbAutoStart = this.getAutoStart();
      
      console.log(`🔄 Syncing auto-start: system=${systemAutoStart}, db=${dbAutoStart}`);
      
      // 시스템 설정과 DB 설정이 다르면 DB 설정을 따름
      if (systemAutoStart !== dbAutoStart) {
        console.log(`Syncing auto-start from DB setting: ${dbAutoStart}`);
        await this.updateAutoStart(dbAutoStart);
      }
    } catch (error) {
      console.error('Failed to sync auto-start setting:', error);
    }
  }
}