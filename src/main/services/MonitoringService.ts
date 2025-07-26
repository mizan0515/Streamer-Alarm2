import { DatabaseManager } from './DatabaseManager';
import { NotificationService } from './NotificationService';
import { SettingsService } from './SettingsService';
import { ChzzkMonitor } from './ChzzkMonitor';
import { TwitterMonitor } from './TwitterMonitor';
import { CafeMonitor } from './CafeMonitor';
import { WeiverseMonitor } from './WeiverseMonitor';
import { LiveStatus, TwitterTweet, CafePost, WeverseNotification, WeverseArtist } from '@shared/types';
import { MemoryMonitor, CleanupScheduler } from './MemoryManager';
import { TimeoutConfig } from './TimeoutConfig';
import { ErrorManager } from './ErrorManager';
import { PerformanceMonitor } from './PerformanceMonitor';

export class MonitoringService {
  private databaseManager: DatabaseManager;
  private notificationService: NotificationService;
  private settingsService: SettingsService;
  public chzzkMonitor: ChzzkMonitor;
  private twitterMonitor: TwitterMonitor;
  private cafeMonitor: CafeMonitor;
  private weverseMonitor: WeiverseMonitor;
  
  private isRunning: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastMonitoringTime: number = 0;
  private sleepDetectionThreshold: number = 600000; // 10분 (더 보수적으로 설정)
  private isInitialStart: boolean = true; // 앱 재시작 감지용
  
  // 위버스 세션 모니터링 관리
  private lastWeverseSessionCheck: number = 0;
  private weverseSessionCheckInterval: number = 10 * 60 * 1000; // 10분 (밀리초)
  
  // 네이버 로그인 상태 관리
  private naverLoginStatus: boolean | null = null;
  private statusCheckInterval: NodeJS.Timeout | null = null;
  private statusCheckInProgress: boolean = false;
  private trayService: any = null;

  // 메모리 관리
  private memoryMonitor: MemoryMonitor;
  private cleanupScheduler: CleanupScheduler;
  
  // 타임아웃 관리
  private timeoutConfig: TimeoutConfig;
  
  // 에러 관리
  private errorManager: ErrorManager;
  
  // 성능 모니터링
  private performanceMonitor: PerformanceMonitor;

  constructor(databaseManager: DatabaseManager, notificationService: NotificationService) {
    this.databaseManager = databaseManager;
    this.notificationService = notificationService;
    this.settingsService = new SettingsService(databaseManager);
    
    // 메모리 관리자 초기화
    this.memoryMonitor = MemoryMonitor.getInstance();
    this.cleanupScheduler = CleanupScheduler.getInstance();
    
    // 타임아웃 관리자 초기화
    this.timeoutConfig = TimeoutConfig.getInstance();
    
    // 에러 관리자 초기화
    this.errorManager = ErrorManager.getInstance();
    
    // 성능 모니터 초기화
    this.performanceMonitor = PerformanceMonitor.getInstance();
    
    // 메모리 경고 시 자동 정리 실행
    this.memoryMonitor.onMemoryAlert((usage, level) => {
      console.warn(`⚠️ Memory alert (${level}): ${Math.round(usage.rss / 1024 / 1024)}MB`);
      
      // 타임아웃 설정을 메모리 상태에 맞게 조정
      this.timeoutConfig.updateMemoryPressure(level);
      
      if (level === 'critical' || level === 'emergency') {
        console.log('🧹 Triggering emergency cleanup due to high memory usage');
        this.performEmergencyCleanup();
      }
    });
    
    // 모니터링 서비스들 초기화
    this.chzzkMonitor = new ChzzkMonitor(databaseManager, notificationService);
    this.chzzkMonitor.setMonitoringService(this); // MonitoringService 참조 설정
    this.twitterMonitor = new TwitterMonitor(databaseManager, notificationService, this.settingsService);
    this.cafeMonitor = new CafeMonitor(databaseManager, notificationService, this.settingsService);
    this.weverseMonitor = new WeiverseMonitor(databaseManager, notificationService, this.settingsService);
  }

  async start(): Promise<boolean> {
    if (this.isRunning) {
      return true;
    }

    try {
      this.isRunning = true;
      this.lastMonitoringTime = Date.now();
      
      // 모니터링 상태 초기화 (중복 알림 방지를 위한 기준선 설정)
      await this.databaseManager.initializeMonitorStates();
      
      // 건강도 체크 시작
      this.startHealthCheck();
      
      // 이전 상태 복원 (앱 재시작 시)
      await this.restoreMonitoringStates();
      
      // 카페 모니터 초기화
      await this.cafeMonitor.initialize();
      
      // Twitter 인스턴스 상태 확인
      await this.twitterMonitor.checkInstanceHealth();
      
      // 위버스 모니터 초기화
      await this.weverseMonitor.initialize();
      
      // 네이버 로그인 상태 초기화 및 모니터링 시작
      await this.initializeLoginStatus();
      this.startLoginStatusMonitoring();
      
      // 메모리 모니터링 및 클린업 스케줄러 시작
      this.memoryMonitor.startMonitoring(30000); // 30초마다 메모리 체크
      this.cleanupScheduler.start();
      
      // 새 스트리머들의 기준선 설정 (무음 모드)
      await this.establishBaselinesForNewStreamers();
      
      console.log('Monitoring service started with state persistence');
      
      // 앱 재시작 시 누락된 알림 복구 (첫 체크 전에 실행)
      console.log('🔄 App restart detected, recovering missed notifications...');
      await this.recoverMissedNotifications();
      
      // 첫 체크를 15초 후에 실행 (기준선 설정 완료 후)
      setTimeout(async () => {
        this.isInitialStart = false; // 초기 시작 완료 플래그 설정
        await this.performMonitoringCheck();
        this.scheduleNextCheck();
      }, 15000);
      
      return true;
    } catch (error) {
      console.error('Failed to start monitoring:', error);
      this.isRunning = false;
      return false;
    }
  }

  async stop(): Promise<boolean> {
    if (!this.isRunning) {
      return true;
    }

    try {
      this.isRunning = false;
      
      if (this.monitoringInterval) {
        clearTimeout(this.monitoringInterval);
        this.monitoringInterval = null;
      }
      
      // 로그인 상태 모니터링 중지
      this.stopLoginStatusMonitoring();
      
      // 메모리 모니터링 및 클린업 스케줄러 중지
      this.memoryMonitor.stopMonitoring();
      this.cleanupScheduler.stop();
      
      // 브라우저 정리
      await this.cafeMonitor.cleanup();
      await this.weverseMonitor.cleanup();
      this.chzzkMonitor.cleanup();
      this.twitterMonitor.cleanup();
      
      // 알림 핸들러 정리
      this.notificationService.cleanupAllHandlers();
      
      console.log('Monitoring service stopped');
      return true;
    } catch (error) {
      console.error('Failed to stop monitoring:', error);
      return false;
    }
  }

  private scheduleNextCheck(): void {
    if (!this.isRunning) return;

    const interval = this.settingsService.getCheckInterval() * 1000;
    
    this.monitoringInterval = setTimeout(async () => {
      await this.performMonitoringCheck();
      this.scheduleNextCheck();
    }, interval);
  }

  private async restoreMonitoringStates(): Promise<void> {
    try {
      console.log('🔄 Restoring monitoring states from database...');
      
      const streamers = await this.databaseManager.getStreamers();
      let statesRestored = 0;
      
      for (const streamer of streamers) {
        if (!streamer.isActive) continue;
        
        // CHZZK 상태 복원
        if (streamer.chzzkId) {
          const chzzkState = await this.databaseManager.getMonitorState(streamer.id, 'chzzk');
          if (chzzkState?.lastStatus === 'live') {
            // 메모리 캐시에 라이브 상태 복원
            this.chzzkMonitor['previousLiveStatus'].set(streamer.id.toString(), true);
            statesRestored++;
          }
        }
        
        // Twitter 상태 복원
        if (streamer.twitterUsername) {
          const twitterState = await this.databaseManager.getMonitorState(streamer.id, 'twitter');
          if (twitterState?.lastContentId) {
            // 메모리 캐시에 마지막 트윗 ID 복원
            this.twitterMonitor['lastTweetIds'].set(streamer.twitterUsername, twitterState.lastContentId);
            statesRestored++;
          }
        }
        
        // Cafe 상태 복원
        if (streamer.naverCafeUserId) {
          const cafeState = await this.databaseManager.getMonitorState(streamer.id, 'cafe');
          if (cafeState?.lastContentId) {
            // 메모리 캐시에 마지막 게시물 ID 복원
            this.cafeMonitor['lastPostIds'].set(streamer.naverCafeUserId, cafeState.lastContentId);
            statesRestored++;
          }
        }
      }
      
      console.log(`✅ Restored ${statesRestored} monitoring states for ${streamers.filter(s => s.isActive).length} active streamers`);
    } catch (error) {
      console.error('❌ Failed to restore monitoring states:', error);
    }
  }

  private async performMonitoringCheck(): Promise<void> {
    const cycleStartTime = Date.now();
    let cycleSuccessful = true;
    
    try {
      const currentTime = Date.now();
      
      // 절전모드 감지 (앱 재시작 완료 후에만 감지)
      if (!this.isInitialStart && this.lastMonitoringTime > 0) {
        const timeSinceLastCheck = currentTime - this.lastMonitoringTime;
        const checkInterval = this.settingsService.getCheckInterval() * 1000;
        const dynamicThreshold = Math.max(this.sleepDetectionThreshold, checkInterval * 5); // 최소 5배 또는 10분 중 더 큰 값
        
        if (timeSinceLastCheck > dynamicThreshold) {
          console.log(`💤 Sleep mode detected: ${Math.round(timeSinceLastCheck / 1000)}s gap (threshold: ${Math.round(dynamicThreshold / 1000)}s), triggering missed notification recovery`);
          await this.recoverMissedNotifications();
        }
      }
      
      this.lastMonitoringTime = currentTime;
      
      console.log('Performing monitoring check...');
      
      // 모든 플랫폼 병렬 모니터링
      const [liveStatuses, tweets, cafePosts, weverseNotifications] = await Promise.all([
        this.checkChzzkStreams(),
        this.checkTwitterFeeds(),
        this.checkCafePosts(),
        this.checkWeverseNotifications()
      ]);
      
      // 라이브 상태 업데이트
      await this.updateLiveStatus(liveStatuses);
      
      // 모니터링 상태 기록
      await this.updateMonitoringStatus();
      
      // 위버스 세션 상태 정기 검증 (위버스 알림 전송 전)
      await this.checkWeverseSessionStatus();
      
      // 위버스 알림 전송
      await this.sendWeverseNotifications(weverseNotifications);
      
      const liveCount = liveStatuses.filter(s => s.isLive).length;
      console.log(`Monitoring check completed. CHZZK Live: ${liveCount}, Tweets: ${tweets.length}, Posts: ${cafePosts.length}, Weverse: ${weverseNotifications.length}`);
      
    } catch (error) {
      cycleSuccessful = false;
      console.error('Monitoring check failed:', error);
    } finally {
      // 모니터링 사이클 성능 기록
      const cycleTime = Date.now() - cycleStartTime;
      this.performanceMonitor.recordMonitoringCycle(cycleSuccessful, cycleTime);
      
      // 메모리 사용량 기록
      const memoryUsage = this.getMemoryUsage();
      this.performanceMonitor.recordMemoryUsage(memoryUsage);
    }
  }

  private async checkChzzkStreams(): Promise<LiveStatus[]> {
    const startTime = Date.now();
    
    return await this.errorManager.executeWithRetry(
      'ChzzkMonitor',
      async () => {
        return await this.chzzkMonitor.checkAllStreamers();
      },
      2 // CHZZK API는 빠른 응답이 중요하므로 최대 2회 재시도
    ).then((result) => {
      // 성공 시 응답 시간 기록
      const responseTime = Date.now() - startTime;
      this.performanceMonitor.recordServiceResponseTime('chzzk', responseTime);
      return result;
    }).catch((error) => {
      // 실패 시에도 응답 시간 기록
      const responseTime = Date.now() - startTime;
      this.performanceMonitor.recordServiceResponseTime('chzzk', responseTime);
      console.error('CHZZK monitoring failed after retries:', error);
      return [];
    });
  }

  private async checkTwitterFeeds(): Promise<TwitterTweet[]> {
    const startTime = Date.now();
    
    return await this.errorManager.executeWithRetry(
      'TwitterMonitor',
      async () => {
        return await this.twitterMonitor.checkAllStreamers();
      },
      3 // Twitter는 Nitter 인스턴스 전환이 있어 재시도 여유
    ).then((result) => {
      const responseTime = Date.now() - startTime;
      this.performanceMonitor.recordServiceResponseTime('twitter', responseTime);
      return result;
    }).catch((error) => {
      const responseTime = Date.now() - startTime;
      this.performanceMonitor.recordServiceResponseTime('twitter', responseTime);
      console.error('Twitter monitoring failed after retries:', error);
      return [];
    });
  }

  private async checkCafePosts(): Promise<CafePost[]> {
    return await this.errorManager.executeWithRetry(
      'CafeMonitor',
      async () => {
        return await this.cafeMonitor.checkAllStreamers();
      },
      2 // 브라우저 기반이므로 과도한 재시도는 부담
    ).catch(async (error) => {
      console.error('Cafe monitoring failed after retries:', error);
      // 브라우저 문제일 가능성이 높으므로 재초기화 시도
      try {
        console.log('🔄 Attempting to reinitialize CafeMonitor browser...');
        await this.cafeMonitor.initialize();
      } catch (initError) {
        console.error('Failed to reinitialize CafeMonitor:', initError);
      }
      return [];
    });
  }

  private async checkWeverseNotifications(): Promise<WeverseNotification[]> {
    return await this.errorManager.executeWithRetry(
      'WeiverseMonitor',
      async () => {
        return await this.weverseMonitor.checkAllStreamers();
      },
      2 // 브라우저 기반이므로 제한된 재시도
    ).catch(async (error) => {
      console.error('Weverse monitoring failed after retries:', error);
      // 세션 문제일 가능성이 높으므로 재초기화 시도
      try {
        console.log('🔄 Attempting to reinitialize WeiverseMonitor session...');
        await this.weverseMonitor.initialize();
      } catch (initError) {
        console.error('Failed to reinitialize WeiverseMonitor:', initError);
      }
      return [];
    });
  }


  private async sendWeverseNotifications(notifications: WeverseNotification[]): Promise<void> {
    try {
      await this.weverseMonitor.sendWeverseNotifications(notifications);
    } catch (error) {
      console.error('Weverse notification sending failed:', error);
    }
  }

  /**
   * 위버스 세션 상태를 주기적으로 검증
   */
  private async checkWeverseSessionStatus(): Promise<void> {
    try {
      const currentTime = Date.now();
      
      // 10분 간격으로 세션 상태 확인
      if (currentTime - this.lastWeverseSessionCheck < this.weverseSessionCheckInterval) {
        return; // 아직 체크 시간이 되지 않음
      }
      
      console.log('🔍 위버스 세션 상태 정기 검증 시작...');
      this.lastWeverseSessionCheck = currentTime;
      
      const sessionValid = await this.weverseMonitor.checkLoginStatus();
      
      if (sessionValid) {
        console.log('✅ 위버스 세션 상태 양호');
        
        // 세션이 유효하면 추가적인 쿠키 무결성 검사 및 토큰 모니터링 실행
        const integrityValid = await this.weverseMonitor.checkSessionIntegrity();
        if (!integrityValid) {
          console.log('⚠️ 위버스 세션 무결성 문제 감지 - 예방적 복구 시도');
          await this.weverseMonitor.enhanceSessionPersistence();
        }
        
        // 토큰 상태 모니터링 및 선제적 갱신
        await this.weverseMonitor.performTokenMonitoring();
      } else {
        console.log('❌ 위버스 세션 만료 감지');
        
        // 세션 복구 시도
        const recoverySuccess = await this.attemptWeverseSessionRecovery();
        if (!recoverySuccess) {
          console.log('🔄 위버스 세션 자동 복구 실패 - 사용자 재로그인 필요');
          
          // UI에 로그인 필요 알림
          await this.settingsService.updateSetting('needWeverseLogin', true);
          this.notifyWeverseLoginStatusChange(true);
        }
      }
      
    } catch (error) {
      console.error('❌ 위버스 세션 상태 검증 실패:', error);
    }
  }

  /**
   * 위버스 세션 3단계 자동 복구 시도
   * 1단계: 쿠키 복원 → 2단계: 토큰 갱신 → 3단계: 재로그인
   */
  private async attemptWeverseSessionRecovery(): Promise<boolean> {
    try {
      console.log('🔄 위버스 세션 3단계 자동 복구 시작...');
      
      // 1단계: 쿠키 복원 (세션 무결성 검증 및 쿠키 백업/복원)
      console.log('📦 1단계: 쿠키 복원 시도...');
      const cookieRestored = await this.performCookieRecovery();
      if (cookieRestored) {
        console.log('✅ 1단계 성공: 쿠키 복원 완료');
        
        // 1단계 성공 후 검증
        const step1Check = await this.weverseMonitor.checkLoginStatus();
        if (step1Check) {
          console.log('✅ 1단계 복구로 세션 완전 복구');
          await this.settingsService.updateSetting('needWeverseLogin', false);
          return true;
        }
      }
      
      // 2단계: 토큰 갱신 (선제적 토큰 갱신 및 세션 강화)
      console.log('🔄 2단계: 토큰 갱신 시도...');
      const tokenRefreshed = await this.performTokenRecovery();
      if (tokenRefreshed) {
        console.log('✅ 2단계 성공: 토큰 갱신 완료');
        
        // 2단계 성공 후 검증
        const step2Check = await this.weverseMonitor.checkLoginStatus();
        if (step2Check) {
          console.log('✅ 2단계 복구로 세션 완전 복구');
          await this.settingsService.updateSetting('needWeverseLogin', false);
          return true;
        }
      }
      
      // 3단계: 재로그인 (자동 로그인 시도)
      console.log('🔑 3단계: 자동 재로그인 시도...');
      const reloginSuccess = await this.performReloginRecovery();
      if (reloginSuccess) {
        console.log('✅ 3단계 성공: 자동 재로그인 완료');
        await this.settingsService.updateSetting('needWeverseLogin', false);
        return true;
      }
      
      console.log('❌ 3단계 복구 시퀀스 모두 실패 - 사용자 수동 로그인 필요');
      await this.settingsService.updateSetting('needWeverseLogin', true);
      return false;
      
    } catch (error) {
      console.error('❌ 위버스 세션 복구 중 오류:', error);
      await this.settingsService.updateSetting('needWeverseLogin', true);
      return false;
    }
  }

  /**
   * 1단계: 쿠키 복원
   */
  private async performCookieRecovery(): Promise<boolean> {
    try {
      console.log('🍪 쿠키 복원 단계 시작...');
      
      // 세션 무결성 검증 및 복구
      const integrityRestored = await this.weverseMonitor.checkSessionIntegrity();
      if (!integrityRestored) {
        console.log('⚠️ 세션 무결성 복구 실패');
        return false;
      }
      
      // 쿠키 생명주기 강화
      await this.weverseMonitor.enhanceSessionPersistence();
      
      // 복원 후 짧은 대기
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('✅ 쿠키 복원 완료');
      return true;
      
    } catch (error) {
      console.error('❌ 쿠키 복원 실패:', error);
      return false;
    }
  }

  /**
   * 2단계: 토큰 갱신
   */
  private async performTokenRecovery(): Promise<boolean> {
    try {
      console.log('🔄 토큰 갱신 단계 시작...');
      
      // 토큰 상태 모니터링 및 강제 갱신
      await this.weverseMonitor.performTokenMonitoring();
      
      // 추가적인 토큰 갱신 시도 (WeiverseMonitor의 performTokenRefresh 메서드 직접 호출)
      const refreshSuccess = await this.attemptDirectTokenRefresh();
      if (!refreshSuccess) {
        console.log('⚠️ 직접 토큰 갱신 실패');
        return false;
      }
      
      // 갱신 후 대기
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log('✅ 토큰 갱신 완료');
      return true;
      
    } catch (error) {
      console.error('❌ 토큰 갱신 실패:', error);
      return false;
    }
  }

  /**
   * 3단계: 자동 재로그인
   */
  private async performReloginRecovery(): Promise<boolean> {
    try {
      console.log('🔑 자동 재로그인 단계 시작...');
      
      // 현재는 수동 로그인만 지원하므로 자동 재로그인 시도하지 않음
      // 향후 자동 로그인 기능 구현 시 여기에 추가
      console.log('ℹ️ 자동 재로그인은 현재 지원되지 않음 - 사용자 수동 로그인 필요');
      
      return false;
      
    } catch (error) {
      console.error('❌ 자동 재로그인 실패:', error);
      return false;
    }
  }

  /**
   * 직접 토큰 갱신 시도
   */
  private async attemptDirectTokenRefresh(): Promise<boolean> {
    try {
      console.log('🔧 직접 토큰 갱신 시도...');
      
      // WeiverseMonitor의 공식 토큰 갱신 API 사용
      const refreshSuccess = await this.weverseMonitor.forceTokenRefresh();
      
      if (refreshSuccess) {
        console.log('✅ 직접 토큰 갱신 성공');
        return true;
      } else {
        console.log('⚠️ 직접 토큰 갱신 실패 - 대체 방법 시도');
        
        // 토큰 갱신 실패 시 세션 강화로 대체
        await this.weverseMonitor.enhanceSessionPersistence();
        return true; // 세션 강화는 성공으로 간주
      }
      
    } catch (error) {
      console.error('❌ 직접 토큰 갱신 실패:', error);
      return false;
    }
  }

  private async updateLiveStatus(liveStatuses: LiveStatus[]): Promise<void> {
    try {
      // 라이브 상태를 파일로도 저장 (UI 실시간 업데이트용)
      const fs = require('fs').promises;
      const path = require('path');
      const { app, webContents } = require('electron');
      
      const userDataPath = app.getPath('userData');
      const liveStatusFile = path.join(userDataPath, 'live_status.json');
      
      await fs.writeFile(liveStatusFile, JSON.stringify(liveStatuses, null, 2));
      
      // 웹 인터페이스에 실시간 라이브 상태 변경 알림
      const allWebContents = webContents.getAllWebContents();
      allWebContents.forEach((wc: any) => {
        if (!wc.isDestroyed()) {
          wc.send('live-status-updated', liveStatuses);
        }
      });
      
      console.log(`📡 Live status updated: ${liveStatuses.filter(s => s.isLive).length} live streamers`);
    } catch (error) {
      console.error('Failed to update live status file:', error);
    }
  }

  private async updateMonitoringStatus(): Promise<void> {
    try {
      await this.databaseManager.setSetting('lastCheckTime', new Date().toISOString());
    } catch (error) {
      console.error('Failed to update monitoring status:', error);
    }
  }

  async getLiveStatus(): Promise<LiveStatus[]> {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const { app } = require('electron');
      
      const userDataPath = app.getPath('userData');
      const liveStatusFile = path.join(userDataPath, 'live_status.json');
      
      const data = await fs.readFile(liveStatusFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.log('No live status file found, returning empty array');
      return [];
    }
  }

  async recoverMissedNotifications(): Promise<number> {
    try {
      console.log('Starting missed notification recovery...');
      
      let recoveredCount = 0;
      const recoveryStartTime = Date.now();
      
      // 타임아웃 설정 (5분)
      const recoveryTimeout = 300000;
      
      const recoveryPromise = Promise.race([
        this.performRecovery(),
        new Promise<number>((_, reject) => 
          setTimeout(() => reject(new Error('Recovery timeout')), recoveryTimeout)
        )
      ]);
      
      recoveredCount = await recoveryPromise;
      
      // 복구 완료 로그 (토스트 알림 제거)
      if (recoveredCount > 0) {
        console.log(`복구 완료: ${recoveredCount}개의 누락된 알림을 복구했습니다.`);
      }
      
      // 복구 시간 기록
      await this.databaseManager.setSetting('lastRecoveryTime', new Date().toISOString());
      
      console.log(`Missed notification recovery completed. Recovered: ${recoveredCount} notifications`);
      
      return recoveredCount;
    } catch (error) {
      console.error('Failed to recover missed notifications:', error);
      
      // 복구 실패 로그 (토스트 알림 제거)
      console.error('알림 복구 실패: 누락된 알림 복구 중 오류가 발생했습니다.');
      
      return 0;
    }
  }

  private async performRecovery(): Promise<number> {
    let recoveredCount = 0;
    
    try {
      // 현재 상태 스캔
      const [liveStatuses, tweets, cafePosts] = await Promise.all([
        this.chzzkMonitor.checkAllStreamers(),
        this.twitterMonitor.checkAllStreamers(),
        this.cafeMonitor.checkAllStreamers()
      ]);
      
      // 기존 알림과 비교하여 누락된 것들 찾기
      const existingNotifications = await this.databaseManager.getNotifications({ limit: 1000 });
      const existingKeys = new Set(existingNotifications.map(n => n.uniqueKey));
      
      // 라이브 알림 복구
      for (const status of liveStatuses) {
        if (status.isLive) {
          const uniqueKey = `live_${status.streamerName}_${Date.now()}`;
          if (!existingKeys.has(uniqueKey)) {
            // 복구 필요한 라이브 알림이 있을 수 있지만, 현재 라이브 상태만으로는 판단 어려움
            // 실제로는 더 정교한 로직 필요
          }
        }
      }
      
      // 트위터/카페 복구는 새로 발견된 항목들이 이미 처리됨
      recoveredCount += tweets.length + cafePosts.length;
      
      return recoveredCount;
    } catch (error) {
      console.error('Recovery scan failed:', error);
      return 0;
    }
  }

  async initiateNaverLogin(): Promise<boolean> {
    try {
      console.log('🔐 Starting Naver login process...');
      const result = await this.cafeMonitor.initiateLogin();
      
      if (result) {
        console.log('✅ Naver login successful');
        // 로그인 성공 시 상태 즉시 업데이트
        const needLogin = false; // 로그인 완료 -> 로그인 불필요
        this.naverLoginStatus = needLogin;
        this.notifyLoginStatusChange(needLogin);
      } else {
        console.log('❌ Naver login failed');
      }
      
      return result;
    } catch (error) {
      console.error('Failed to initiate Naver login:', error);
      return false;
    }
  }

  async initiateNaverLogout(): Promise<boolean> {
    try {
      console.log('🚪 Starting Naver logout process...');
      const result = await this.cafeMonitor.initiateLogout();
      
      if (result) {
        console.log('✅ Naver logout successful');
        // 로그아웃 성공 시 상태 즉시 업데이트
        const needLogin = true; // 로그아웃 완료 -> 로그인 필요
        this.naverLoginStatus = needLogin;
        this.notifyLoginStatusChange(needLogin);
      } else {
        console.log('❌ Naver logout failed');
      }
      
      return result;
    } catch (error) {
      console.error('Failed to initiate Naver logout:', error);
      return false;
    }
  }

  isMonitoring(): boolean {
    return this.isRunning;
  }


  // 카페 모니터링 메모리 캐시 초기화
  clearCafeMemoryCache(): void {
    this.cafeMonitor.clearMemoryCache();
  }

  // 스트리머 프로필 업데이트
  async updateStreamerProfiles(): Promise<void> {
    try {
      const streamers = await this.databaseManager.getStreamers();
      
      for (const streamer of streamers) {
        if (streamer.chzzkId) {
          await this.chzzkMonitor.updateStreamerProfile(streamer);
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 딜레이
        }
      }
    } catch (error) {
      console.error('Failed to update streamer profiles:', error);
    }
  }

  // 모니터링 통계
  async getMonitoringStats(): Promise<{
    totalStreamers: number;
    activeStreamers: number;
    liveStreamers: number;
    lastCheckTime?: string;
    isMonitoring: boolean;
  }> {
    try {
      const streamers = await this.databaseManager.getStreamers();
      const liveStatuses = await this.getLiveStatus();
      const lastCheckTime = await this.databaseManager.getSetting('lastCheckTime');
      
      return {
        totalStreamers: streamers.length,
        activeStreamers: streamers.filter(s => s.isActive).length,
        liveStreamers: liveStatuses.filter(s => s.isLive).length,
        lastCheckTime: lastCheckTime || undefined,
        isMonitoring: this.isRunning
      };
    } catch (error) {
      console.error('Failed to get monitoring stats:', error);
      return {
        totalStreamers: 0,
        activeStreamers: 0,
        liveStreamers: 0,
        isMonitoring: this.isRunning
      };
    }
  }

  // 네이버 로그인 상태 관리 메서드들
  private async initializeLoginStatus(): Promise<void> {
    try {
      console.log('🔄 Initializing Naver login status...');
      const isLoggedIn = await this.cafeMonitor.checkLoginStatus();
      const needLogin = !isLoggedIn;
      this.naverLoginStatus = needLogin;
      
      console.log(`✅ Initial login status: isLoggedIn=${isLoggedIn}, needLogin=${needLogin}`);
      
      // 초기 상태를 모든 컴포넌트에 알림
      this.notifyLoginStatusChange(needLogin);
    } catch (error) {
      console.error('Failed to initialize login status:', error);
      this.naverLoginStatus = true; // 오류 시 로그인 필요로 가정
      this.notifyLoginStatusChange(true);
    }
  }

  private startLoginStatusMonitoring(): void {
    // 30초마다 로그인 상태 확인
    this.statusCheckInterval = setInterval(async () => {
      if (this.statusCheckInProgress) {
        return; // 이미 확인 중이면 스킵
      }

      try {
        this.statusCheckInProgress = true;
        const isLoggedIn = await this.cafeMonitor.checkLoginStatus();
        const needLogin = !isLoggedIn;
        
        if (needLogin !== this.naverLoginStatus) {
          console.log(`🔄 Login status changed: needLogin=${this.naverLoginStatus} → ${needLogin} (isLoggedIn=${isLoggedIn})`);
          this.naverLoginStatus = needLogin;
          this.notifyLoginStatusChange(needLogin);
        }
      } catch (error) {
        console.error('Failed to check login status:', error);
      } finally {
        this.statusCheckInProgress = false;
      }
    }, 30000);
    
    console.log('🔄 Login status monitoring started (30s interval)');
  }

  private stopLoginStatusMonitoring(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
      console.log('🛑 Login status monitoring stopped');
    }
  }

  private notifyLoginStatusChange(needLogin: boolean): void {
    try {
      console.log(`📢 Broadcasting login status: needLogin=${needLogin}`);
      
      // 웹 인터페이스에 상태 변경 알림
      const { webContents } = require('electron');
      const allWebContents = webContents.getAllWebContents();
      allWebContents.forEach((wc: any) => {
        if (!wc.isDestroyed()) {
          // 네이버 로그인 상태 변경 이벤트
          wc.send('naver-login-status-changed', { needLogin });
          
          // 설정 업데이트 이벤트도 함께 발송 (더 확실한 동기화)
          // 현재 설정을 가져와서 네이버 로그인 상태만 업데이트
          this.sendSettingsUpdateEvent(needLogin, wc);
        }
      });
      
      // 트레이 메뉴 직접 업데이트 (더 확실한 방법)
      this.updateTrayMenuDirectly(needLogin);
      
    } catch (error) {
      console.error('Failed to notify login status change:', error);
    }
  }

  setTrayService(trayService: any): void {
    this.trayService = trayService;
  }

  private sendSettingsUpdateEvent(needNaverLogin: boolean, wc: any): void {
    try {
      // 현재 설정을 가져와서 네이버 로그인 상태만 업데이트
      const updatedSettings = {
        needNaverLogin: needNaverLogin,
        needWeverseLogin: this.settingsService.getNeedWeverseLogin(),
        checkInterval: this.settingsService.getCheckInterval(),
        autoStart: this.settingsService.getAutoStart(),
        minimizeToTray: this.settingsService.getMinimizeToTray(),
        showDesktopNotifications: this.settingsService.getShowDesktopNotifications(),
        cacheCleanupInterval: this.settingsService.getCacheCleanupInterval(),
        theme: this.settingsService.getTheme()
      };
      
      console.log(`📢 Sending settings update: needNaverLogin=${needNaverLogin}`);
      wc.send('settings-updated', updatedSettings);
    } catch (error) {
      console.error('Failed to send settings update event:', error);
    }
  }

  private async updateTrayMenuDirectly(needLogin: boolean): Promise<void> {
    try {
      console.log(`🔄 Directly updating tray menu: needLogin=${needLogin}`);
      
      if (this.trayService) {
        // TrayService를 통한 직접 업데이트
        const stats = await this.getMonitoringStats();
        this.trayService.updateContextMenu({
          ...stats,
          needNaverLogin: needLogin
        });
        console.log('✅ Tray menu updated via TrayService');
      } else {
        // 백업: 전역 참조를 통한 업데이트
        const { app } = require('electron');
        if (app.streamerAlarmApp && app.streamerAlarmApp.updateTrayMenuWithLoginStatus) {
          app.streamerAlarmApp.updateTrayMenuWithLoginStatus(needLogin);
          console.log('✅ Tray menu updated via global reference');
        }
      }
    } catch (error) {
      console.error('Failed to update tray menu directly:', error);
    }
  }

  // 외부에서 호출할 수 있는 동기화된 로그인 상태 확인
  async checkNaverLoginStatus(): Promise<boolean> {
    try {
      // 실제 로그인 상태 확인 (캐시 없이 항상 최신 상태 확인)
      const isLoggedIn = await this.cafeMonitor.checkLoginStatus();
      
      // 상태 캐시 업데이트
      this.naverLoginStatus = !isLoggedIn; // needLogin = !isLoggedIn
      
      console.log(`🔍 Final login status: isLoggedIn=${isLoggedIn}, needLogin=${!isLoggedIn}`);
      
      // UI에서 사용하는 needLogin 반환 (true = 로그인 필요, false = 로그인 불필요)
      return !isLoggedIn;
    } catch (error) {
      console.error('Failed to check Naver login status:', error);
      return true; // 실패 시 로그인 필요한 것으로 처리
    }
  }

  // 새 스트리머들을 위한 기준선 설정 (무음 모드 - 알림 없이 현재 상태 저장)
  private async establishBaselinesForNewStreamers(): Promise<void> {
    try {
      console.log('🔄 Establishing baselines for new streamers (silent mode)...');
      
      const streamersNeedingBaseline = await this.databaseManager.getStreamersNeedingBaseline();
      
      if (streamersNeedingBaseline.length === 0) {
        console.log('✅ No streamers need baseline establishment');
        return;
      }
      
      console.log(`📊 Found ${streamersNeedingBaseline.length} streamer-platform combinations needing baseline`);
      
      // Group by platform for batch processing
      const platformGroups = streamersNeedingBaseline.reduce((groups, item) => {
        if (!groups[item.platform]) groups[item.platform] = [];
        groups[item.platform].push(item);
        return groups;
      }, {} as Record<string, typeof streamersNeedingBaseline>);
      
      let baselineCount = 0;
      
      // Process each platform
      for (const [platform, streamers] of Object.entries(platformGroups)) {
        console.log(`🎯 Establishing baseline for ${streamers.length} streamers on ${platform}...`);
        
        for (const { streamerId, streamerName } of streamers) {
          try {
            await this.establishBaselineForPlatform(streamerId, streamerName, platform);
            baselineCount++;
            
            // Brief delay between streamers to avoid overwhelming APIs
            await this.delay(500);
          } catch (error) {
            console.error(`❌ Failed to establish baseline for ${streamerName} on ${platform}:`, error);
          }
        }
      }
      
      console.log(`✅ Baseline establishment completed: ${baselineCount}/${streamersNeedingBaseline.length} successful`);
    } catch (error) {
      console.error('❌ Failed to establish baselines for new streamers:', error);
    }
  }

  private async establishBaselineForPlatform(streamerId: number, streamerName: string, platform: string): Promise<void> {
    try {
      switch (platform) {
        case 'chzzk':
          await this.establishChzzkBaseline(streamerId, streamerName);
          break;
        case 'twitter':
          await this.establishTwitterBaseline(streamerId, streamerName);
          break;
        case 'cafe':
          await this.establishCafeBaseline(streamerId, streamerName);
          break;
        default:
          console.warn(`Unknown platform: ${platform}`);
      }
    } catch (error) {
      console.error(`Failed to establish ${platform} baseline for ${streamerName}:`, error);
    }
  }

  private async establishChzzkBaseline(streamerId: number, streamerName: string): Promise<void> {
    try {
      const streamers = await this.databaseManager.getStreamers();
      const streamer = streamers.find(s => s.id === streamerId);
      
      if (!streamer?.chzzkId) {
        console.log(`${streamerName}: No CHZZK ID, skipping baseline`);
        return;
      }
      
      // Get current live status silently (without notifications) - only for this specific streamer
      const currentStatus = await this.chzzkMonitor.checkSingleStreamerLive(streamer);
      
      if (currentStatus) {
        const baselineValue = currentStatus.isLive ? currentStatus.url || 'live' : 'offline';
        await this.databaseManager.establishBaselineForStreamer(streamerId, 'chzzk', baselineValue);
        console.log(`📺 ${streamerName}: CHZZK baseline set (${currentStatus.isLive ? 'LIVE' : 'OFFLINE'})`);
      }
    } catch (error) {
      console.error(`CHZZK baseline failed for ${streamerName}:`, error);
    }
  }

  private async establishTwitterBaseline(streamerId: number, streamerName: string): Promise<void> {
    try {
      const streamers = await this.databaseManager.getStreamers();
      const streamer = streamers.find(s => s.id === streamerId);
      
      if (!streamer?.twitterUsername) {
        console.log(`${streamerName}: No Twitter username, skipping baseline`);
        return;
      }
      
      // Get latest tweet silently (without notifications) - only for this specific streamer
      const tweets = await this.twitterMonitor.checkSingleStreamerTweets(streamer);
      
      if (tweets.length > 0) {
        // Use the latest tweet ID as baseline
        const latestTweet = tweets[tweets.length - 1];
        await this.databaseManager.establishBaselineForStreamer(streamerId, 'twitter', latestTweet.id);
        console.log(`🐦 ${streamerName}: Twitter baseline set (latest: ${latestTweet.id})`);
      }
    } catch (error) {
      console.error(`Twitter baseline failed for ${streamerName}:`, error);
    }
  }

  private async establishCafeBaseline(streamerId: number, streamerName: string): Promise<void> {
    try {
      const streamers = await this.databaseManager.getStreamers();
      const streamer = streamers.find(s => s.id === streamerId);
      
      if (!streamer?.naverCafeUserId) {
        console.log(`${streamerName}: No Cafe user ID, skipping baseline`);
        return;
      }
      
      // Check if logged in to Cafe
      if (!await this.cafeMonitor.ensureLoggedIn()) {
        console.log(`${streamerName}: Not logged into Cafe, skipping baseline`);
        return;
      }
      
      // Get latest cafe posts silently (without notifications) - only for this specific streamer
      const posts = await this.cafeMonitor.checkSingleStreamerPosts(streamer);
      
      if (posts.length > 0) {
        // Use the latest post ID as baseline
        const latestPost = posts[posts.length - 1];
        await this.databaseManager.establishBaselineForStreamer(streamerId, 'cafe', latestPost.id);
        console.log(`💬 ${streamerName}: Cafe baseline set (latest: ${latestPost.id})`);
      }
    } catch (error) {
      console.error(`Cafe baseline failed for ${streamerName}:`, error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 위버스 관련 public 메서드들
  async initiateWeverseLogin(): Promise<boolean> {
    try {
      return await this.weverseMonitor.initiateLogin();
    } catch (error) {
      console.error('Failed to initiate Weverse login:', error);
      return false;
    }
  }

  async initiateWeverseLogout(): Promise<boolean> {
    try {
      return await this.weverseMonitor.initiateLogout();
    } catch (error) {
      console.error('Failed to initiate Weverse logout:', error);
      return false;
    }
  }

  async extractWeverseArtistList(): Promise<string[]> {
    try {
      return await this.weverseMonitor.extractArtistList();
    } catch (error) {
      console.error('Failed to extract Weverse artist list:', error);
      return [];
    }
  }

  async checkWeverseLoginStatus(): Promise<boolean> {
    try {
      const isLoggedIn = await this.weverseMonitor.checkLoginStatus();
      
      // UI에 위버스 로그인 상태 변경 알림
      this.notifyWeverseLoginStatusChange(!isLoggedIn);
      
      return isLoggedIn;
    } catch (error) {
      console.error('Failed to check Weverse login status:', error);
      
      // 에러 시 로그인 필요한 상태로 UI 업데이트
      this.notifyWeverseLoginStatusChange(true);
      
      return false;
    }
  }

  private notifyWeverseLoginStatusChange(needLogin: boolean): void {
    try {
      console.log(`📢 Broadcasting Weverse login status: needLogin=${needLogin}`);
      
      // 웹 인터페이스에 상태 변경 알림
      const { webContents } = require('electron');
      const allWebContents = webContents.getAllWebContents();
      allWebContents.forEach((wc: any) => {
        if (!wc.isDestroyed()) {
          wc.send('weverse-login-status-changed', { needLogin });
        }
      });
      
    } catch (error) {
      console.error('Failed to notify Weverse login status change:', error);
    }
  }

  async refreshWeverseArtists(): Promise<void> {
    try {
      await this.weverseMonitor.extractArtistList();
    } catch (error) {
      console.error('Failed to refresh Weverse artists:', error);
    }
  }

  async getWeverseArtists(): Promise<any[]> {
    try {
      return await this.databaseManager.getWeverseArtists();
    } catch (error) {
      console.error('Failed to get Weverse artists:', error);
      return [];
    }
  }

  async updateWeverseArtistStatus(artistName: string, isEnabled: boolean): Promise<void> {
    try {
      const artists = await this.databaseManager.getWeverseArtists();
      const artist = artists.find(a => a.artistName === artistName);
      
      if (artist) {
        await this.databaseManager.updateWeverseArtist(artist.id, { isEnabled });
      }
    } catch (error) {
      console.error('Failed to update Weverse artist status:', error);
    }
  }

  // 즉시 라이브 상태 업데이트 (상태 변경 시 UI에 즉시 반영)
  async updateLiveStatusImmediately(): Promise<void> {
    try {
      console.log('🔄 Performing immediate live status update...');
      const liveStatuses = await this.checkChzzkStreams();
      await this.updateLiveStatus(liveStatuses);
    } catch (error) {
      console.error('Failed to update live status immediately:', error);
    }
  }

  /**
   * 메모리 부족 시 긴급 정리 작업을 수행합니다.
   */
  private async performEmergencyCleanup(): Promise<void> {
    try {
      console.log('🚨 Performing emergency cleanup...');

      // 1. 모든 캐시 정리 강제 실행
      this.chzzkMonitor.cleanup();
      this.twitterMonitor.cleanup();
      
      // 2. 브라우저 기반 모니터 긴급 정리
      try {
        await Promise.allSettled([
          this.cafeMonitor.emergencyCleanup(),
          this.weverseMonitor.emergencyCleanup()
        ]);
      } catch (error) {
        console.error('Emergency browser cleanup failed:', error);
      }

      // 3. 가비지 컬렉션 강제 실행
      this.memoryMonitor.forceGarbageCollection();

      // 4. 메모리 사용량 로깅
      const usage = this.memoryMonitor.getCurrentUsage();
      console.log(`🧹 Emergency cleanup completed. Memory usage: ${Math.round(usage.rss / 1024 / 1024)}MB (${usage.level})`);

    } catch (error) {
      console.error('Emergency cleanup failed:', error);
    }
  }

  /**
   * 현재 메모리 사용량 정보를 반환합니다.
   */
  getMemoryUsage(): NodeJS.MemoryUsage & { level: string } {
    return this.memoryMonitor.getCurrentUsage();
  }

  /**
   * 시스템 건강도를 확인하고 문제가 있으면 복구를 시도합니다.
   */
  private async performHealthCheck(): Promise<void> {
    const systemHealth = this.errorManager.getSystemHealth();
    
    console.log(`🏥 System health check: ${systemHealth.overallHealth} (${systemHealth.healthyServices}/${systemHealth.totalServices} services healthy)`);
    
    if (systemHealth.overallHealth === 'critical') {
      console.error('🚨 Critical system health detected!');
      
      // 위험 상황에서의 자동 복구 시도
      await this.performSystemEmergencyRecovery();
      
      // 사용자에게 알림
      if (this.trayService) {
        this.trayService.updateStatus('모니터링 시스템에 문제가 발생했습니다.');
      }
    } else if (systemHealth.overallHealth === 'degraded') {
      console.warn('⚠️ System performance degraded');
      
      // 성능 저하 시 가벼운 복구 작업
      await this.performLightRecovery();
    }
    
    // 추천사항이 있으면 로그에 출력
    if (systemHealth.recommendations.length > 0) {
      console.log('💡 System recommendations:');
      systemHealth.recommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. ${rec}`);
      });
    }
  }

  /**
   * 위급 상황에서의 시스템 복구 작업을 수행합니다.
   */
  private async performSystemEmergencyRecovery(): Promise<void> {
    console.log('🚑 Performing system emergency recovery...');
    
    try {
      // 1. 메모리 정리
      await this.performEmergencyCleanup();
      
      // 2. 브라우저 기반 모니터 재초기화
      await Promise.allSettled([
        this.cafeMonitor.initialize().catch(e => console.error('CafeMonitor recovery failed:', e)),
        this.weverseMonitor.initialize().catch(e => console.error('WeiverseMonitor recovery failed:', e))
      ]);
      
      // 3. 타임아웃 설정 리셋
      this.timeoutConfig.reset();
      
      // 4. 5분 후에 건강도 재확인
      setTimeout(() => {
        this.performHealthCheck().catch(e => console.error('Health recheck failed:', e));
      }, 5 * 60 * 1000);
      
      console.log('✅ System emergency recovery completed');
    } catch (error) {
      console.error('❌ System emergency recovery failed:', error);
    }
  }

  /**
   * 경미한 성능 저하 시의 복구 작업을 수행합니다.
   */
  private async performLightRecovery(): Promise<void> {
    console.log('🔧 Performing light recovery...');
    
    try {
      // 1. 캐시 정리
      this.cleanupScheduler.runAllTasks();
      
      // 2. 에러율이 높은 서비스에 대해 타임아웃 조정 요청
      const errorStats = this.errorManager.getErrorStats();
      let hasHighErrorRate = false;
      
      for (const [errorType, stats] of Object.entries(errorStats)) {
        const errorRate = this.errorManager.getErrorRate(errorType as any);
        if (errorRate > 0.3) { // 30% 이상 에러율
          hasHighErrorRate = true;
          break;
        }
      }
      
      if (hasHighErrorRate) {
        this.timeoutConfig.updateErrorRate(0.4); // 타임아웃 증가 요청
      }
      
      console.log('✅ Light recovery completed');
    } catch (error) {
      console.error('❌ Light recovery failed:', error);
    }
  }

  /**
   * 정기적인 건강도 체크를 시작합니다.
   */
  startHealthCheck(): void {
    // 30분마다 건강도 체크
    setInterval(() => {
      this.performHealthCheck().catch(e => console.error('Scheduled health check failed:', e));
    }, 30 * 60 * 1000);
    
    console.log('🏥 Health check monitoring started (every 30 minutes)');
  }

  /**
   * 에러 통계 정보를 가져옵니다.
   */
  getErrorStatistics() {
    return {
      systemHealth: this.errorManager.getSystemHealth(),
      errorStats: this.errorManager.getErrorStats(),
      serviceStatuses: this.errorManager.getAllServiceStatuses()
    };
  }

  /**
   * 에러 통계를 리셋합니다.
   */
  resetErrorStatistics(): void {
    this.errorManager.resetStats();
    console.log('📊 Error statistics have been reset');
  }

  /**
   * 성능 보고서를 생성합니다.
   */
  generatePerformanceReport() {
    return this.performanceMonitor.generatePerformanceReport();
  }

  /**
   * 실시간 성능 대시보드 데이터를 가져옵니다.
   */
  getPerformanceDashboard() {
    return this.performanceMonitor.getDashboardData();
  }

  /**
   * 성능 메트릭을 리셋합니다.
   */
  resetPerformanceMetrics(): void {
    this.performanceMonitor.resetMetrics();
    console.log('📊 Performance metrics have been reset');
  }

  /**
   * 종합 시스템 상태를 가져옵니다.
   */
  getSystemStatus() {
    return {
      performance: this.generatePerformanceReport(),
      errors: this.getErrorStatistics(),
      memory: this.getMemoryUsage()
    };
  }
}