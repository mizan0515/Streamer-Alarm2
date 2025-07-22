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
  private processedNotifications: Set<string> = new Set(); // 처리된 알림 추적 (중복 방지)
  private notificationProcessingInProgress: Set<string> = new Set(); // 현재 처리 중인 알림 추적
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

  /**
   * 데이터베이스에서 기존 알림들을 로드하여 중복 체크 시스템을 초기화합니다.
   * 앱 시작 시 호출되어 이미 처리된 알림이 다시 표시되지 않도록 합니다.
   */
  async initializeDuplicateCheck(): Promise<void> {
    try {
      console.log(`[DUPLICATE_INIT] 🔄 Initializing duplicate check system...`);
      
      // 기존 알림들의 uniqueKey 목록을 DB에서 조회 (최근 7일간)
      const existingUniqueKeys = await this.databaseManager.getExistingUniqueKeys(7);
      
      console.log(`[DUPLICATE_INIT] 📋 Found ${existingUniqueKeys.length} existing notifications`);
      
      // processedNotifications Set에 기존 uniqueKey들을 추가
      existingUniqueKeys.forEach(uniqueKey => {
        this.processedNotifications.add(uniqueKey);
      });
      
      console.log(`[DUPLICATE_INIT] ✅ Duplicate check system initialized with ${this.processedNotifications.size} processed notifications`);
      
      // 디버깅을 위한 일부 샘플 출력
      const sampleKeys = Array.from(this.processedNotifications).slice(0, 5);
      console.log(`[DUPLICATE_INIT] 📊 Sample processed keys:`, sampleKeys);
      
    } catch (error) {
      console.error(`[DUPLICATE_INIT] ❌ Failed to initialize duplicate check system:`, error);
      // 오류가 발생해도 서비스는 계속 작동하도록 함
    }
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
   * 글로벌 클릭 이벤트 처리 (중복 방지 로직 추가)
   */
  private async handleGlobalClick(...args: any[]): Promise<void> {
    try {
      console.log(`[GLOBAL_CLICK] Processing click event with ${args.length} arguments`);
      
      // 가장 최근에 등록된 알림을 우선 처리
      const recentNotification = this.getMostRecentNotification();
      
      if (recentNotification) {
        // 중복 처리 방지 확인 (처리 중이거나 이미 처리된 경우)
        if (this.processedNotifications.has(recentNotification.uniqueKey) || 
            this.notificationProcessingInProgress.has(recentNotification.uniqueKey)) {
          console.log(`[GLOBAL_CLICK] Notification already processed or processing: ${recentNotification.uniqueKey}`);
          return;
        }
        
        console.log(`[GLOBAL_CLICK] Opening URL for recent notification: ${recentNotification.uniqueKey}`);
        
        if (recentNotification.url) {
          // 처리 시작 표시
          this.notificationProcessingInProgress.add(recentNotification.uniqueKey);
          
          try {
            // 먼저 알림을 읽음 처리 (URL 열기 전에)
            await this.markNotificationAsReadByUniqueKey(recentNotification.uniqueKey);
            console.log(`[GLOBAL_CLICK] Notification marked as read: ${recentNotification.uniqueKey}`);
            
            // 그 다음 URL 열기
            await shell.openExternal(recentNotification.url);
            console.log(`[GLOBAL_CLICK] Successfully opened URL: ${recentNotification.url}`);
            
            // 처리 완료 표시
            this.processedNotifications.add(recentNotification.uniqueKey);
            
            // 처리된 알림은 활성 목록에서 제거
            this.activeNotifications.delete(recentNotification.uniqueKey);
          } catch (urlError) {
            console.error(`[GLOBAL_CLICK] Failed to open URL:`, urlError);
            // URL 열기 실패해도 읽음 처리는 유지
          } finally {
            // 처리 중 상태 제거
            this.notificationProcessingInProgress.delete(recentNotification.uniqueKey);
          }
        } else {
          console.log(`[GLOBAL_CLICK] No URL to open, but marking as read: ${recentNotification.uniqueKey}`);
          // URL이 없어도 읽음 처리
          await this.markNotificationAsReadByUniqueKey(recentNotification.uniqueKey);
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
    console.log(`[FALLBACK] 🔄 Using default notification method (node-notifier)`);
    console.log(`[FALLBACK] Platform: ${process.platform}, UniqueKey: ${data.uniqueKey}`);
    
    const notificationStartTime = Date.now();
    
    notifier.notify(notificationOptions as any, async (error: any, response: any, metadata: any) => {
      const callbackTime = Date.now();
      const timeDiff = callbackTime - notificationStartTime;
      
      if (error) {
        console.error(`[FALLBACK] ❌ Default notification failed for ${data.uniqueKey}:`, error);
        console.log(`[FALLBACK] 📊 Notification display status: FAILED (error in default method)`);
        console.log(`[FALLBACK] ⚠️ All notification methods exhausted - notification will be saved to history only`);
        resolve(false);
      } else {
        console.log(`[FALLBACK] ✅ Default notification callback received for ${data.uniqueKey}`);
        console.log(`[FALLBACK] 📊 Callback details:`, {
          response: response,
          metadata: metadata,
          timeDiff: `${timeDiff}ms`
        });
        
        // 응답 기반 표시 상태 판단
        if (response === undefined) {
          console.log(`[FALLBACK] 📊 Notification display status: LIKELY_SHOWN (undefined response, no user interaction)`);
        } else if (response === 'activate' || response === 'clicked') {
          console.log(`[FALLBACK] 📊 Notification display status: SHOWN_AND_CLICKED (user interaction detected)`);
        } else {
          console.log(`[FALLBACK] 📊 Notification display status: SHOWN (response: ${response})`);
        }
        
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
      
      // Windows에서 사용자가 클릭했는지 확인 (더 엄격한 검증)
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
      
      // 🚨 중요: undefined 응답은 절대 클릭으로 간주하지 않음 (자동 URL 열기 방지)
      // 폴백 과정에서 발생하는 undefined 응답으로 인한 자동 URL 열기를 완전 차단
      if (response === undefined) {
        console.log(`[CALLBACK] Undefined response detected - ignoring to prevent automatic URL opening`);
        console.log(`[CALLBACK] TimeDiff: ${timeDiff}ms - Response: ${response}`);
        isClicked = false; // 명시적으로 false 설정
      }
      
      if (isClicked) {
        // 중복 처리 방지 확인 (처리 중이거나 이미 처리된 경우)
        if (this.processedNotifications.has(data.uniqueKey) || 
            this.notificationProcessingInProgress.has(data.uniqueKey)) {
          console.log(`[CALLBACK] Notification already processed or processing: ${data.uniqueKey}`);
          return;
        }
        
        console.log(`[CALLBACK] *** USER CLICKED NOTIFICATION ***`);
        console.log(`[CALLBACK] Opening URL for: ${data.uniqueKey}`);
        
        // 처리 시작 표시
        this.notificationProcessingInProgress.add(data.uniqueKey);
        
        try {
          // 먼저 알림을 읽음 처리 (URL 열기 전에)
          await this.markNotificationAsReadByUniqueKey(data.uniqueKey);
          console.log(`[CALLBACK] Notification marked as read: ${data.uniqueKey}`);
          
          if (data.url) {
            try {
              await shell.openExternal(data.url);
              console.log(`[CALLBACK] Successfully opened URL via callback: ${data.url}`);
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
          
          // 처리 완료 표시
          this.processedNotifications.add(data.uniqueKey);
          this.activeNotifications.delete(data.uniqueKey);
          
        } catch (error) {
          console.error(`[CALLBACK] Error in callback processing:`, error);
        } finally {
          // 처리 중 상태 제거
          this.notificationProcessingInProgress.delete(data.uniqueKey);
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

      // 🔍 중복 알림 검사
      console.log(`[DUPLICATE_CHECK] 🔍 Checking for duplicate notifications: ${data.uniqueKey}`);
      console.log(`[DUPLICATE_CHECK] Current active notifications: ${this.activeNotifications.size}`);
      console.log(`[DUPLICATE_CHECK] Current processed notifications: ${this.processedNotifications.size}`);
      console.log(`[DUPLICATE_CHECK] Current processing notifications: ${this.notificationProcessingInProgress.size}`);
      
      if (this.activeNotifications.has(data.uniqueKey)) {
        console.log(`[DUPLICATE_CHECK] ⚠️ Notification already in active list: ${data.uniqueKey}`);
        return false;
      }
      
      if (this.processedNotifications.has(data.uniqueKey)) {
        console.log(`[DUPLICATE_CHECK] ⚠️ Notification already processed: ${data.uniqueKey}`);
        return false;
      }
      
      if (this.notificationProcessingInProgress.has(data.uniqueKey)) {
        console.log(`[DUPLICATE_CHECK] ⚠️ Notification currently being processed: ${data.uniqueKey}`);
        return false;
      }

      // 활성 알림 목록에 추가 (글로벌 핸들러에서 사용)
      this.activeNotifications.set(data.uniqueKey, data);
      console.log(`[DEBUG] ✅ Added notification to active list: ${data.uniqueKey}`);

      // 폴백 메커니즘 제거 - 사용자가 명시적으로 클릭해야만 URL이 열림

      // 60초 후 자동 정리 (최종 정리)
      setTimeout(() => {
        this.activeNotifications.delete(data.uniqueKey);
        this.processedNotifications.delete(data.uniqueKey);
        this.notificationProcessingInProgress.delete(data.uniqueKey);
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
          
          // SnoreToast 실행 파일 경로 찾기 (여러 경로 시도)
          let snoreToastPath: string | null = null;
          
          // 🚨 안전한 SnoreToast 경로 찾기 (타입 검증 포함)
          const possiblePaths: string[] = [];
          
          try {
            // 🚨 수정: 실제 SnoreToast 파일명 사용 (아키텍처별)
            const isX64 = process.arch === 'x64';
            const snoreToastFilename = isX64 ? 'snoretoast-x64.exe' : 'snoretoast-x86.exe';
            console.log(`[WINDOWS] Using SnoreToast for architecture: ${process.arch} (${snoreToastFilename})`);
            
            // 기본 상대 경로들 (올바른 파일명 사용)
            possiblePaths.push(
              path.join(__dirname, '../../../node_modules/node-notifier/vendor/snoreToast', snoreToastFilename),
              path.join(__dirname, '../../../../node_modules/node-notifier/vendor/snoreToast', snoreToastFilename),
              path.join(process.cwd(), 'node_modules/node-notifier/vendor/snoreToast', snoreToastFilename)
            );
            
            // require.resolve 안전 사용
            try {
              const nodeNotifierPath = require.resolve('node-notifier');
              console.log(`[WINDOWS] node-notifier resolved to: ${nodeNotifierPath}`);
              
              if (typeof nodeNotifierPath === 'string' && nodeNotifierPath.length > 0) {
                // 패키지 루트로 이동하는 안전한 방법
                const packageRoot = nodeNotifierPath.replace(/[\\\/]lib[\\\/].*$/, '');
                if (typeof packageRoot === 'string' && packageRoot !== nodeNotifierPath) {
                  possiblePaths.push(path.join(packageRoot, 'vendor', 'snoreToast', snoreToastFilename));
                }
                
                // 디렉토리 기반 접근
                const nodeNotifierDir = path.dirname(nodeNotifierPath);
                if (typeof nodeNotifierDir === 'string') {
                  possiblePaths.push(path.join(nodeNotifierDir, '..', 'vendor', 'snoreToast', snoreToastFilename));
                }
              }
            } catch (resolveError) {
              console.warn(`[WINDOWS] Failed to resolve node-notifier path:`, resolveError);
            }
            
            // 추가 프로덕션 환경 경로들 (올바른 파일명 사용)
            possiblePaths.push(
              // app.asar 환경
              path.join(process.resourcesPath || process.cwd(), 'app.asar.unpacked', 'node_modules', 'node-notifier', 'vendor', 'snoreToast', snoreToastFilename),
              path.join(process.resourcesPath || process.cwd(), 'app', 'node_modules', 'node-notifier', 'vendor', 'snoreToast', snoreToastFilename),
              // 개발 환경 추가 경로
              path.join(__dirname, '../../node_modules/node-notifier/vendor/snoreToast', snoreToastFilename),
              path.join(__dirname, '../node_modules/node-notifier/vendor/snoreToast', snoreToastFilename)
            );
            
          } catch (pathError) {
            console.error(`[WINDOWS] Error building SnoreToast paths:`, pathError);
          }
          
          console.log(`[WINDOWS] Generated ${possiblePaths.length} possible SnoreToast paths:`, possiblePaths);
          
          // 🚨 안전한 경로 검증 및 선택
          for (let i = 0; i < possiblePaths.length; i++) {
            const testPath = possiblePaths[i];
            try {
              console.log(`[WINDOWS] Testing path ${i + 1}/${possiblePaths.length}: ${testPath}`);
              
              // 다중 검증 레이어
              if (!testPath) {
                console.log(`[WINDOWS] Path ${i + 1} is null/undefined, skipping`);
                continue;
              }
              
              if (typeof testPath !== 'string') {
                console.log(`[WINDOWS] Path ${i + 1} is not a string (type: ${typeof testPath}), skipping`);
                continue;
              }
              
              if (testPath.length === 0) {
                console.log(`[WINDOWS] Path ${i + 1} is empty string, skipping`);
                continue;
              }
              
              // 파일 존재 여부 확인
              const pathExists = fs.existsSync(testPath);
              console.log(`[WINDOWS] Path ${i + 1} exists: ${pathExists}`);
              
              if (pathExists) {
                // 실제 파일인지 확인 (디렉토리가 아닌)
                const stats = fs.statSync(testPath);
                if (stats.isFile()) {
                  snoreToastPath = testPath;
                  console.log(`[WINDOWS] ✅ Found valid SnoreToast executable at: ${snoreToastPath}`);
                  break;
                } else {
                  console.log(`[WINDOWS] Path ${i + 1} exists but is not a file (directory?), skipping`);
                }
              }
            } catch (error) {
              console.warn(`[WINDOWS] Error checking path ${i + 1} (${testPath}):`, error);
              // 개별 경로 확인 실패는 무시하고 다음 경로 시도
              continue;
            }
          }
          
          if (!snoreToastPath) {
            console.error(`[WINDOWS] Failed to find SnoreToast in any of the expected locations`);
            console.log(`[WINDOWS] Tried paths:`, possiblePaths);
            this.fallbackToDefaultNotification(notificationOptions, data, resolve);
            return;
          }
          
          // SnoreToast 인수 안전하게 구성
          const snoreArgs = [
            '-t', String(notificationOptions.title || ''),
            '-m', String(notificationOptions.message || ''),
            '-p', String(notificationOptions.icon || ''),
            '-id', String(data.uniqueKey || `notification_${Date.now()}`),
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
            console.log(`[WINDOWS] SnoreToast process exited with code: ${code}`);
            console.log(`[WINDOWS] SnoreToast output: ${output}`);
            
            // 📊 알림 표시 성공/실패 정확한 로깅
            if (code === 0) {
              console.log(`[WINDOWS] 📊 Notification display status: SUCCESS (exit code 0 = user interaction)`);
              console.log(`[WINDOWS] ✅ User clicked notification successfully`);
            } else if (code === -1) {
              console.log(`[WINDOWS] 📊 Notification display status: TIMEOUT (exit code -1 = notification timeout)`);
              console.log(`[WINDOWS] ⏰ Notification was displayed but user did not interact within timeout`);
            } else if (code === 1) {
              console.log(`[WINDOWS] 📊 Notification display status: HIDDEN (exit code 1 = notification hidden)`);
              console.log(`[WINDOWS] 👁️ Notification was displayed but then hidden by user/system`);
            } else {
              console.log(`[WINDOWS] 📊 Notification display status: UNKNOWN (exit code ${code})`);
              console.log(`[WINDOWS] ❓ Unexpected exit code - notification status unclear`);
            }
            
            // 사용자가 클릭했는지 확인 (exit code 기반)
            if (code === 0) { // 성공적인 사용자 상호작용
              // 중복 처리 방지 확인 (처리 중이거나 이미 처리된 경우)
              if (this.processedNotifications.has(data.uniqueKey) || 
                  this.notificationProcessingInProgress.has(data.uniqueKey)) {
                console.log(`[WINDOWS] Notification already processed or processing: ${data.uniqueKey}`);
                resolve(true);
                return;
              }
              
              console.log(`[WINDOWS] *** USER CLICKED NOTIFICATION ***`);
              
              // 처리 시작 표시
              this.notificationProcessingInProgress.add(data.uniqueKey);
              
              try {
                // 먼저 알림을 읽음 처리 (URL 열기 전에)
                await this.markNotificationAsReadByUniqueKey(data.uniqueKey);
                console.log(`[WINDOWS] Notification marked as read: ${data.uniqueKey}`);
                
                // 그 다음 URL 열기
                await shell.openExternal(data.url!);
                console.log(`[WINDOWS] Successfully opened URL: ${data.url}`);
                
                // 처리 완료 표시
                this.processedNotifications.add(data.uniqueKey);
                this.activeNotifications.delete(data.uniqueKey);
              } catch (urlError) {
                console.error(`[WINDOWS] Failed to open URL:`, urlError);
                // URL 열기 실패해도 읽음 처리는 유지
              } finally {
                // 처리 중 상태 제거
                this.notificationProcessingInProgress.delete(data.uniqueKey);
              }
            } else {
              // 사용자 클릭이 없는 경우도 알림 표시는 성공으로 간주
              console.log(`[WINDOWS] ⏰ Notification was displayed but no user interaction (exit code: ${code})`);
              console.log(`[WINDOWS] 📊 Overall result: NOTIFICATION_SHOWN_SUCCESSFULLY (no URL opened)`);
            }
            
            resolve(true); // 알림 표시 자체는 성공
          });
          
          snoreProcess.on('error', (error: any) => {
            console.error(`[WINDOWS] ❌ SnoreToast error:`, error);
            // 🔄 폴백: Electron 기본 알림 사용
            console.log(`[WINDOWS] 🔄 Falling back to Electron notification...`);
            try {
              const { Notification } = require('electron');
              
              // 🚨 안전 조치: Electron 알림 옵션 검증 및 정제
              const safeElectronOptions: Electron.NotificationConstructorOptions = {
                title: (notificationOptions.title || '알림').substring(0, 100),
                body: (notificationOptions.message || '내용 없음').substring(0, 250),
                silent: false,
                urgency: 'normal',
                timeoutType: 'default'
              };

              // 아이콘 안전 처리
              if (notificationOptions.icon && typeof notificationOptions.icon === 'string') {
                try {
                  const fs = require('fs');
                  if (fs.existsSync(notificationOptions.icon)) {
                    safeElectronOptions.icon = notificationOptions.icon;
                  }
                } catch (iconError) {
                  console.warn('[ELECTRON] Icon validation failed, proceeding without icon:', iconError);
                }
              }

              const electronNotification = new Notification(safeElectronOptions);
              
              // 🚨 안전한 이벤트 핸들링 (명시적 사용자 클릭만 처리)
              let isUserClicked = false;
              
              electronNotification.on('click', async () => {
                console.log(`[ELECTRON] ✅ User clicked notification: ${data.uniqueKey}`);
                isUserClicked = true;
                
                // 중복 처리 방지 확인
                if (this.processedNotifications.has(data.uniqueKey) || 
                    this.notificationProcessingInProgress.has(data.uniqueKey)) {
                  console.log(`[ELECTRON] Notification already processed or processing: ${data.uniqueKey}`);
                  return;
                }
                
                // 처리 시작 표시
                this.notificationProcessingInProgress.add(data.uniqueKey);
                
                try {
                  // 먼저 알림을 읽음 처리 (URL 열기 전에)
                  await this.markNotificationAsReadByUniqueKey(data.uniqueKey);
                  console.log(`[ELECTRON] Notification marked as read: ${data.uniqueKey}`);
                  
                  // URL 안전 처리 (사용자 클릭 시에만)
                  if (data.url && typeof data.url === 'string') {
                    await shell.openExternal(data.url);
                    console.log(`[ELECTRON] ✅ URL opened by user click: ${data.url}`);
                  } else {
                    console.log(`[ELECTRON] No URL to open for notification: ${data.uniqueKey}`);
                  }
                  
                  // 처리 완료 표시
                  this.processedNotifications.add(data.uniqueKey);
                  this.activeNotifications.delete(data.uniqueKey);
                } catch (error) {
                  console.error(`[ELECTRON] ❌ Failed to open URL:`, error);
                } finally {
                  // 처리 중 상태 제거
                  this.notificationProcessingInProgress.delete(data.uniqueKey);
                }
              });

              electronNotification.on('close', (reason: any) => {
                console.log(`[ELECTRON] Notification closed (reason: ${reason}): ${data.uniqueKey}`);
                if (!isUserClicked) {
                  console.log(`[ELECTRON] Notification closed without user interaction - no URL opening`);
                }
              });

              electronNotification.on('failed', (error: any) => {
                console.error(`[ELECTRON] ❌ Notification failed to display:`, error);
              });
              
              // 실제 표시 성공 여부 확인
              try {
                electronNotification.show();
                
                // Electron 알림 표시 성공 검증
                setTimeout(() => {
                  // 알림이 실제로 표시되었는지 확인하는 간접적 방법
                  console.log(`[ELECTRON] ✅ Electron fallback notification show() called successfully`);
                  console.log(`[ELECTRON] Title: "${safeElectronOptions.title}"`);
                  console.log(`[ELECTRON] Body: "${safeElectronOptions.body}"`);
                  console.log(`[ELECTRON] ⚠️ User must click notification to open URL - no automatic opening`);
                  console.log(`[ELECTRON] 📊 Notification display status: LIKELY_SUCCESSFUL (show() completed without error)`);
                }, 100);
                
                resolve(true);
              } catch (showError) {
                console.error(`[ELECTRON] ❌ Failed to show notification:`, showError);
                console.log(`[ELECTRON] 📊 Notification display status: FAILED (show() threw error)`);
                throw showError; // 다음 catch 블록으로 이동
              }
            } catch (electronError) {
              console.error(`[ELECTRON] ❌ Electron notification fallback also failed:`, electronError);
              // 🚨 최종 폴백에서도 자동 URL 열기 제거
              console.log(`[FINAL_FALLBACK] ❌ All notification methods failed - using final fallback`);
              console.log(`[FINAL_FALLBACK] ⚠️ NO automatic URL opening - notification saved to history only`);
              this.fallbackToDefaultNotification(notificationOptions, data, resolve);
            }
          });
        } else {
          // 다른 플랫폼 또는 URL이 없는 경우 기본 방식
          this.fallbackToDefaultNotification(notificationOptions, data, resolve);
        }
      });

      // 데이터베이스에 알림 기록 저장 및 UI 업데이트
      if (data.type !== 'system') {
        await this.saveNotificationRecord(data);
        
        // 메인 윈도우에 알림 기록 업데이트 알림 (안정성 강화)
        try {
          const allWindows = BrowserWindow.getAllWindows();
          const mainWindow = allWindows.find(win => 
            !win.isDestroyed() && 
            win.webContents && 
            !win.webContents.isDestroyed() &&
            win.webContents.getURL().includes('index.html')
          );
          
          if (mainWindow && mainWindow.webContents) {
            console.log(`[UI_UPDATE] Updating notification history for main window`);
            
            const notifications = await this.databaseManager.getNotifications({ limit: 100 });
            
            // webContents가 여전히 유효한지 다시 확인
            if (!mainWindow.webContents.isDestroyed()) {
              mainWindow.webContents.send('notification-history-updated', notifications);
              console.log(`[UI_UPDATE] Successfully sent notification-history-updated event with ${notifications.length} notifications`);
            } else {
              console.warn(`[UI_UPDATE] Main window webContents was destroyed before sending event`);
            }
          } else {
            console.warn(`[UI_UPDATE] No valid main window found for notification update`);
            console.log(`[UI_UPDATE] Available windows: ${allWindows.length}, destroyed: ${allWindows.filter(w => w.isDestroyed()).length}`);
          }
        } catch (uiUpdateError) {
          console.error(`[UI_UPDATE] Failed to update notification history:`, uiUpdateError);
        }
      }

      return result;
    } catch (error) {
      console.error('❌ Failed to send notification:', error);
      console.log(`📊 Final notification status: COMPLETELY_FAILED`);
      
      // 🚨 중요: 알림 실패 시 자동 URL 열기 완전 제거
      // 알림이 실패했을 때 URL을 자동으로 열지 않음 - 사용자 혼란 방지
      console.log(`⚠️ IMPORTANT: No automatic URL opening on notification failure`);
      console.log(`📝 Notification saved to history only - user can access via notification history`);
      console.log(`🔗 URL: ${data.url || 'No URL'}`);
      
      // 알림 실패해도 데이터베이스에는 저장 (사용자가 히스토리에서 확인 가능)
      try {
        if (data.type !== 'system') {
          await this.saveNotificationRecord(data);
          console.log(`💾 Notification saved to database despite display failure`);
        }
      } catch (saveError) {
        console.error('❌ Failed to save notification to database:', saveError);
      }
      
      return false; // 알림 표시 실패
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
      console.log(`[SAVE_NOTIFICATION] 💾 Saving notification record:`, {
        type: data.type,
        streamerName: data.streamerName,
        uniqueKey: data.uniqueKey,
        hasUrl: !!data.url,
        url: data.url,
        hasOriginalTimestamp: !!data.originalTimestamp,
        originalTimestamp: data.originalTimestamp?.toISOString()
      });

      if (data.type === 'weverse') {
        // 위버스 알림은 별도 메서드로 처리
        console.log(`[SAVE_NOTIFICATION] 🎵 Processing Weverse notification for ${data.streamerName}`);
        
        const weverseData = {
          artistName: data.streamerName,
          type: 'weverse' as const,
          title: data.title,
          content: data.content || '',
          url: data.url || '',
          uniqueKey: data.uniqueKey,
          profileImageUrl: data.profileImageUrl,
          isRead: false
        };
        
        console.log(`[SAVE_NOTIFICATION] 🎵 Weverse notification data:`, weverseData);
        console.log(`[SAVE_NOTIFICATION] 🎵 About to save to database - uniqueKey: ${data.uniqueKey}`);
        
        try {
          await this.databaseManager.addWeverseNotification(weverseData, data.originalTimestamp);
          console.log(`[SAVE_NOTIFICATION] ✅ Weverse notification saved successfully: ${data.uniqueKey}`);
          
          // 저장 후 즉시 확인
          const savedNotifications = await this.databaseManager.getNotifications({ type: 'weverse', limit: 5 });
          console.log(`[SAVE_NOTIFICATION] 📊 Weverse notifications in DB after save:`, savedNotifications.length);
          console.log(`[SAVE_NOTIFICATION] 📊 Latest saved notification:`, savedNotifications[0]);
          
          // 현재 uniqueKey로 저장된 알림 직접 확인
          const currentNotification = savedNotifications.find(n => n.uniqueKey === data.uniqueKey);
          if (currentNotification) {
            console.log(`[SAVE_NOTIFICATION] ✅ Current notification found in DB:`, currentNotification);
          } else {
            console.log(`[SAVE_NOTIFICATION] ❌ Current notification NOT found in DB with uniqueKey: ${data.uniqueKey}`);
          }
        } catch (dbError) {
          console.error(`[SAVE_NOTIFICATION] ❌ Database save failed for ${data.uniqueKey}:`, dbError);
          throw dbError;
        }
      } else {
        // 기존 스트리머 알림 처리
        console.log(`[SAVE_NOTIFICATION] 🎯 Processing regular streamer notification for ${data.streamerName}`);
        
        const streamers = await this.databaseManager.getStreamers();
        const streamer = streamers.find(s => s.name === data.streamerName);
        
        if (!streamer) {
          console.error(`[SAVE_NOTIFICATION] ❌ Streamer not found for notification: ${data.streamerName}`);
          console.log(`[SAVE_NOTIFICATION] Available streamers:`, streamers.map(s => s.name));
          return;
        }

        console.log(`[SAVE_NOTIFICATION] 🎯 Found streamer: ${streamer.name} (ID: ${streamer.id})`);

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

        console.log(`[SAVE_NOTIFICATION] 🎯 Regular notification data:`, record);
        
        await this.databaseManager.addNotification(record, data.originalTimestamp);
        
        console.log(`[SAVE_NOTIFICATION] ✅ Regular notification saved successfully: ${data.uniqueKey}`);
      }
    } catch (error) {
      console.error(`[SAVE_NOTIFICATION] ❌ Failed to save notification record for ${data.uniqueKey}:`, error);
      console.error(`[SAVE_NOTIFICATION] ❌ Error details:`, {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        dataType: data.type,
        streamerName: data.streamerName,
        uniqueKey: data.uniqueKey
      });
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

  createTitleChangeNotification(
    streamerName: string,
    previousTitle: string,
    newTitle: string,
    url: string,
    profileImageUrl?: string
  ): NotificationData {
    return {
      type: 'live',
      streamerName,
      title: `📝 ${streamerName}님이 방송 제목을 변경했습니다`,
      content: `${previousTitle} → ${newTitle}`,
      url,
      profileImageUrl,
      uniqueKey: `title_change_${streamerName}_${Date.now()}`
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

  createWeverseNotification(
    artistName: string,
    notificationTitle: string,
    url: string,
    profileImageUrl?: string,
    originalTimestamp?: Date,
    contentHtml?: string
  ): NotificationData {
    console.log(`[WEVERSE_CREATE] 🎵 Creating Weverse notification for ${artistName}`);
    console.log(`[WEVERSE_CREATE] Input parameters:`, {
      artistName,
      notificationTitle: notificationTitle.substring(0, 100),
      url,
      hasProfileImage: !!profileImageUrl,
      hasOriginalTimestamp: !!originalTimestamp,
      originalTimestamp: originalTimestamp?.toISOString(),
      hasContentHtml: !!contentHtml
    });
    
    // 🚨 개선된 위버스 uniqueKey 생성 (중복 방지)
    const urlId = this.extractWeverseId(url);
    const contentHash = this.createContentHash(notificationTitle, url);
    
    console.log(`[WEVERSE_CREATE] UniqueKey components:`, {
      artistName,
      urlId,
      contentHash,
      originalTimestamp: originalTimestamp?.toISOString(),
      url: url
    });
    
    // 🔑 고유성 보장: 아티스트 + URL ID + 내용 해시
    // 타임스탬프 제거 - 같은 게시물에 대해 일관된 키 생성
    const uniqueKey = `weverse_${artistName}_${urlId}_${contentHash}`;
    
    console.log(`[WEVERSE_CREATE] Generated uniqueKey: ${uniqueKey}`);
    
    const notificationData = {
      type: 'weverse' as const,
      streamerName: artistName,
      title: `🎵 ${artistName}님의 위버스`,
      content: notificationTitle,
      contentHtml: contentHtml,
      url,
      profileImageUrl,
      uniqueKey: uniqueKey,
      originalTimestamp
    };
    
    console.log(`[WEVERSE_CREATE] ✅ Weverse notification created successfully:`, {
      uniqueKey: notificationData.uniqueKey,
      title: notificationData.title,
      content: notificationData.content.substring(0, 100),
      url: notificationData.url
    });
    
    return notificationData;
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

  private extractWeverseId(url: string): string {
    console.log(`[EXTRACT_ID] 🔍 Extracting Weverse ID from URL: ${url}`);
    
    // 위버스 Live URL 형식: /live/2-161749779 또는 /live/2-161749779?params
    const liveMatch = url.match(/\/live\/([^?#]+)/);
    if (liveMatch) {
      console.log(`[EXTRACT_ID] ✅ Found Live ID: ${liveMatch[1]}`);
      return liveMatch[1];
    }
    
    // 위버스 일반 게시물 URL 형식: /artist/2-161749779 또는 /moment/2-161749779
    const postMatch = url.match(/\/(?:artist|moment|media)\/([^?#]+)/);
    if (postMatch) {
      console.log(`[EXTRACT_ID] ✅ Found Post ID: ${postMatch[1]}`);
      return postMatch[1];
    }
    
    // 위버스 아티스트 페이지 URL 형식: /artistname/live/2-161749779
    const artistLiveMatch = url.match(/\/[^/]+\/live\/([^?#]+)/);
    if (artistLiveMatch) {
      console.log(`[EXTRACT_ID] ✅ Found Artist Live ID: ${artistLiveMatch[1]}`);
      return artistLiveMatch[1];
    }
    
    // 위버스 아티스트 게시물 URL 형식: /artistname/artist/2-161749779
    const artistPostMatch = url.match(/\/[^/]+\/(?:artist|moment|media)\/([^?#]+)/);
    if (artistPostMatch) {
      console.log(`[EXTRACT_ID] ✅ Found Artist Post ID: ${artistPostMatch[1]}`);
      return artistPostMatch[1];
    }
    
    // 기존 방식 (숫자만 추출) - 백워드 호환성
    const numericMatch = url.match(/\/(\d+)(?:[?#]|$)/);
    if (numericMatch) {
      console.log(`[EXTRACT_ID] ✅ Found Numeric ID: ${numericMatch[1]}`);
      return numericMatch[1];
    }
    
    // 모든 패턴이 실패하면 URL 해시 사용 (타임스탬프 대신)
    const urlHash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
    console.log(`[EXTRACT_ID] ⚠️ No ID pattern matched, using URL hash: ${urlHash}`);
    return urlHash;
  }

  // 🚨 새로운 메서드: 내용 해시 생성 (중복 방지)
  private createContentHash(title: string, url: string): string {
    const hashContent = `${title}${url}`;
    return crypto.createHash('md5').update(hashContent).digest('hex').substring(0, 8);
  }

  // 알림 읽음 처리 (uniqueKey 기반)
  private async markNotificationAsReadByUniqueKey(uniqueKey: string): Promise<void> {
    try {
      console.log(`[MARK_READ] 📖 Attempting to mark notification as read: ${uniqueKey}`);
      
      // uniqueKey로 알림 찾아서 읽음 처리 (더 포괄적인 조회)
      const notifications = await this.databaseManager.getNotifications({ limit: 1000 });
      const notification = notifications.find(n => n.uniqueKey === uniqueKey);
      
      console.log(`[MARK_READ] Found notification:`, {
        found: !!notification,
        id: notification?.id,
        isRead: notification?.isRead,
        uniqueKey: notification?.uniqueKey,
        type: notification?.type,
        title: notification?.title?.substring(0, 50)
      });
      
      if (notification) {
        if (!notification.isRead) {
          await this.databaseManager.markNotificationAsRead(notification.id);
          console.log(`[MARK_READ] ✅ Marked notification as read: ${uniqueKey} (ID: ${notification.id})`);
        } else {
          console.log(`[MARK_READ] ℹ️ Notification already marked as read: ${uniqueKey} (ID: ${notification.id})`);
        }
        
        // UI 업데이트를 위해 메인 윈도우에 알림 (안정성 강화)
        try {
          const allWindows = BrowserWindow.getAllWindows();
          const mainWindow = allWindows.find(win => 
            !win.isDestroyed() && 
            win.webContents && 
            !win.webContents.isDestroyed() &&
            win.webContents.getURL().includes('index.html')
          );
          
          if (mainWindow && mainWindow.webContents) {
            const updatedNotifications = await this.databaseManager.getNotifications({ limit: 100 });
            
            if (!mainWindow.webContents.isDestroyed()) {
              mainWindow.webContents.send('notification-history-updated', updatedNotifications);
              console.log(`[UI_UPDATE] Notification marked as read, UI updated with ${updatedNotifications.length} notifications`);
            }
          }
        } catch (uiUpdateError) {
          console.error(`[UI_UPDATE] Failed to update UI after marking notification as read:`, uiUpdateError);
        }
      } else {
        console.error(`[MARK_READ] ❌ Notification not found with uniqueKey: ${uniqueKey}`);
        
        // 디버깅을 위한 추가 정보
        console.log(`[MARK_READ] Debug info:`, {
          totalNotifications: notifications.length,
          sampleUniqueKeys: notifications.slice(0, 5).map(n => n.uniqueKey),
          searchedUniqueKey: uniqueKey
        });
      }
    } catch (error) {
      console.error(`[MARK_READ] ❌ Failed to mark notification as read:`, error);
    }
  }

  // 기존의 개별 핸들러 생성 메서드들 제거됨 - 글로벌 핸들러로 대체

  // 앱 종료 시 정리 (글로벌 핸들러는 자동으로 정리됨)
  public cleanupAllHandlers(): void {
    try {
      this.activeNotifications.clear();
      this.processedNotifications.clear();
      this.notificationProcessingInProgress.clear();
      console.log('All active notifications and processed notifications cleared');
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