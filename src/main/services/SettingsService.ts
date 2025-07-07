import { DatabaseManager } from './DatabaseManager';
import { SettingKey } from '@shared/types';
import { BrowserWindow } from 'electron';
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
      needNaverLogin: settings.needNaverLogin === 'true'
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
      needNaverLogin: 'true'
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
}