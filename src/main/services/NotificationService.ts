import * as notifier from 'node-notifier';
import { shell, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import axios from 'axios';
// import sharp from 'sharp'; // Removed to avoid native module issues
import { DatabaseManager } from './DatabaseManager';
import { SettingsService } from './SettingsService';
import { NotificationData, NotificationRecord } from '@shared/types';

export class NotificationService {
  private databaseManager: DatabaseManager;
  private settingsService: SettingsService;
  private tempDir: string;
  private activeHandlers: Map<string, { click: (...args: any[]) => void; action: (...args: any[]) => void }> = new Map();

  constructor(databaseManager: DatabaseManager) {
    this.databaseManager = databaseManager;
    this.settingsService = new SettingsService(databaseManager);
    
    // 임시 디렉토리 설정
    const os = require('os');
    this.tempDir = path.join(os.tmpdir(), 'streamer-alarm-profiles');
    this.ensureTempDirectory();
  }

  private ensureTempDirectory(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async sendNotification(data: NotificationData): Promise<boolean> {
    try {
      // 알림이 비활성화된 경우 스킵
      if (!this.settingsService.getShowDesktopNotifications()) {
        console.log('Desktop notifications disabled, skipping');
        return false;
      }

      // 프로필 이미지 처리
      let iconPath: string | undefined;
      if (data.profileImageUrl) {
        iconPath = await this.processProfileImage(data.profileImageUrl);
      }

      // 알림 제목과 본문 구성 (새로운 형식)
      const title = data.title; // 🐦 아리사님의 트윗 등
      
      // 본문 내용이 주요 메시지가 되도록 구성
      let message = data.content || title;
      if (data.content && data.content.trim()) {
        // 트윗/게시물 내용을 전체 메시지로 사용
        message = data.content;
      }

      // 이전 핸들러 정리 (같은 uniqueKey의 중복 방지)
      this.cleanupHandlersForNotification(data.uniqueKey);

      // 고유한 클릭 핸들러 생성
      const clickHandler = this.createClickHandler(data);
      const actionHandler = this.createActionHandler(data);

      // 핸들러를 맵에 저장하여 추후 정리 가능하도록 함
      this.activeHandlers.set(data.uniqueKey, { click: clickHandler, action: actionHandler });

      // 이벤트 리스너 등록
      notifier.on('click', clickHandler);
      notifier.on('action', actionHandler);

      // 자동 정리 타이머 (30초 후)
      setTimeout(() => {
        this.cleanupHandlersForNotification(data.uniqueKey);
      }, 30000);

      // 크로스 플랫폼 호환 알림 발송
      const result = await new Promise<boolean>((resolve) => {
        const notificationOptions = this.getNotificationOptions(data, title, message, iconPath);
        
        notifier.notify(notificationOptions as any, (error: any, response: any, metadata: any) => {
          if (error) {
            console.error('Notification error:', error);
            resolve(false);
          } else {
            console.log('Notification sent successfully:', data.uniqueKey);
            resolve(true);
          }
        });
      });

      // 데이터베이스에 알림 기록 저장 및 UI 업데이트
      if (data.type !== 'system') {
        await this.saveNotificationRecord(data);
        
        // 메인 윈도우에 알림 기록 업데이트 알림
        const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed());
        if (mainWindow) {
          const notifications = await this.databaseManager.getNotifications({ limit: 100 });
          mainWindow.webContents.send('notification-history-updated', notifications);
        }
      }

      return result;
    } catch (error) {
      console.error('Failed to send notification:', error);
      
      // 폴백: 브라우저에서 URL 열기
      if (data.url) {
        try {
          await shell.openExternal(data.url);
          return true;
        } catch (fallbackError) {
          console.error('Fallback failed:', fallbackError);
        }
      }
      
      return false;
    }
  }

  async sendTestNotification(): Promise<boolean> {
    const testData: NotificationData = {
      type: 'system',
      streamerName: 'System',
      title: '알림 테스트',
      content: '알림 시스템이 정상적으로 작동하고 있습니다.',
      uniqueKey: `test_${Date.now()}`
    };

    return await this.sendNotification(testData);
  }

  private async processProfileImage(imageUrl: string): Promise<string | undefined> {
    try {
      // URL 해시를 이용한 캐시 파일명
      const urlHash = crypto.createHash('md5').update(imageUrl).digest('hex');
      const fileExtension = this.getImageExtension(imageUrl);
      const cachedPath = path.join(this.tempDir, `profile_${urlHash}${fileExtension}`);

      // 캐시된 파일이 있으면 재사용
      if (fs.existsSync(cachedPath)) {
        return cachedPath;
      }

      // 이미지 다운로드
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // 원본 이미지를 그대로 저장 (Sharp 없이)
      fs.writeFileSync(cachedPath, Buffer.from(response.data));

      return cachedPath;
    } catch (error) {
      console.error('Failed to process profile image:', error);
      return undefined;
    }
  }

  private getImageExtension(url: string): string {
    const urlPath = new URL(url).pathname;
    const extension = path.extname(urlPath);
    return extension || '.jpg';
  }

  private async saveNotificationRecord(data: NotificationData): Promise<void> {
    try {
      // 스트리머 ID 찾기
      const streamers = await this.databaseManager.getStreamers();
      const streamer = streamers.find(s => s.name === data.streamerName);
      
      if (!streamer) {
        console.error('Streamer not found for notification:', data.streamerName);
        return;
      }

      const record: Omit<NotificationRecord, 'id' | 'createdAt'> = {
        streamerId: streamer.id,
        type: data.type,
        title: data.title,
        content: data.content,
        contentHtml: data.contentHtml,
        url: data.url || '',
        uniqueKey: data.uniqueKey,
        profileImageUrl: data.profileImageUrl,
        isRead: false
      };

      await this.databaseManager.addNotification(record, data.originalTimestamp);
    } catch (error) {
      console.error('Failed to save notification record:', error);
    }
  }

  // 플랫폼별 알림 생성 헬퍼 메서드들
  createLiveNotification(
    streamerName: string, 
    title: string, 
    url: string, 
    profileImageUrl?: string
  ): NotificationData {
    return {
      type: 'live',
      streamerName,
      title: `🔴 ${streamerName}님의 라이브`,
      content: title,
      url,
      profileImageUrl,
      uniqueKey: `live_${streamerName}_${Date.now()}`
    };
  }

  createCafeNotification(
    streamerName: string,
    postTitle: string,
    url: string,
    profileImageUrl?: string,
    originalTimestamp?: Date,
    contentHtml?: string
  ): NotificationData {
    return {
      type: 'cafe',
      streamerName,
      title: `💬 ${streamerName}님의 카페 글`,
      content: postTitle,
      contentHtml: contentHtml,
      url,
      profileImageUrl,
      uniqueKey: `cafe_${streamerName}_${this.extractPostId(url)}`,
      originalTimestamp
    };
  }

  createTwitterNotification(
    streamerName: string,
    tweetContent: string,
    url: string,
    profileImageUrl?: string,
    originalTimestamp?: Date,
    contentHtml?: string
  ): NotificationData {
    return {
      type: 'twitter',
      streamerName,
      title: `🐦 ${streamerName}님의 트윗`,
      content: tweetContent,
      contentHtml: contentHtml,
      url,
      profileImageUrl,
      uniqueKey: `twitter_${streamerName}_${this.extractTweetId(url)}`,
      originalTimestamp
    };
  }

  createSystemNotification(
    title: string,
    content?: string,
    url?: string
  ): NotificationData {
    return {
      type: 'system',
      streamerName: 'System',
      title,
      content,
      url,
      uniqueKey: `system_${Date.now()}`
    };
  }

  private extractPostId(url: string): string {
    // 카페 게시물 URL에서 ID 추출
    const match = url.match(/articleid=(\d+)/);
    return match ? match[1] : String(Date.now());
  }

  private extractTweetId(url: string): string {
    // 트위터 URL에서 ID 추출
    const match = url.match(/status\/(\d+)/);
    return match ? match[1] : String(Date.now());
  }

  // 알림 읽음 처리 (uniqueKey 기반)
  private async markNotificationAsReadByUniqueKey(uniqueKey: string): Promise<void> {
    try {
      // uniqueKey로 알림 찾아서 읽음 처리
      const notifications = await this.databaseManager.getNotifications();
      const notification = notifications.find(n => n.uniqueKey === uniqueKey);
      
      if (notification && !notification.isRead) {
        await this.databaseManager.markNotificationAsRead(notification.id);
        console.log('Marked notification as read:', uniqueKey);
        
        // UI 업데이트를 위해 메인 윈도우에 알림
        const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed());
        if (mainWindow) {
          const updatedNotifications = await this.databaseManager.getNotifications({ limit: 100 });
          mainWindow.webContents.send('notification-history-updated', updatedNotifications);
        }
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  }

  // 클릭 핸들러 생성 (각 알림별로 고유)
  private createClickHandler(data: NotificationData): (...args: any[]) => void {
    return async (notifierObject: any, options: any, event: any) => {
      try {
        // 특정 알림만 처리 (ID로 확인)
        if (options && options.id !== data.uniqueKey) {
          return; // 다른 알림의 클릭 이벤트는 무시
        }

        console.log(`Notification clicked: ${data.uniqueKey}`);
        
        // 알림을 읽음 처리
        await this.markNotificationAsReadByUniqueKey(data.uniqueKey);
        
        if (data.url) {
          console.log(`Opening URL for ${data.uniqueKey}: ${data.url}`);
          await shell.openExternal(data.url);
        }
        
        // 핸들러 정리
        this.cleanupHandlersForNotification(data.uniqueKey);
      } catch (error) {
        console.error(`Failed to handle click for ${data.uniqueKey}:`, error);
      }
    };
  }

  // 액션 핸들러 생성 (각 알림별로 고유)
  private createActionHandler(data: NotificationData): (...args: any[]) => void {
    return async (notifierObject: any, options: any, event: any) => {
      try {
        // 특정 알림만 처리 (ID로 확인)
        if (options && options.id !== data.uniqueKey) {
          return; // 다른 알림의 액션 이벤트는 무시
        }

        console.log(`Notification action clicked: ${data.uniqueKey}, event: ${event}`);
        
        // Windows 토스트 알림에서 '열기' 버튼을 클릭한 경우
        if (event === '열기' && data.url) {
          // 알림을 읽음 처리
          await this.markNotificationAsReadByUniqueKey(data.uniqueKey);
          
          console.log(`Opening URL from action for ${data.uniqueKey}: ${data.url}`);
          await shell.openExternal(data.url);
        }
        
        // 핸들러 정리
        this.cleanupHandlersForNotification(data.uniqueKey);
      } catch (error) {
        console.error(`Failed to handle action for ${data.uniqueKey}:`, error);
      }
    };
  }

  // 특정 알림의 핸들러 정리
  private cleanupHandlersForNotification(uniqueKey: string): void {
    try {
      const handlers = this.activeHandlers.get(uniqueKey);
      if (handlers) {
        // 이벤트 리스너 제거
        notifier.removeListener('click', handlers.click);
        notifier.removeListener('action', handlers.action);
        
        // 맵에서 제거
        this.activeHandlers.delete(uniqueKey);
        
        console.log(`Cleaned up handlers for notification: ${uniqueKey}`);
      }
    } catch (error) {
      console.error(`Failed to cleanup handlers for ${uniqueKey}:`, error);
    }
  }

  // 모든 활성 핸들러 정리 (앱 종료 시 사용)
  public cleanupAllHandlers(): void {
    try {
      for (const [uniqueKey, handlers] of this.activeHandlers.entries()) {
        notifier.removeListener('click', handlers.click);
        notifier.removeListener('action', handlers.action);
      }
      this.activeHandlers.clear();
      console.log('All notification handlers cleaned up');
    } catch (error) {
      console.error('Failed to cleanup all handlers:', error);
    }
  }

  // 캐시 정리
  async cleanupCache(): Promise<void> {
    try {
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        for (const file of files) {
          const filePath = path.join(this.tempDir, file);
          const stats = fs.statSync(filePath);
          
          if (stats.mtime.getTime() < oneWeekAgo) {
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch (error) {
      console.error('Failed to cleanup notification cache:', error);
    }
  }

  /**
   * 플랫폼별 최적화된 알림 옵션 생성
   */
  private getNotificationOptions(
    data: NotificationData, 
    title: string, 
    message: string, 
    iconPath?: string
  ): any {
    const baseOptions = {
      title: title,
      message: message,
      icon: iconPath || this.getDefaultIconPath(),
      timeout: 10,
      id: data.uniqueKey
    };

    // 플랫폼별 최적화
    switch (process.platform) {
      case 'win32':
        return {
          ...baseOptions,
          wait: true,
          actions: data.url ? ['열기'] : undefined,
          appID: 'Streamer.Alarm.System'
        };
        
      case 'darwin':
        return {
          ...baseOptions,
          wait: true,
          subtitle: data.streamerName,
          sound: 'Ping',
          contentImage: iconPath,
          reply: false,
          closeLabel: '닫기',
          actions: data.url ? '열기' : undefined
        };
        
      case 'linux':
        return {
          ...baseOptions,
          urgency: 'normal',
          category: 'network',
          hint: 'string:desktop-entry:streamer-alarm-system',
          'expire-time': 10000,
          actions: data.url ? ['default', '열기'] : undefined
        };
        
      default:
        return baseOptions;
    }
  }

  /**
   * 플랫폼별 기본 아이콘 경로 반환
   */
  private getDefaultIconPath(): string {
    const iconDir = path.join(__dirname, '../../../assets');
    
    switch (process.platform) {
      case 'win32':
        return path.join(iconDir, 'icon.ico');
      case 'darwin':
        return path.join(iconDir, 'icon.icns');
      case 'linux':
        return path.join(iconDir, 'icon.png');
      default:
        return path.join(iconDir, 'icon.png');
    }
  }
}