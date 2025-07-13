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
  private activeNotifications: Map<string, NotificationData> = new Map(); // 활성 알림 데이터 저장
  private globalHandlersInitialized: boolean = false;

  constructor(databaseManager: DatabaseManager) {
    console.log(`[DEBUG] NotificationService constructor called`);
    this.databaseManager = databaseManager;
    this.settingsService = new SettingsService(databaseManager);
    
    // 임시 디렉토리 설정
    const os = require('os');
    this.tempDir = path.join(os.tmpdir(), 'streamer-alarm-profiles');
    this.ensureTempDirectory();
    
    // 글로벌 이벤트 핸들러 설정
    console.log(`[DEBUG] About to setup global event handlers...`);
    this.setupGlobalEventHandlers();
    console.log(`[DEBUG] NotificationService constructor completed`);
  }

  private ensureTempDirectory(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * 단일 글로벌 핸들러 설정
   * 모든 notification 이벤트를 하나의 핸들러로 처리
   */
  private setupGlobalEventHandlers(): void {
    if (this.globalHandlersInitialized) {
      console.log(`[DEBUG] Global handlers already initialized, skipping`);
      return;
    }

    console.log(`[DEBUG] ===== SETTING UP GLOBAL NOTIFICATION HANDLERS =====`);
    console.log(`[DEBUG] Platform: ${process.platform}`);
    console.log(`[DEBUG] node-notifier version: ${require('node-notifier/package.json').version}`);
    
    try {
      // 글로벌 클릭 핸들러 - 한 번만 등록
      notifier.on('click', async (...args: any[]) => {
        console.log(`[GLOBAL_CLICK] *** CLICK EVENT DETECTED ***`);
        console.log(`[GLOBAL_CLICK] Arguments:`, args);
        console.log(`[GLOBAL_CLICK] Active notifications count: ${this.activeNotifications.size}`);
        await this.handleGlobalClick(...args);
      });
      console.log(`[DEBUG] ✅ Click handler registered successfully`);

      // 글로벌 액션 핸들러 - 한 번만 등록  
      notifier.on('action', async (...args: any[]) => {
        console.log(`[GLOBAL_ACTION] *** ACTION EVENT DETECTED ***`);
        console.log(`[GLOBAL_ACTION] Arguments:`, args);
        await this.handleGlobalAction(...args);
      });
      console.log(`[DEBUG] ✅ Action handler registered successfully`);

      // 기타 이벤트들 (완전한 디버깅)
      notifier.on('timeout', (...args: any[]) => {
        console.log(`[GLOBAL_TIMEOUT] Timeout event:`, args);
      });
      
      notifier.on('close', (...args: any[]) => {
        console.log(`[GLOBAL_CLOSE] Close event:`, args);
      });
      
      notifier.on('fail', (...args: any[]) => {
        console.log(`[GLOBAL_FAIL] Fail event:`, args);
      });

      // 모든 이벤트 캐치 (디버깅용)
      notifier.on('*', (...args: any[]) => {
        console.log(`[GLOBAL_WILDCARD] Unknown event detected:`, args);
      });

      console.log(`[DEBUG] ✅ All handlers registered successfully`);
      
      this.globalHandlersInitialized = true;
      
      // 핸들러 등록 확인을 위한 즉시 테스트
      console.log(`[DEBUG] Testing handler registration...`);
      console.log(`[DEBUG] notifier.listenerCount('click'): ${notifier.listenerCount('click')}`);
      console.log(`[DEBUG] notifier.listenerCount('action'): ${notifier.listenerCount('action')}`);
      
      console.log(`[DEBUG] ===== GLOBAL HANDLERS INITIALIZATION COMPLETE =====`);
    } catch (error) {
      console.error(`[ERROR] Failed to setup global handlers:`, error);
      this.globalHandlersInitialized = false;
    }
  }

  /**
   * 글로벌 클릭 이벤트 처리
   */
  private async handleGlobalClick(...args: any[]): Promise<void> {
    try {
      console.log(`[GLOBAL_CLICK] Processing click event with ${args.length} arguments`);
      
      // 가장 최근에 등록된 알림을 우선 처리
      const recentNotification = this.getMostRecentNotification();
      
      if (recentNotification) {
        console.log(`[GLOBAL_CLICK] Opening URL for recent notification: ${recentNotification.uniqueKey}`);
        
        if (recentNotification.url) {
          await shell.openExternal(recentNotification.url);
          console.log(`[GLOBAL_CLICK] Successfully opened URL: ${recentNotification.url}`);
          
          // 알림을 읽음 처리
          await this.markNotificationAsReadByUniqueKey(recentNotification.uniqueKey);
          
          // 처리된 알림은 활성 목록에서 제거
          this.activeNotifications.delete(recentNotification.uniqueKey);
        }
      } else {
        console.log(`[GLOBAL_CLICK] No active notifications found to process`);
      }
    } catch (error) {
      console.error(`[GLOBAL_CLICK] Error processing click:`, error);
    }
  }

  /**
   * 글로벌 액션 이벤트 처리
   */
  private async handleGlobalAction(...args: any[]): Promise<void> {
    try {
      console.log(`[GLOBAL_ACTION] Processing action event with ${args.length} arguments`);
      
      // 액션 버튼 클릭도 일반 클릭과 동일하게 처리
      await this.handleGlobalClick(...args);
    } catch (error) {
      console.error(`[GLOBAL_ACTION] Error processing action:`, error);
    }
  }

  /**
   * 기본 알림 방식으로 폴백
   */
  private fallbackToDefaultNotification(notificationOptions: any, data: NotificationData, resolve: (value: boolean) => void): void {
    console.log(`[FALLBACK] Using default notification method`);
    
    const notificationStartTime = Date.now();
    
    notifier.notify(notificationOptions as any, async (error: any, response: any, metadata: any) => {
      if (error) {
        console.error(`[ERROR] Notification error for ${data.uniqueKey}:`, error);
        resolve(false);
      } else {
        const callbackTime = Date.now();
        const timeDiff = callbackTime - notificationStartTime;
        
        console.log(`[INFO] Notification sent successfully: ${data.uniqueKey}`, {
          response: response,
          metadata: metadata,
          timeDiff: `${timeDiff}ms`
        });
        
        // 콜백 기반 클릭 처리 (타이밍 정보 포함)
        await this.handleCallbackResponse(data, response, metadata, timeDiff);
        
        resolve(true);
      }
    });
  }

  /**
   * 콜백 응답 처리 (글로벌 핸들러 대안)
   */
  private async handleCallbackResponse(data: NotificationData, response: any, metadata: any, timeDiff?: number): Promise<void> {
    try {
      console.log(`[CALLBACK] Processing callback response for ${data.uniqueKey}`);
      console.log(`[CALLBACK] Response: ${response}, Metadata:`, metadata);
      if (timeDiff !== undefined) {
        console.log(`[CALLBACK] Time difference: ${timeDiff}ms`);
      }
      
      // Windows에서 사용자가 클릭했는지 확인 (더 많은 케이스 추가)
      // 🚨 중요: response가 undefined여도 콜백이 즉시 호출되면 클릭으로 간주
      let isClicked = response === 'activate' || 
                     response === 'clicked' || 
                     response === '열기' ||
                     response === '확인' ||
                     response === '링크 열기' ||
                     metadata?.activationType === 'user' ||
                     metadata?.activationType === 'foreground' ||
                     metadata?.action === '열기' ||
                     metadata?.action === '확인' ||
                     metadata?.action === '링크 열기';
      
      // undefined 응답이지만 사용자가 실제로 클릭했을 수 있음 (Windows 토스트 특성)
      if (response === undefined && data.url) {
        console.log(`[CALLBACK] Treating undefined response as potential user click for URL notification`);
        isClicked = true;
      }
      
      if (isClicked) {
        console.log(`[CALLBACK] *** USER CLICKED NOTIFICATION ***`);
        console.log(`[CALLBACK] Opening URL for: ${data.uniqueKey}`);
        
        if (data.url) {
          try {
            await shell.openExternal(data.url);
            console.log(`[CALLBACK] Successfully opened URL via callback: ${data.url}`);
            
            // 알림을 읽음 처리
            await this.markNotificationAsReadByUniqueKey(data.uniqueKey);
            
            // 처리된 알림은 활성 목록에서 제거
            this.activeNotifications.delete(data.uniqueKey);
          } catch (urlError) {
            console.error(`[CALLBACK] Failed to open URL:`, urlError);
            // 폴백: Windows 직접 실행
            if (process.platform === 'win32') {
              try {
                const { spawn } = require('child_process');
                spawn('rundll32', ['url.dll,FileProtocolHandler', data.url], { detached: true });
                console.log(`[CALLBACK] Fallback URL open successful: ${data.url}`);
              } catch (fallbackError) {
                console.error(`[CALLBACK] Fallback failed:`, fallbackError);
              }
            }
          }
        }
      } else {
        console.log(`[CALLBACK] No user interaction detected (response: ${response})`);
      }
    } catch (error) {
      console.error(`[CALLBACK] Error processing callback:`, error);
    }
  }

  /**
   * 가장 최근 알림 가져오기
   */
  private getMostRecentNotification(): NotificationData | null {
    if (this.activeNotifications.size === 0) {
      return null;
    }
    
    // 가장 최근에 추가된 알림 반환
    const notifications = Array.from(this.activeNotifications.values());
    return notifications[notifications.length - 1];
  }

  async sendNotification(data: NotificationData): Promise<boolean> {
    try {
      console.log(`[INFO] sendNotification called for: ${data.uniqueKey}`);
      console.log(`[DEBUG] Initial data check:`, {
        platform: process.platform,
        hasUrl: !!data.url,
        url: data.url,
        uniqueKey: data.uniqueKey
      });
      
      // 알림이 비활성화된 경우 스킵
      const notificationsEnabled = this.settingsService.getShowDesktopNotifications();
      console.log(`[DEBUG] Desktop notifications enabled: ${notificationsEnabled}`);
      
      if (!notificationsEnabled) {
        console.log('[INFO] Desktop notifications disabled, skipping');
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

      // 활성 알림 목록에 추가 (글로벌 핸들러에서 사용)
      this.activeNotifications.set(data.uniqueKey, data);
      console.log(`[DEBUG] Added notification to active list: ${data.uniqueKey}`);

      // 폴백 메커니즘 제거 - 사용자가 명시적으로 클릭해야만 URL이 열림

      // 60초 후 자동 정리 (최종 정리)
      setTimeout(() => {
        this.activeNotifications.delete(data.uniqueKey);
        console.log(`[DEBUG] Auto-cleaned notification from active list: ${data.uniqueKey}`);
      }, 60000);

      // 윈도우 특수 처리 조건을 미리 계산
      const isWindows = process.platform === 'win32';
      const hasUrl = !!data.url;
      const useWindowsSpecial = isWindows && hasUrl;
      
      console.log(`[DEBUG] Pre-Promise check:`, {
        isWindows,
        hasUrl,
        useWindowsSpecial,
        platform: process.platform,
        url: data.url
      });

      // 크로스 플랫폼 호환 알림 발송 (콜백 기반 클릭 처리 포함)
      const result = await new Promise<boolean>((resolve) => {
        const notificationOptions = this.getNotificationOptions(data, title, message, iconPath);
        
        console.log(`[DEBUG] Notification options:`, notificationOptions);
        console.log(`[INFO] Calling notifier.notify for: ${data.uniqueKey}`);
        
        // 디버깅을 위한 상세 로그
        console.log(`[DEBUG] Inside Promise - Platform: ${process.platform}, Has URL: ${!!data.url}`);
        console.log(`[DEBUG] Inside Promise - useWindowsSpecial: ${useWindowsSpecial}`);
        
        if (useWindowsSpecial) {
          console.log(`[WINDOWS] Using Windows-specific notification with click detection`);
          
          // SnoreToast 직접 실행으로 클릭 감지
          const { spawn } = require('child_process');
          const path = require('path');
          
          // SnoreToast 실행 파일 경로 찾기
          let snoreToastPath;
          try {
            const nodeNotifierPath = require.resolve('node-notifier');
            snoreToastPath = path.join(path.dirname(nodeNotifierPath), 'vendor', 'snoreToast', 'SnoreToast.exe');
          } catch (error) {
            console.error(`[WINDOWS] Failed to find SnoreToast path:`, error);
            this.fallbackToDefaultNotification(notificationOptions, data, resolve);
            return;
          }
          
          const snoreArgs = [
            '-t', notificationOptions.title,
            '-m', notificationOptions.message,
            '-p', notificationOptions.icon || '',
            '-id', data.uniqueKey,
            '-appID', 'Streamer.Alarm.System',
            '-b', '확인;링크 열기'
          ];
          
          console.log(`[WINDOWS] Launching SnoreToast with args:`, snoreArgs);
          
          const snoreProcess = spawn(snoreToastPath, snoreArgs, { 
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          let output = '';
          snoreProcess.stdout.on('data', (stdoutData: any) => {
            output += stdoutData.toString();
          });
          
          snoreProcess.on('close', async (code: number | null) => {
            console.log(`[WINDOWS] SnoreToast exited with code: ${code}`);
            console.log(`[WINDOWS] SnoreToast output: ${output}`);
            
            // 사용자가 클릭했는지 확인 (exit code 기반)
            if (code === 0) { // 성공적인 사용자 상호작용
              console.log(`[WINDOWS] *** USER CLICKED NOTIFICATION ***`);
              try {
                await shell.openExternal(data.url!);
                console.log(`[WINDOWS] Successfully opened URL: ${data.url}`);
                
                // 알림을 읽음 처리
                await this.markNotificationAsReadByUniqueKey(data.uniqueKey);
                this.activeNotifications.delete(data.uniqueKey);
              } catch (urlError) {
                console.error(`[WINDOWS] Failed to open URL:`, urlError);
              }
            }
            
            resolve(true);
          });
          
          snoreProcess.on('error', (error: any) => {
            console.error(`[WINDOWS] SnoreToast error:`, error);
            // 폴백: 기본 방식 사용
            this.fallbackToDefaultNotification(notificationOptions, data, resolve);
          });
        } else {
          // 다른 플랫폼 또는 URL이 없는 경우 기본 방식
          this.fallbackToDefaultNotification(notificationOptions, data, resolve);
        }
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
    console.log(`[INFO] Test notification requested`);
    
    const testData: NotificationData = {
      type: 'system',
      streamerName: 'System',
      title: '알림 테스트',
      content: '알림 시스템이 정상적으로 작동하고 있습니다. 이 알림을 클릭하면 GitHub이 열립니다.',
      url: 'https://github.com', // 테스트용 URL 추가
      uniqueKey: `test_${Date.now()}`
    };

    console.log(`[INFO] Sending test notification:`, {
      uniqueKey: testData.uniqueKey,
      url: testData.url,
      platform: process.platform,
      showDesktopNotifications: this.settingsService.getShowDesktopNotifications()
    });
    
    const result = await this.sendNotification(testData);
    console.log(`[INFO] Test notification result: ${result}`);
    return result;
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

  // 기존의 개별 핸들러 생성 메서드들 제거됨 - 글로벌 핸들러로 대체

  // 앱 종료 시 정리 (글로벌 핸들러는 자동으로 정리됨)
  public cleanupAllHandlers(): void {
    try {
      this.activeNotifications.clear();
      console.log('All active notifications cleared');
    } catch (error) {
      console.error('Failed to cleanup notifications:', error);
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
        // Windows 토스트 알림 최대 호환성을 위한 간소화된 옵션
        const winOptions: any = {
          ...baseOptions,
          wait: false, // wait를 false로 변경하여 이벤트 처리 개선
          appID: 'Streamer.Alarm.System'
        };
        
        // URL이 있는 경우 단순한 액션 버튼만 추가
        if (data.url) {
          winOptions.actions = ['확인'];
          // 복잡한 옵션들 제거
        }
        
        console.log(`[DEBUG] Windows notification options for ${data.uniqueKey}:`, winOptions);
        return winOptions;
        
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