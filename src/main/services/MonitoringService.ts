import { DatabaseManager } from './DatabaseManager';
import { NotificationService } from './NotificationService';
import { SettingsService } from './SettingsService';
import { ChzzkMonitor } from './ChzzkMonitor';
import { TwitterMonitor } from './TwitterMonitor';
import { CafeMonitor } from './CafeMonitor';
import { LiveStatus, TwitterTweet, CafePost } from '@shared/types';

export class MonitoringService {
  private databaseManager: DatabaseManager;
  private notificationService: NotificationService;
  private settingsService: SettingsService;
  public chzzkMonitor: ChzzkMonitor;
  private twitterMonitor: TwitterMonitor;
  private cafeMonitor: CafeMonitor;
  
  private isRunning: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastMonitoringTime: number = 0;
  private sleepDetectionThreshold: number = 120000; // 2분
  
  // 네이버 로그인 상태 관리
  private naverLoginStatus: boolean | null = null;
  private statusCheckInterval: NodeJS.Timeout | null = null;
  private statusCheckInProgress: boolean = false;
  private trayService: any = null;

  constructor(databaseManager: DatabaseManager, notificationService: NotificationService) {
    this.databaseManager = databaseManager;
    this.notificationService = notificationService;
    this.settingsService = new SettingsService(databaseManager);
    
    // 모니터링 서비스들 초기화
    this.chzzkMonitor = new ChzzkMonitor(databaseManager, notificationService);
    this.twitterMonitor = new TwitterMonitor(databaseManager, notificationService);
    this.cafeMonitor = new CafeMonitor(databaseManager, notificationService, this.settingsService);
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
      
      // 이전 상태 복원 (앱 재시작 시)
      await this.restoreMonitoringStates();
      
      // 카페 모니터 초기화
      await this.cafeMonitor.initialize();
      
      // Twitter 인스턴스 상태 확인
      await this.twitterMonitor.checkInstanceHealth();
      
      // 네이버 로그인 상태 초기화 및 모니터링 시작
      await this.initializeLoginStatus();
      this.startLoginStatusMonitoring();
      
      // 새 스트리머들의 기준선 설정 (무음 모드)
      await this.establishBaselinesForNewStreamers();
      
      console.log('Monitoring service started with state persistence');
      
      // 첫 체크를 15초 후에 실행 (기준선 설정 완료 후)
      setTimeout(async () => {
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
      
      // 브라우저 정리
      await this.cafeMonitor.cleanup();
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
    try {
      const currentTime = Date.now();
      
      // 절전모드 감지
      if (currentTime - this.lastMonitoringTime > this.sleepDetectionThreshold) {
        console.log('Sleep mode detected, triggering missed notification recovery');
        await this.recoverMissedNotifications();
      }
      
      this.lastMonitoringTime = currentTime;
      
      console.log('Performing monitoring check...');
      
      // 모든 플랫폼 병렬 모니터링
      const [liveStatuses, tweets, cafePosts] = await Promise.all([
        this.checkChzzkStreams(),
        this.checkTwitterFeeds(),
        this.checkCafePosts()
      ]);
      
      // 라이브 상태 업데이트
      await this.updateLiveStatus(liveStatuses);
      
      // 모니터링 상태 기록
      await this.updateMonitoringStatus();
      
      console.log(`Monitoring check completed. Live: ${liveStatuses.filter(s => s.isLive).length}, Tweets: ${tweets.length}, Posts: ${cafePosts.length}`);
      
    } catch (error) {
      console.error('Monitoring check failed:', error);
    }
  }

  private async checkChzzkStreams(): Promise<LiveStatus[]> {
    try {
      return await this.chzzkMonitor.checkAllStreamers();
    } catch (error) {
      console.error('CHZZK monitoring failed:', error);
      return [];
    }
  }

  private async checkTwitterFeeds(): Promise<TwitterTweet[]> {
    try {
      return await this.twitterMonitor.checkAllStreamers();
    } catch (error) {
      console.error('Twitter monitoring failed:', error);
      return [];
    }
  }

  private async checkCafePosts(): Promise<CafePost[]> {
    try {
      return await this.cafeMonitor.checkAllStreamers();
    } catch (error) {
      console.error('Cafe monitoring failed:', error);
      return [];
    }
  }

  private async updateLiveStatus(liveStatuses: LiveStatus[]): Promise<void> {
    try {
      // 라이브 상태를 파일로도 저장 (UI 실시간 업데이트용)
      const fs = require('fs').promises;
      const path = require('path');
      const { app } = require('electron');
      
      const userDataPath = app.getPath('userData');
      const liveStatusFile = path.join(userDataPath, 'live_status.json');
      
      await fs.writeFile(liveStatusFile, JSON.stringify(liveStatuses, null, 2));
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
      
      // 복구 완료 알림
      if (recoveredCount > 0) {
        const systemNotification = this.notificationService.createSystemNotification(
          '누락 알림 복구 완료',
          `${recoveredCount}개의 누락된 알림을 복구했습니다.`
        );
        
        await this.notificationService.sendNotification(systemNotification);
      }
      
      // 복구 시간 기록
      await this.databaseManager.setSetting('lastRecoveryTime', new Date().toISOString());
      
      console.log(`Missed notification recovery completed. Recovered: ${recoveredCount} notifications`);
      
      return recoveredCount;
    } catch (error) {
      console.error('Failed to recover missed notifications:', error);
      
      // 복구 실패 알림
      const errorNotification = this.notificationService.createSystemNotification(
        '알림 복구 실패',
        '누락된 알림 복구 중 오류가 발생했습니다.'
      );
      
      await this.notificationService.sendNotification(errorNotification);
      
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
          wc.send('naver-login-status-changed', { needLogin });
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
}