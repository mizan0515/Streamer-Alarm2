import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { app } from 'electron';
import { DatabaseManager } from './DatabaseManager';
import { NotificationService } from './NotificationService';
import { SettingsService } from './SettingsService';
import { StreamerData, TwitterTweet } from '@shared/types';
import { LRUCache, CleanupScheduler, MemoryMonitor } from './MemoryManager';
import { TimeoutConfig } from './TimeoutConfig';
import { ErrorManager } from './ErrorManager';

interface TwitterCredentials {
  username: string;
  password: string;
  isConfigured: boolean;
}

interface TwitterSessionData {
  cookies: any[];
  lastLoginTime: number;
  sessionValid: boolean;
  userAgent: string;
}

export class TwitterMonitor {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isPersistentContext: boolean = false;
  private databaseManager: DatabaseManager;
  private notificationService: NotificationService;
  private settingsService: SettingsService;
  private lastTweetIds: LRUCache<string, string>;
  private timeoutConfig: TimeoutConfig;
  private errorManager: ErrorManager;
  private browserDataPath: string;
  private isLoggedIn: boolean = false;
  private loginCheckInProgress: boolean = false;
  private lastKnownLoginStatus: boolean = false;
  
  // Twitter 로그인 관련
  private credentials: TwitterCredentials = {
    username: '',
    password: '',
    isConfigured: false
  };
  
  // 세션 관리
  private sessionData: TwitterSessionData | null = null;
  private sessionFile: string;
  
  // User-Agent 로테이션
  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];
  
  private currentUserAgentIndex = 0;

  private monitoringService?: any; // Will be set after MonitoringService is created

  constructor(
    databaseManager: DatabaseManager, 
    notificationService: NotificationService,
    settingsService: SettingsService
  ) {
    this.databaseManager = databaseManager;
    this.notificationService = notificationService;
    this.settingsService = settingsService;
    this.timeoutConfig = TimeoutConfig.getInstance();
    this.errorManager = ErrorManager.getInstance();
    
    // LRU 캐시 초기화 (최대 1000개 항목, 4시간 TTL)
    this.lastTweetIds = new LRUCache(1000, 4 * 60 * 60 * 1000);
    
    // 정리 작업 등록
    const cleanup = CleanupScheduler.getInstance();
    cleanup.addTask('TwitterMonitor-Cache-Cleanup', () => {
      const cleaned = this.lastTweetIds.cleanup();
      console.log(`🧹 TwitterMonitor cache cleanup: ${cleaned} items removed`);
    }, 2 * 60 * 60 * 1000); // 2시간마다 정리
    
    // 브라우저 데이터 경로 설정
    const userDataPath = app.getPath('userData');
    this.browserDataPath = path.join(userDataPath, 'twitter_browser_data');
    this.sessionFile = path.join(userDataPath, 'twitter_session.json');
    
    // 설정에서 인증 정보 로드
    this.loadCredentials();
  }

  async initialize(): Promise<void> {
    try {
      await this.setupBrowser();
      await this.loadSession();
      await this.checkLoginStatus();
    } catch (error) {
      console.error('Failed to initialize Twitter monitor:', error);
    }
  }

  async checkAllStreamers(silentMode: boolean = false): Promise<TwitterTweet[]> {
    try {
      // 브라우저 초기화 확인 및 재시도
      let initRetries = 0;
      const maxInitRetries = 3;
      
      while ((!this.browser || !this.context) && initRetries < maxInitRetries) {
        try {
          await this.initialize();
          break;
        } catch (error) {
          initRetries++;
          console.warn(`⚠️ Twitter browser initialization failed (attempt ${initRetries}/${maxInitRetries}):`, error);
          
          if (initRetries < maxInitRetries) {
            const delay = Math.min(5000 * initRetries, 30000); // 지수 백오프: 5s, 10s, 15s
            console.log(`⏳ Retrying Twitter initialization in ${delay}ms...`);
            await this.delay(delay);
          } else {
            console.error('❌ Twitter browser initialization failed after all retries');
            return [];
          }
        }
      }
      
      // 로그인 상태 확인 및 자동 로그인 시도
      if (!this.isLoggedIn) {
        console.warn('⚠️ Twitter not logged in - attempting auto-login...');
        
        if (this.credentials.isConfigured) {
          const loginSuccess = await this.performLogin();
          if (!loginSuccess) {
            console.warn('❌ Twitter auto-login failed - skipping check');
            return [];
          }
        } else {
          console.warn('❌ Twitter credentials not configured - skipping check');
          return [];
        }
      }
      
      const streamers = await this.databaseManager.getStreamers();
      const activeStreamers = streamers.filter(s => s.isActive && s.twitterUsername);

      if (!silentMode) {
        console.log(`Checking ${activeStreamers.length} Twitter streamers...`);
      }

      // 배치 크기 설정 (스크래핑 부하 고려하여 더 보수적으로)
      const batchSize = 1; // 동시에 최대 1개 스트리머 체크 (봇 탐지 회피)
      const allTweets: TwitterTweet[] = [];
      
      // 순차 처리로 변경 (봇 탐지 회피)
      for (let i = 0; i < activeStreamers.length; i++) {
        const streamer = activeStreamers[i];
        const streamStart = Date.now();
        console.log(`🔄 Processing Twitter streamer ${i + 1}/${activeStreamers.length}: ${streamer.name} (@${streamer.twitterUsername})`);
        
        try {
          const tweets = await this.checkStreamerTweets(streamer);
          const streamDuration = Date.now() - streamStart;
          
          // 새 트윗 알림 처리 (silent mode에서는 알림 비활성화)
          if (!silentMode && tweets.length > 0) {
            console.log(`📢 Processing ${tweets.length} new tweets for notification...`);
            await this.handleNewTweets(streamer, tweets);
          }
          
          allTweets.push(...tweets);
          
          if (tweets.length > 0) {
            console.log(`✅ ${streamer.name}: Found ${tweets.length} new tweets (${streamDuration}ms)`);
          } else {
            console.log(`📭 ${streamer.name}: No new tweets (${streamDuration}ms)`);
          }
          
          // 성공 시 에러 매니저에 기록
          this.errorManager.recordSuccess('TwitterMonitor');
          
          // 스트리머 간 딜레이 (봇 탐지 회피)
          if (i < activeStreamers.length - 1) {
            const delay = this.getRandomDelay(3000, 8000); // 3-8초 랜덤 딜레이
            console.log(`⏳ Waiting ${delay}ms before next streamer...`);
            await this.delay(delay);
          }
          
        } catch (error) {
          const streamDuration = Date.now() - streamStart;
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          this.errorManager.recordError('TwitterMonitor', error);
          console.error(`💥 Failed to check ${streamer.name} tweets (${streamDuration}ms):`, errorMessage);
          
          // 상세한 에러 정보 로깅
          if (error instanceof Error && error.stack) {
            console.error(`📋 Error stack for ${streamer.name}:`, error.stack.split('\n').slice(0, 3).join('\n'));
          }
          
          // 중요한 에러 감지 및 복구 시도
          if (this.isSessionExpired(error as Error)) {
            console.warn('🚨 Twitter session expired - attempting recovery...');
            this.isLoggedIn = false;
            
            if (this.credentials.isConfigured) {
              console.log('🔄 Starting session recovery process...');
              const recoveryStart = Date.now();
              const recoverySuccess = await this.performLogin();
              const recoveryDuration = Date.now() - recoveryStart;
              
              if (recoverySuccess) {
                console.log(`✅ Twitter session recovered successfully (${recoveryDuration}ms)`);
                // 복구 성공 시 해당 스트리머 재시도
                try {
                  const retryTweets = await this.checkStreamerTweets(streamer);
                  if (!silentMode && retryTweets.length > 0) {
                    await this.handleNewTweets(streamer, retryTweets);
                  }
                  allTweets.push(...retryTweets);
                } catch (retryError) {
                  console.error(`Retry failed for ${streamer.name}:`, retryError);
                }
              }
            }
          } else if (this.isBrowserCrashed(error as Error)) {
            console.warn('🚨 Browser crashed - attempting restart...');
            await this.restartBrowser();
          }
          
          // 에러 시에도 딜레이 적용
          if (i < activeStreamers.length - 1) {
            await this.delay(this.getRandomDelay(5000, 10000));
          }
        }
      }

      if (!silentMode) {
        console.log(`✅ Twitter check completed. New tweets: ${allTweets.length}`);
      }
      
      return allTweets;
    } catch (error) {
      console.error('Failed to check Twitter streamers:', error);
      return [];
    }
  }

  /**
   * 랜덤 딜레이 생성 (봇 탐지 회피)
   */
  private getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  /**
   * User-Agent 로테이션
   */
  private getNextUserAgent(): string {
    this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
    return this.userAgents[this.currentUserAgentIndex];
  }

  private async checkStreamerTweets(streamer: StreamerData): Promise<TwitterTweet[]> {
    if (!streamer.twitterUsername) return [];

    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = 2;

    while (retryCount <= maxRetries) {
      try {
        // 페이지 초기화 확인
        if (!this.page) {
          console.warn(`❌ Browser page not available for ${streamer.name}`);
          return [];
        }
        
        // 사용자 프로필 페이지로 이동
        const profileUrl = `https://x.com/${streamer.twitterUsername}`;
        console.log(`🔍 [${retryCount > 0 ? `Retry ${retryCount}/` : ''}Attempt] Navigating to ${profileUrl}`);
        
        // 점진적 타임아웃 전략 사용
        const strategies = [
          { waitUntil: 'domcontentloaded' as const, timeout: 20000 },
          { waitUntil: 'load' as const, timeout: 25000 },
          { waitUntil: 'networkidle' as const, timeout: 30000 }
        ];
        
        let navigationSuccess = false;
        let lastError: Error | null = null;
        
        // 각 전략을 순차적으로 시도
        for (let i = 0; i < strategies.length; i++) {
          const strategy = strategies[i];
          try {
            console.log(`📡 Strategy ${i + 1}/3: ${strategy.waitUntil} (${strategy.timeout}ms)`);
            
            await this.page.goto(profileUrl, {
              waitUntil: strategy.waitUntil,
              timeout: strategy.timeout
            });
            
            navigationSuccess = true;
            console.log(`✅ Navigation successful with strategy: ${strategy.waitUntil}`);
            break;
            
          } catch (navError) {
            lastError = navError as Error;
            console.warn(`⚠️ Strategy ${i + 1} failed: ${navError instanceof Error ? navError.message : navError}`);
            
            // 마지막 전략이 아니면 짧은 대기 후 다음 전략 시도
            if (i < strategies.length - 1) {
              await this.delay(2000);
            }
          }
        }
        
        if (!navigationSuccess) {
          throw lastError || new Error('All navigation strategies failed');
        }
        
        // 페이지 로딩 확인 및 대기
        console.log(`⏳ Waiting for page content to load...`);
        await this.delay(this.getRandomDelay(2000, 4000));
        
        // 트윗 요소 대기 (더 관대한 타임아웃)
        try {
          await this.page.waitForSelector('[data-testid="tweet"]', { 
            timeout: this.timeoutConfig.getHttpTimeout('twitter_tweet_load') 
          });
          console.log(`📋 Tweet elements found`);
        } catch (selectorError) {
          // 트윗이 없거나 로딩이 느린 경우에도 스크래핑 시도
          console.warn(`⚠️ Tweet selector timeout, attempting to scrape anyway`);
        }
        
        // 트윗 스크래핑
        console.log(`🔍 Starting tweet scraping for ${streamer.name}`);
        const tweets = await this.scrapeTweets(streamer);
        
        const duration = Date.now() - startTime;
        console.log(`✅ Successfully scraped ${tweets.length} tweets for ${streamer.name} (${duration}ms)`);
        
        return tweets;
        
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        console.error(`❌ Error checking tweets for ${streamer.name} (attempt ${retryCount + 1}/${maxRetries + 1}, ${duration}ms):`, errorMessage);
        
        // 로그인 세션 만료 감지
        if (errorMessage.includes('login') || errorMessage.includes('suspended')) {
          console.warn('🚨 Twitter session may have expired - marking as logged out');
          this.isLoggedIn = false;
          return [];
        }
        
        // 타임아웃 에러인 경우 재시도
        if (errorMessage.includes('Timeout') && retryCount < maxRetries) {
          retryCount++;
          const backoffDelay = this.timeoutConfig.getBackoffDelay(retryCount);
          console.log(`⏳ Retrying after ${backoffDelay}ms backoff...`);
          await this.delay(backoffDelay);
          continue;
        }
        
        // 브라우저 상태 확인 및 복구 시도
        if (errorMessage.includes('Target page, context or browser has been closed') || 
            errorMessage.includes('Session closed')) {
          console.warn('🔄 Browser session lost, attempting recovery...');
          try {
            await this.setupBrowser();
            if (retryCount < maxRetries) {
              retryCount++;
              continue;
            }
          } catch (recoveryError) {
            console.error('💥 Browser recovery failed:', recoveryError);
          }
        }
        
        // 최종 실패
        const finalDuration = Date.now() - startTime;
        console.error(`💥 Final failure for ${streamer.name} after ${retryCount + 1} attempts (${finalDuration}ms)`);
        return [];
      }
    }
    
    return [];
  }

  /**
   * 브라우저 설정 및 초기화
   */
  private async setupBrowser(): Promise<void> {
    try {
      if (this.browser) {
        await this.closeBrowser();
      }
      
      // 브라우저 데이터 디렉토리 생성
      if (!fs.existsSync(this.browserDataPath)) {
        fs.mkdirSync(this.browserDataPath, { recursive: true });
      }
      
      // 브라우저 실행
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-dev-shm-usage',
          '--no-sandbox'
        ]
      });
      
      // 컨텍스트 생성 (세션 유지)
      this.context = await this.browser.newContext({
        userAgent: this.userAgents[0],
        viewport: { width: 1366, height: 768 },
        locale: 'ko-KR'
      });
      
      // 페이지 생성
      this.page = await this.context.newPage();
      
      console.log('✅ Twitter browser initialized');
      
    } catch (error) {
      console.error('Failed to setup Twitter browser:', error);
      throw error;
    }
  }

  /**
   * 트윗 스크래핑 메인 로직
   */
  private async scrapeTweets(streamer: StreamerData): Promise<TwitterTweet[]> {
    if (!this.page || !streamer.twitterUsername) return [];
    
    try {
      // 데이터베이스에서 마지막 트윗 ID 조회
      const lastState = await this.databaseManager.getMonitorState(streamer.id, 'twitter');
      const lastTweetId = lastState?.lastContentId || this.lastTweetIds.get(streamer.twitterUsername);

      // 트윗 요소들 선택
      const tweetElements = await this.page.$$('[data-testid="tweet"]');
      const tweets: TwitterTweet[] = [];
      
      console.log(`📊 Found ${tweetElements.length} tweet elements for ${streamer.name}`);
      
      // 새 스트리머 초기화 처리 (과거 알림 폭탄 방지)
      const isNewStreamer = !lastTweetId;
      if (isNewStreamer && tweetElements.length > 0) {
        console.log(`🆕 ${streamer.name}: 새 스트리머 감지됨 - 과거 알림 차단 모드 활성화`);
        
        // 최신 트윗 ID만 저장하고 알림은 차단
        const latestTweetData = await this.extractTweetData(tweetElements[0]);
        if (latestTweetData) {
          await this.databaseManager.setMonitorState(
            streamer.id,
            'twitter',
            latestTweetData.id,
            'initialized'
          );
          this.lastTweetIds.set(streamer.twitterUsername, latestTweetData.id);
          console.log(`🆕 ${streamer.name}: 초기 기준점 설정 완료 (ID: ${latestTweetData.id})`);
        }
        
        return []; // 새 스트리머는 빈 배열 반환
      }
      
      // 최대 10개 트윗 처리 (성능 고려)
      for (let i = 0; i < Math.min(tweetElements.length, 10); i++) {
        const tweetData = await this.extractTweetData(tweetElements[i]);
        if (!tweetData) continue;
        
        // 새 트윗인지 확인 (ID 기반 - 숫자 비교)
        if (lastTweetId && this.compareTwitterIds(tweetData.id, lastTweetId) > 0) {
          // 시간 기반 이중 필터링
          const tweetTime = new Date(tweetData.timestamp);
          const now = new Date();
          const timeDiff = now.getTime() - tweetTime.getTime();
          const hoursAgo = timeDiff / (1000 * 60 * 60);
          const filterHours = parseInt(this.settingsService.getSetting('newStreamerFilterHours')) || 24;
          
          if (hoursAgo > filterHours) {
            console.log(`⏰ ${streamer.name}: ${filterHours}시간 이상 경과 트윗 차단 (${hoursAgo.toFixed(1)}시간 전)`);
            continue;
          }
          
          tweets.push(tweetData);
        }
      }
      
      return tweets.reverse(); // 시간순 정렬
      
    } catch (error) {
      console.error(`Error scraping tweets for ${streamer.name}:`, error);
      return [];
    }
  }

  /**
   * 트윗 요소에서 데이터 추출
   */
  private async extractTweetData(tweetElement: any): Promise<TwitterTweet | null> {
    try {
      // 트윗 ID 추출
      const tweetLink = await tweetElement.$('a[href*="/status/"]');
      if (!tweetLink) return null;
      
      const href = await tweetLink.getAttribute('href');
      if (!href) return null;
      
      const tweetIdMatch = href.match(/\/status\/(\d+)/);
      if (!tweetIdMatch) return null;
      
      const tweetId = tweetIdMatch[1];
      
      // 트윗 내용 추출
      const tweetTextElement = await tweetElement.$('[data-testid="tweetText"]');
      let content = '';
      let contentHtml = '';
      
      if (tweetTextElement) {
        content = await tweetTextElement.textContent() || '';
        contentHtml = await tweetTextElement.innerHTML() || '';
      }
      
      // 내용 정제
      content = this.cleanTweetContent(content);
      
      // 시간 정보 추출
      const timeElement = await tweetElement.$('time');
      let timestamp = new Date().toISOString();
      
      if (timeElement) {
        const datetime = await timeElement.getAttribute('datetime');
        if (datetime) {
          timestamp = new Date(datetime).toISOString();
        }
      }
      
      // URL 생성
      const url = `https://x.com${href}`;
      
      // 트위터 프로필 이미지 추출
      let profileImageUrl: string | undefined;
      try {
        // 트위터 프로필 이미지 선택자들
        const profileImageSelectors = [
          '[data-testid="Tweet-User-Avatar"] img',
          'img[src*="profile_images"]',
          'a[role="link"] img[alt*="프로필"]',
          'a[role="link"] img[src*="pbs.twimg.com/profile_images"]',
          '[data-testid="UserAvatar-Container-"] img'
        ];
        
        for (const selector of profileImageSelectors) {
          const profileImgElement = await tweetElement.$(selector);
          if (profileImgElement) {
            const src = await profileImgElement.getAttribute('src');
            if (src && src.includes('profile_images')) {
              // 프로필 이미지를 원본 크기로 변환
              profileImageUrl = src.replace(/_normal\./, '_400x400.').replace(/_bigger\./, '_400x400.');
              console.log(`트위터 프로필 이미지 추출 성공: ${profileImageUrl}`);
              break;
            }
          }
        }
        
        if (!profileImageUrl) {
          console.log(`트위터 프로필 이미지를 찾지 못함: ${tweetId}`);
        }
      } catch (error) {
        console.error('트위터 프로필 이미지 추출 실패:', error);
      }
      
      // 미디어 정보 추가
      contentHtml = await this.enhanceContentWithMedia(contentHtml, tweetElement, url);
      
      return {
        id: tweetId,
        content: content,
        contentHtml: contentHtml,
        url: url,
        timestamp: timestamp,
        profileImageUrl: profileImageUrl
      };
      
    } catch (error) {
      console.error('Failed to extract tweet data:', error);
      return null;
    }
  }

  /**
   * 로그인 자격 증명 로드 (복호화)
   */
  private loadCredentials(): void {
    try {
      const twitterCredentialsStr = this.settingsService.getSetting('twitterCredentials');
      const twitterCredentials = twitterCredentialsStr ? JSON.parse(twitterCredentialsStr) : null;
      if (twitterCredentials) {
        // 비밀번호 복호화
        const decryptedPassword = this.decryptPassword(twitterCredentials.password || '');
        
        this.credentials = {
          username: twitterCredentials.username || '',
          password: decryptedPassword,
          isConfigured: !!(twitterCredentials.username && decryptedPassword)
        };
      }
    } catch (error) {
      console.error('Failed to load Twitter credentials:', error);
      // 복호화 실패 시 자격 증명 초기화
      this.credentials = {
        username: '',
        password: '',
        isConfigured: false
      };
    }
  }

  /**
   * 세션 데이터 로드 (복호화)
   */
  private async loadSession(): Promise<void> {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const encryptedData = fs.readFileSync(this.sessionFile, 'utf8');
        
        // 세션 데이터 복호화 시도
        let sessionDataStr = this.decryptSessionData(encryptedData);
        if (!sessionDataStr) {
          // 복호화 실패 시 원본 데이터로 시도 (하위 호환성)
          sessionDataStr = encryptedData;
        }
        
        const sessionData = JSON.parse(sessionDataStr);
        this.sessionData = sessionData;
        
        // 세션 유효성 검사
        if (this.sessionData && this.context) {
          await this.context.addCookies(this.sessionData.cookies);
          console.log('✅ Twitter session loaded (decrypted)');
        }
      }
    } catch (error) {
      console.error('Failed to load Twitter session:', error);
      this.sessionData = null;
    }
  }
  
  /**
   * 세션 데이터 저장 (암호화)
   */
  private async saveSession(): Promise<void> {
    try {
      if (this.context) {
        const cookies = await this.context.cookies();
        this.sessionData = {
          cookies: cookies,
          lastLoginTime: Date.now(),
          sessionValid: true,
          userAgent: this.userAgents[this.currentUserAgentIndex]
        };
        
        // 세션 데이터 암호화
        const encryptedSession = this.encryptSessionData(JSON.stringify(this.sessionData));
        fs.writeFileSync(this.sessionFile, encryptedSession);
        console.log('✅ Twitter session saved (encrypted)');
      }
    } catch (error) {
      console.error('Failed to save Twitter session:', error);
    }
  }
  
  private cleanTweetContent(content: string): string {
    // HTML 태그 제거
    content = content.replace(/<[^>]*>/g, '');
    
    // HTML 엔티티 디코딩
    content = content
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    
    // 개행 문자 정리
    content = content.replace(/\n\s*\n/g, '\n').trim();
    
    // 길이 제한 (200자로 확장)
    if (content.length > 200) {
      content = content.substring(0, 197) + '...';
    }
    
    return content;
  }

  private async handleNewTweets(streamer: StreamerData, tweets: TwitterTweet[]): Promise<void> {
    if (tweets.length === 0) return;

    // 최신 스트리머 정보 다시 조회 (알림 설정 동기화)
    const latestStreamers = await this.databaseManager.getStreamers();
    const latestStreamer = latestStreamers.find(s => s.id === streamer.id);

    // 스트리머별 트위터 알림 설정 확인 (최신 정보 기준)
    if (!latestStreamer?.notifications?.twitter || !latestStreamer.isActive) return;

    // 데이터베이스에서 마지막 트윗 ID 조회
    const lastState = await this.databaseManager.getMonitorState(streamer.id, 'twitter');
    const lastTweetId = lastState?.lastContentId;

    for (const tweet of tweets) {
      // 이미 처리된 트윗인지 확인 (숫자 비교)
      if (lastTweetId && this.compareTwitterIds(tweet.id, lastTweetId) <= 0) {
        continue;
      }

      const notification = this.notificationService.createTwitterNotification(
        latestStreamer.name,
        tweet.content,
        tweet.url,
        tweet.profileImageUrl || latestStreamer.profileImageUrl, // 트위터 프로필 이미지 우선 사용
        new Date(tweet.timestamp), // Pass the original tweet timestamp
        tweet.contentHtml // Pass the HTML content
      );

      await this.notificationService.sendNotification(notification);
      console.log(`Twitter notification sent for ${streamer.name}: ${tweet.content.substring(0, 50)}...`);
    }

    // 가장 최신 트윗 ID를 데이터베이스에 저장
    if (tweets.length > 0) {
      const latestTweet = tweets[tweets.length - 1]; // 배열은 시간순으로 정렬됨
      await this.databaseManager.setMonitorState(
        streamer.id,
        'twitter',
        latestTweet.id,
        'checked'
      );
      
      // 메모리 캐시도 업데이트 (호환성 유지)
      this.lastTweetIds.set(latestStreamer.twitterUsername || streamer.twitterUsername!, latestTweet.id);
    }
  }

  /**
   * 로그인 상태 확인
   */
  async checkLoginStatus(): Promise<boolean> {
    try {
      if (!this.page) return false;
      
      // 로그인 체크 중복 방지
      if (this.loginCheckInProgress) {
        return this.isLoggedIn;
      }
      
      this.loginCheckInProgress = true;
      
      // 세션 검증 강화 - 쿠키 유효성 검사
      if (this.context) {
        const cookies = await this.context.cookies();
        const authCookies = cookies.filter(cookie => 
          ['auth_token', 'ct0', 'twid'].some(name => cookie.name.includes(name))
        );
        
        if (authCookies.length === 0) {
          console.log('❌ No authentication cookies found - marking as logged out');
          this.isLoggedIn = false;
          await this.settingsService.updateSetting('needTwitterLogin', 'true');
          return false;
        }
        
        console.log(`🍪 Found ${authCookies.length} auth cookies: ${authCookies.map(c => c.name).join(', ')}`);
      }
      
      // 홈페이지로 이동하여 로그인 상태 확인 - 더 관대한 설정
      try {
        await this.page.goto('https://x.com/home', { 
          waitUntil: 'domcontentloaded', // networkidle에서 domcontentloaded로 변경
          timeout: 20000 // 타임아웃을 20초로 증가
        });
        console.log('✅ Twitter 홈 페이지 이동 성공');
      } catch (error) {
        console.warn('⚠️ Twitter 홈 페이지 이동 실패, 현재 페이지에서 확인:', error);
        // 이동 실패 시 현재 페이지에서 확인
      }
      
      await this.delay(2000); // 페이지 로딩 대기
      
      // 다중 검증으로 로그인 상태 확인
      const currentUrl = this.page.url();
      console.log(`🔍 Current URL for login check: ${currentUrl}`);
      
      // 1. URL 기반 검증 - 로그인 페이지로 리다이렉트되지 않았는지 확인
      const isOnLoginPage = currentUrl.includes('/i/flow/login') || currentUrl.includes('/login');
      
      // 2. DOM 요소 기반 다중 검증
      const [loginButton, tweetButton, profileMenu, homeTimeline] = await Promise.all([
        this.page.$('[data-testid="loginButton"]').catch(() => null),
        this.page.$('[data-testid="tweetButtonInline"]').catch(() => null), // 트윗 작성 버튼
        this.page.$('[data-testid="AppTabBar_Profile_Link"]').catch(() => null), // 프로필 메뉴
        this.page.$('[data-testid="primaryColumn"]').catch(() => null) // 메인 타임라인
      ]);
      
      // 3. 페이지 제목 확인
      const pageTitle = await this.page.title();
      console.log(`🔍 Page title: ${pageTitle}`);
      
      // 로그인 상태 종합 판단
      const urlCheck = !isOnLoginPage; // 로그인 페이지에 있지 않음
      const domCheck = !loginButton && (!!tweetButton || !!profileMenu || !!homeTimeline); // 로그인 버튼 없고 로그인 요소 있음
      const titleCheck = !pageTitle.includes('Log in') && !pageTitle.includes('Sign up'); // 로그인 관련 제목 아님
      
      const isLoggedIn: boolean = urlCheck && domCheck && titleCheck;
      
      console.log(`🔍 Login status checks - URL: ${urlCheck}, DOM: ${domCheck}, Title: ${titleCheck} → Result: ${isLoggedIn}`);
      
      this.isLoggedIn = isLoggedIn;
      this.lastKnownLoginStatus = isLoggedIn;
      
      if (isLoggedIn) {
        console.log('✅ Twitter logged in successfully');
        await this.saveSession();
        // 로그인 성공 시 설정 업데이트 및 알림 (중복 방지)
        const currentSetting = this.settingsService.getSetting('needTwitterLogin');
        if (currentSetting !== 'false') {
          await this.settingsService.updateSetting('needTwitterLogin', 'false');
          console.log('🔧 Twitter 로그인 상태 설정 업데이트됨: false');
          // MonitoringService를 통한 알림
          if (this.monitoringService && this.monitoringService.notifyTwitterLoginStatusChange) {
            this.monitoringService.notifyTwitterLoginStatusChange(false);
          }
        }
      } else {
        console.log('❌ Twitter not logged in');
        // 로그인되지 않은 경우 설정 업데이트 및 알림 (중복 방지)
        const currentSetting = this.settingsService.getSetting('needTwitterLogin');
        if (currentSetting !== 'true') {
          await this.settingsService.updateSetting('needTwitterLogin', 'true');
          console.log('🔧 Twitter 로그인 상태 설정 업데이트됨: true');
          // MonitoringService를 통한 알림
          if (this.monitoringService && this.monitoringService.notifyTwitterLoginStatusChange) {
            this.monitoringService.notifyTwitterLoginStatusChange(true);
          }
        }
      }
      
      return isLoggedIn;
      
    } catch (error) {
      console.error('Failed to check Twitter login status:', error);
      this.isLoggedIn = false;
      // 에러 발생 시 로그인 필요로 설정 및 알림
      await this.settingsService.updateSetting('needTwitterLogin', 'true');
      if (this.monitoringService && this.monitoringService.notifyTwitterLoginStatusChange) {
        this.monitoringService.notifyTwitterLoginStatusChange(true);
      }
      return false;
    } finally {
      this.loginCheckInProgress = false;
    }
  }

  /**
   * 트위터 컨텐츠에 미디어 정보 추가 (DOM 기반)
   */
  private async enhanceContentWithMedia(contentHtml: string, tweetElement: any, tweetUrl: string): Promise<string> {
    try {
      let enhancedContent = contentHtml;
      
      // 이미지 요소 찾기 - 다양한 선택자로 트위터 이미지 탐지
      const imageSelectors = [
        'img[src*="pbs.twimg.com"]',
        'img[src*="media.discordapp.net"]',
        'img[src*="abs.twimg.com"]',
        '[data-testid="tweetPhoto"] img',
        '[data-testid="tweet"] img[src*="twimg.com"]'
      ];
      
      const mediaLinks: string[] = [];
      
      for (const selector of imageSelectors) {
        const imageElements = await tweetElement.$$(selector);
        for (const imgElement of imageElements) {
          const src = await imgElement.getAttribute('src');
          if (src && !mediaLinks.some(link => link.includes(src))) {
            // 이미지 URL을 원본 크기로 변환
            const originalSrc = src.replace(/&name=\w+$/, '&name=orig').replace(/\?format=\w+&name=\w+$/, '?format=jpg&name=orig');
            mediaLinks.push(`<div class="twitter-image"><img src="${originalSrc}" alt="트위터 이미지" style="max-width: 300px; height: auto; border-radius: 8px; margin: 4px 0; display: block;" loading="lazy" /></div>`);
          }
        }
      }
      
      // 비디오 요소 찾기
      const videoElements = await tweetElement.$$('video');
      for (const videoElement of videoElements) {
        const poster = await videoElement.getAttribute('poster');
        if (poster) {
          mediaLinks.push(`<div class="twitter-video">🎥 <a href="${tweetUrl}" target="_blank">비디오 보기</a></div>`);
        }
      }
      
      // 미디어 링크 추가
      if (mediaLinks.length > 0) {
        enhancedContent += '<div class="twitter-media-section">' + mediaLinks.join('') + '</div>';
      } else {
        // 미디어가 없는 경우 원본 트윗 링크 추가
        enhancedContent += `<div class="twitter-link">🔗 <a href="${tweetUrl}" target="_blank">트윗 보기</a></div>`;
      }
      
      return enhancedContent;
      
    } catch (error) {
      console.error('Failed to enhance content with media:', error);
      return contentHtml;
    }
  }

  /**
   * 브라우저 종료
   */
  private async closeBrowser(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      
      console.log('✅ Twitter browser closed');
      
    } catch (error) {
      console.error('Error closing Twitter browser:', error);
    }
  }
  
  /**
   * 트위터 브라우저 창 로그인 시작
   * 사용자가 직접 브라우저에서 로그인하는 방식
   */
  async performLogin(): Promise<boolean> {
    try {
      console.log('🔐 Twitter 브라우저 창 로그인 시작...');

      // 로그인용 브라우저 실행 (headless: false)
      let loginBrowser: Browser | null = null;
      let loginContext: any = null;
      
      const loginBrowsers = [
        { name: 'Chrome', channel: 'chrome' as const },
        { name: 'Edge', channel: 'msedge' as const }
      ];

      for (const browserInfo of loginBrowsers) {
        try {
          console.log(`🔍 로그인용 ${browserInfo.name} 브라우저 시도 중...`);
          
          // launchPersistentContext 사용으로 변경
          const userDataDir = path.join(this.browserDataPath, 'login');
          
          // 사용자 데이터 디렉토리 생성
          if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
          }
          
          const context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            channel: browserInfo.channel,
            timeout: 60000,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--no-first-run',
              '--no-zygote',
              '--disable-blink-features=AutomationControlled',
              '--exclude-switches=enable-automation',
              '--disable-web-security',
              '--allow-running-insecure-content',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
              '--disable-features=TranslateUI,VizDisplayCompositor',
              '--disable-hang-monitor',
              '--disable-prompt-on-repost',
              '--no-default-browser-check',
              '--disable-extensions-except',
              '--disable-plugins-discovery',
              '--start-maximized'
            ],
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            viewport: { width: 1366, height: 768 },
            locale: 'ko-KR',
            timezoneId: 'Asia/Seoul',
            ignoreHTTPSErrors: true,
            bypassCSP: false, // CSP 우회 비활성화 (탐지 방지)
            javaScriptEnabled: true,
            acceptDownloads: false,
            colorScheme: 'light',
            reducedMotion: 'no-preference',
            extraHTTPHeaders: {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
              'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
              'Accept-Encoding': 'gzip, deflate, br',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'none',
              'Sec-Fetch-User': '?1',
              'Upgrade-Insecure-Requests': '1',
              'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="121", "Google Chrome";v="121"',
              'sec-ch-ua-mobile': '?0',
              'sec-ch-ua-platform': '"Windows"'
            }
          });
          
          // loginBrowser와 loginContext를 context로 설정
          loginBrowser = context.browser();
          loginContext = context;
          
          console.log(`✅ 로그인용 ${browserInfo.name} 브라우저 실행 성공`);
          break;
        } catch (error: any) {
          console.warn(`⚠️ 로그인용 ${browserInfo.name} 실행 실패:`, error.message);
          continue;
        }
      }

      if (!loginBrowser || !loginContext) {
        throw new Error('로그인용 브라우저를 실행할 수 없습니다. Chrome 또는 Edge를 설치해주세요.');
      }

      const loginPage = await loginContext.newPage();
      
      // 네트워크 요청/응답 모니터링
      loginPage.on('request', (request: any) => {
        if (request.url().includes('twitter.com') || request.url().includes('x.com')) {
          console.log(`📤 요청: ${request.method()} ${request.url()}`);
        }
      });
      
      loginPage.on('response', (response: any) => {
        if (response.url().includes('twitter.com') || response.url().includes('x.com')) {
          console.log(`📥 응답: ${response.status()} ${response.url()}`);
          if (response.status() >= 400) {
            console.warn(`⚠️ HTTP 에러 ${response.status()}: ${response.url()}`);
          }
        }
      });
      
      // 콘솔 에러 로깅
      loginPage.on('console', (msg: any) => {
        if (msg.type() === 'error') {
          console.warn(`🖥️ 브라우저 콘솔 에러: ${msg.text()}`);
        }
      });
      
      // 페이지 에러 처리
      loginPage.on('pageerror', (error: any) => {
        console.error('📄 페이지 에러:', error.message);
      });
      
      // 브라우저가 수동으로 닫혔는지 감지
      let browserClosed = false;
      loginBrowser.on('disconnected', () => {
        console.log('🚪 사용자가 브라우저를 수동으로 닫았습니다.');
        browserClosed = true;
      });
      
      // 자동화 감지 우회 - 강화된 스크립트
      await loginPage.addInitScript(() => {
        // webdriver 속성 제거
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        delete (navigator as any).__proto__.webdriver;
        
        // Chrome 자동화 플래그 제거
        Object.defineProperty(window, 'chrome', {
          writable: true,
          enumerable: true,
          configurable: false,
          value: {
            runtime: {
              onConnect: undefined,
              onMessage: undefined,
            },
          },
        });
        
        // 플러그인 배열 수정
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        
        // 언어 배열 수정
        Object.defineProperty(navigator, 'languages', {
          get: () => ['ko-KR', 'ko', 'en-US', 'en'],
        });
        
        // 권한 API 모킹
        const originalQuery = window.navigator.permissions.query;
        (window.navigator.permissions as any).query = (parameters: any) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission } as any) :
            originalQuery(parameters)
        );
        
        // 자동화 관련 속성들 제거
        delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
      });
      
      // 로그인 페이지 이동 - 타임아웃 증가 및 에러 처리 강화
      console.log('🔗 트위터 로그인 페이지로 이동 중...');
      try {
        await loginPage.goto('https://twitter.com/i/flow/login', { 
          waitUntil: 'domcontentloaded', // networkidle 대신 domcontentloaded 사용
          timeout: 60000 // 60초로 타임아웃 증가
        });
        console.log('✅ 트위터 로그인 페이지 로딩 완료');
        
        // 페이지 완전 로딩을 위한 추가 대기
        await new Promise(resolve => setTimeout(resolve, 3000));
        
      } catch (error: any) {
        console.error('❌ 트위터 로그인 페이지 로딩 실패:', error.message);
        
        // 대체 URL들 시도
        const alternativeUrls = [
          'https://x.com/i/flow/login',
          'https://twitter.com/login',
          'https://x.com/login',
          'https://twitter.com'
        ];
        
        let pageLoaded = false;
        for (const altUrl of alternativeUrls) {
          try {
            console.log(`🔄 대체 URL 시도: ${altUrl}`);
            await loginPage.goto(altUrl, { 
              waitUntil: 'domcontentloaded', 
              timeout: 45000 
            });
            console.log(`✅ 대체 URL 로딩 성공: ${altUrl}`);
            pageLoaded = true;
            break;
          } catch (altError: any) {
            console.warn(`⚠️ 대체 URL 실패: ${altUrl} - ${altError.message}`);
            continue;
          }
        }
        
        if (!pageLoaded) {
          throw new Error('모든 트위터 로그인 URL에 접근할 수 없습니다. 네트워크 연결을 확인해주세요.');
        }
      }
      
      // 사용자가 로그인할 때까지 대기 (최대 5분)
      console.log('Waiting for user to login to Twitter...');
      
      try {
        // 로그인 완료 감지 - 더 안전한 폴링 방식 사용
        console.log('⏳ 로그인 완료를 기다리는 중... (최대 10분)');
        console.log(`🕐 로그인 시작 시간: ${new Date().toLocaleTimeString()}`);
        
        let loginCompleted = false;
        let previousUrl = '';
        let urlChangeCount = 0;
        const startTime = Date.now();
        const maxWaitTime = 600000; // 10분
        
        while (!loginCompleted && (Date.now() - startTime) < maxWaitTime) {
          // 브라우저가 닫혔는지 확인
          if (browserClosed) {
            console.log('❌ 사용자가 브라우저를 닫았으므로 로그인을 취소합니다.');
            throw new Error('사용자가 브라우저를 닫았습니다');
          }
          
          try {
            const currentUrl = loginPage.url();
            const elapsedTime = Math.round((Date.now() - startTime) / 1000);
            
            // URL 변경 추적
            if (currentUrl !== previousUrl) {
              urlChangeCount++;
              console.log(`🔄 URL 변경 #${urlChangeCount} (${elapsedTime}초 경과): ${currentUrl}`);
              previousUrl = currentUrl;
            } else {
              console.log(`🔍 URL 상태 확인 (${elapsedTime}초 경과): ${currentUrl}`);
            }
            
            // URL 기반 상태 분류
            const urlState = this.classifyLoginUrl(currentUrl);
            console.log(`📍 인증 상태: ${urlState.type} - ${urlState.description}`);
            
            // 구글 2단계 인증 과정 중이면 더 오래 대기 (SMS/앱 인증 시간 고려)
            if (urlState.type === 'google_2fa') {
              console.log('🔐 구글 2단계 인증 진행 중... 사용자 인증 대기 (15초)');
              // 2단계 인증은 사용자가 휴대폰을 확인하고 코드를 입력하는 시간 필요
              await new Promise(resolve => setTimeout(resolve, 15000)); // 15초 대기
              continue;
            }
            
            // 구글 OAuth 동의 과정
            if (urlState.type === 'google_oauth') {
              console.log('📋 구글 OAuth 권한 동의 진행 중... 사용자 승인 대기 (12초)');
              // OAuth 동의는 사용자가 권한을 확인하고 승인하는 시간 필요
              await new Promise(resolve => setTimeout(resolve, 12000)); // 12초 대기
              continue;
            }
            
            // 구글 인증 중이면 일반 대기
            if (urlState.type === 'google_auth') {
              console.log('🔑 구글 인증 진행 중... 일반 대기 (8초)');
              // 일반 구글 인증도 OAuth 리다이렉트 시간을 고려해 조금 더 길게
              await new Promise(resolve => setTimeout(resolve, 8000)); // 8초 대기
              continue;
            }
            
            // Twitter OAuth 처리 중
            if (urlState.type === 'twitter_oauth') {
              console.log('🔄 Twitter OAuth 콜백 처리 중... (5초)');
              await new Promise(resolve => setTimeout(resolve, 5000)); // 5초 대기
              continue;
            }
            
            // Twitter 메인 영역에 도달했을 때 로그인 완료로 간주
            if (urlState.type === 'twitter_main') {
              console.log('🏠 Twitter 메인 영역 도달, 로그인 완료 검증 시작...');
              
              // 간단한 대기 후 로그인 완료로 간주
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              try {
                // 기본적인 요소 확인만 수행
                const loginButton = await loginPage.$('[data-testid="loginButton"]').catch(() => null);
                const hasMainContent = await loginPage.$('[data-testid="primaryColumn"]').catch(() => null) || 
                                     await loginPage.$('[aria-label="홈 타임라인"]').catch(() => null) ||
                                     await loginPage.$('[role="main"]').catch(() => null);
                
                // 로그인 버튼이 없고 메인 컨텐츠가 있으면 로그인 완료
                if (!loginButton && hasMainContent) {
                  const totalTime = Math.round((Date.now() - startTime) / 1000);
                  console.log(`✅ 로그인 완료 감지! (총 소요시간: ${totalTime}초, URL 변경: ${urlChangeCount}회)`);
                  console.log(`🏁 완료 URL: ${currentUrl}`);
                  console.log(`📊 검증 결과: 로그인 버튼 없음 + 메인 컨텐츠 존재`);
                  loginCompleted = true;
                  break;
                } else {
                  console.log(`⏳ 로그인 검증 실패 (${elapsedTime}초): 로그인버튼=${!!loginButton}, 메인컨텐츠=${!!hasMainContent}`);
                }
              } catch (error) {
                console.warn(`⚠️ 로그인 검증 중 오류 (${elapsedTime}초):`, error);
                // 에러가 발생해도 Twitter 메인 영역에 있다면 로그인 완료로 간주
                const totalTime = Math.round((Date.now() - startTime) / 1000);
                console.log(`✅ 로그인 완료로 간주 (메인 영역 + 검증 오류, 총 소요시간: ${totalTime}초)`);
                loginCompleted = true;
                break;
              }
            }
            
            // 로그인 페이지에 여전히 있으면 계속 대기
            if (urlState.type === 'login_page') {
              console.log('📝 아직 로그인 페이지에 있음, 계속 대기...');
            }
            
            // 기본 대기 시간
            await new Promise(resolve => setTimeout(resolve, 3000));
            
          } catch (error: any) {
            // 브라우저가 닫혔을 때 발생하는 에러 처리
            if (browserClosed || error.message?.includes('Target closed') || error.message?.includes('Protocol error')) {
              console.log('❌ 브라우저가 닫혔습니다.');
              throw new Error('브라우저가 닫혔습니다');
            }
            console.log('⏳ URL 확인 중 오류, 계속 대기 중...', error.message);
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
        
        if (!loginCompleted) {
          throw new Error('로그인 시간 초과');
        }
        
        const currentUrl = loginPage.url();
        console.log(`✅ Twitter login completed successfully - Final URL: ${currentUrl}`);
        
        // 로그인 세션 쿠키를 기존 컨텍스트로 복사
        const cookies = await loginContext.cookies();
        console.log(`🍪 복사할 쿠키 개수: ${cookies.length}`);
        
        // 중요한 쿠키들 확인
        const importantCookies = cookies.filter((cookie: any) => 
          ['auth_token', 'ct0', 'twid', 'personalization_id'].some(name => 
            cookie.name.includes(name)
          )
        );
        console.log(`🔑 중요한 인증 쿠키: ${importantCookies.map((c: any) => c.name).join(', ')}`);
        
        if (this.context) {
          try {
            // 기존 쿠키 정리 후 새 쿠키 추가
            await this.context.clearCookies();
            await this.context.addCookies(cookies);
            console.log('쿠키가 성공적으로 복사되었습니다.');
          } catch (error) {
            console.error('쿠키 복사 실패:', error);
          }
        }
        
        // 세션 데이터 저장
        const sessionData: TwitterSessionData = {
          cookies,
          lastLoginTime: Date.now(),
          sessionValid: true,
          userAgent: this.getNextUserAgent()
        };

        // 세션 데이터를 클래스 변수에 저장
        this.sessionData = sessionData;
        await this.saveSession();
        
        // 로그인 전용 브라우저 정리
        try {
          await loginBrowser.close();
        } catch (error) {
          console.log('브라우저 닫기 중 오류 (무시):', error);
        }
        
        // 로그인이 성공했으므로 직접 상태 업데이트
        this.isLoggedIn = true;
        console.log('✅ Twitter 로그인 성공 - 상태 업데이트 중...');
        
        // 로그인 성공 시 설정 업데이트 및 알림 (중복 방지)
        const currentSetting = this.settingsService.getSetting('needTwitterLogin');
        if (currentSetting !== 'false') {
          await this.settingsService.updateSetting('needTwitterLogin', 'false');
          console.log('🔧 Twitter 로그인 상태 설정 업데이트됨: false');
          
          // MonitoringService를 통한 UI 업데이트 알림
          if (this.monitoringService && this.monitoringService.notifyTwitterLoginStatusChange) {
            console.log('📡 Twitter 로그인 상태 변경 알림 전송 중...');
            this.monitoringService.notifyTwitterLoginStatusChange(false);
          } else {
            console.warn('⚠️ MonitoringService가 없어서 UI 업데이트 알림을 보낼 수 없습니다.');
          }
        }
        
        return true;
        
      } catch (error: any) {
        console.log('Login timeout or failed:', error.message);
        try {
          await loginBrowser.close();
        } catch (closeError) {
          console.log('브라우저 닫기 중 오류 (무시):', closeError);
        }
        // 로그인 타임아웃/실패 시 설정 업데이트 및 알림
        await this.settingsService.updateSetting('needTwitterLogin', 'true');
        if (this.monitoringService && this.monitoringService.notifyTwitterLoginStatusChange) {
          this.monitoringService.notifyTwitterLoginStatusChange(true);
        }
        return false;
      }
    } catch (error) {
      console.error('Failed to initiate Twitter login:', error);
      // 로그인 실패 시 설정 업데이트 및 알림
      await this.settingsService.updateSetting('needTwitterLogin', 'true');
      if (this.monitoringService && this.monitoringService.notifyTwitterLoginStatusChange) {
        this.monitoringService.notifyTwitterLoginStatusChange(true);
      }
      return false;
    }
  }
  
  /**
   * MonitoringService 참조 설정 (알림을 위해 필요)
   */
  setMonitoringService(monitoringService: any): void {
    this.monitoringService = monitoringService;
  }

  /**
   * URL을 기반으로 로그인 상태 분류
   */
  private classifyLoginUrl(url: string): { type: string; description: string } {
    // 구글 2단계 인증 페이지들 (더 포괄적으로)
    if (url.includes('accounts.google.com/signin/v2/challenge') || 
        url.includes('accounts.google.com/signin/challenge') ||
        url.includes('accounts.google.com/v3/signin/challenge') ||
        url.includes('accounts.google.com/signin/v2/challenge/totp') ||
        url.includes('accounts.google.com/signin/v2/challenge/sms') ||
        url.includes('accounts.google.com/signin/v2/challenge/selection') ||
        url.includes('myaccount.google.com/security/signinoptions') ||
        url.includes('accounts.google.com/b/0/signin/v2/challenge') ||
        url.includes('challenge') && url.includes('google.com')) {
      return { type: 'google_2fa', description: '구글 2단계 인증 진행 중 (SMS/앱/보안키)' };
    }
    
    // 구글 OAuth 동의 페이지
    if (url.includes('accounts.google.com/o/oauth2/auth') ||
        url.includes('accounts.google.com/oauth/authorize') ||
        url.includes('accounts.google.com/o/oauth2/v2/auth')) {
      return { type: 'google_oauth', description: '구글 OAuth 권한 동의 진행 중' };
    }
    
    // 일반 구글 인증 페이지들
    if (url.includes('accounts.google.com') || 
        url.includes('myaccount.google.com') ||
        url.includes('google.com/oauth') ||
        url.includes('google.com/signin')) {
      return { type: 'google_auth', description: '구글 인증 진행 중' };
    }
    
    // Twitter OAuth 콜백
    if (url.includes('twitter.com/oauth/authorize') ||
        url.includes('x.com/oauth/authorize') ||
        url.includes('api.twitter.com/oauth')) {
      return { type: 'twitter_oauth', description: 'Twitter OAuth 처리 중' };
    }
    
    // Twitter 로그인 페이지들
    if (url.includes('/i/flow/login') || 
        url.includes('/login') || 
        url.includes('/oauth/authorize')) {
      return { type: 'login_page', description: 'Twitter 로그인 페이지' };
    }
    
    // Twitter 메인 영역
    if ((url.includes('twitter.com') || url.includes('x.com')) &&
        !url.includes('/login') && 
        !url.includes('/i/flow') &&
        !url.includes('/oauth')) {
      return { type: 'twitter_main', description: 'Twitter 메인 영역' };
    }
    
    // 기타
    return { type: 'unknown', description: `알 수 없는 페이지: ${url}` };
  }

  /**
   * Twitter 로그인 완료 상태를 종합적으로 검증
   */
  private async validateTwitterLoginComplete(page: any): Promise<{
    isComplete: boolean;
    reason: string;
    details: any;
  }> {
    try {
      // 페이지 안정화 - 더 관대한 조건으로 변경
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
        console.log('✅ DOM content loaded');
      } catch (error) {
        console.warn('⚠️ DOM content loading timeout, continuing...');
      }
      
      // 추가 안정화 대기
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // 1단계: 기본 요소 확인
      const [loginButton, tweetButton, profileMenu, homeTimeline, sidebarNav] = await Promise.all([
        page.$('[data-testid="loginButton"]').catch(() => null),
        page.$('[data-testid="tweetButtonInline"]').catch(() => null),
        page.$('[data-testid="AppTabBar_Profile_Link"]').catch(() => null),
        page.$('[data-testid="primaryColumn"]').catch(() => null),
        page.$('[data-testid="sidebarColumn"]').catch(() => null)
      ]);
      
      // 2단계: 페이지 제목 및 URL 재확인  
      const pageTitle = await page.title();
      const currentUrl = page.url();
      
      // 3단계: 사용자 정보 요소 확인 (더 확실한 로그인 증거)
      const [userAvatar, composeButton, searchBox] = await Promise.all([
        page.$('[data-testid="DashButton_ProfileIcon_Link"]').catch(() => null),
        page.$('[data-testid="SideNav_NewTweet_Button"]').catch(() => null),
        page.$('[data-testid="SearchBox_Search_Input"]').catch(() => null)
      ]);

      const details = {
        url: currentUrl,
        title: pageTitle,
        elements: {
          loginButton: !!loginButton,
          tweetButton: !!tweetButton,
          profileMenu: !!profileMenu,
          homeTimeline: !!homeTimeline,
          sidebarNav: !!sidebarNav,
          userAvatar: !!userAvatar,
          composeButton: !!composeButton,
          searchBox: !!searchBox
        }
      };

      // 로그인 실패 조건들
      if (loginButton) {
        return {
          isComplete: false,
          reason: '로그인 버튼이 여전히 존재함',
          details
        };
      }

      if (pageTitle.includes('Log in') || pageTitle.includes('Sign up')) {
        return {
          isComplete: false,
          reason: '페이지 제목이 로그인 관련임',
          details
        };
      }

      // 로그인 성공 조건들 (더 엄격한 검증)
      const loggedInElements = [tweetButton, profileMenu, homeTimeline, sidebarNav].filter(Boolean).length;
      const userElements = [userAvatar, composeButton, searchBox].filter(Boolean).length;
      
      if (loggedInElements >= 2 && userElements >= 1) {
        return {
          isComplete: true,
          reason: `로그인 완료 - 기본 요소 ${loggedInElements}/4, 사용자 요소 ${userElements}/3`,
          details
        };
      }

      return {
        isComplete: false,
        reason: `요소 부족 - 기본 요소 ${loggedInElements}/4, 사용자 요소 ${userElements}/3`,
        details
      };

    } catch (error: any) {
      return {
        isComplete: false,
        reason: `검증 중 오류: ${error.message}`,
        details: { error: error.message }
      };
    }
  }

  /**
   * 브라우저 창 로그인 방식에서는 자격 증명을 미리 저장하지 않음
   * 사용자가 직접 브라우저에서 로그인하므로 이 메서드는 더 이상 사용되지 않음
   */
  updateCredentials(username: string, password: string): void {
    console.log('ℹ️ Twitter 브라우저 창 로그인 방식에서는 자격 증명을 저장하지 않습니다.');
    // 브라우저 창 로그인 방식에서는 자격 증명 저장이 필요 없음
  }
  
  /**
   * 로그아웃
   */
  async logout(): Promise<void> {
    try {
      this.isLoggedIn = false;
      this.sessionData = null;
      
      // 세션 파일 삭제
      if (fs.existsSync(this.sessionFile)) {
        fs.unlinkSync(this.sessionFile);
      }
      
      // 브라우저 재시작
      await this.closeBrowser();
      
      // 로그아웃 시 설정 업데이트
      await this.settingsService.updateSetting('needTwitterLogin', 'true');
      
      // MonitoringService를 통한 UI 업데이트 알림
      if (this.monitoringService && this.monitoringService.notifyTwitterLoginStatusChange) {
        console.log('📡 Twitter 로그아웃 상태 변경 알림 전송 중...');
        this.monitoringService.notifyTwitterLoginStatusChange(true);
      } else {
        console.warn('⚠️ MonitoringService가 없어서 UI 업데이트 알림을 보낼 수 없습니다.');
      }
      
      console.log('✅ Twitter logged out');
      
    } catch (error) {
      console.error('Twitter logout error:', error);
      // 오류 발생 시에도 설정 업데이트
      await this.settingsService.updateSetting('needTwitterLogin', 'true');
      
      // 오류 발생 시에도 UI 업데이트 알림
      if (this.monitoringService && this.monitoringService.notifyTwitterLoginStatusChange) {
        this.monitoringService.notifyTwitterLoginStatusChange(true);
      }
    }
  }

  // 사용자명 검증
  async validateUsername(username: string): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!this.isLoggedIn) {
        return { valid: false, error: 'Twitter 로그인이 필요합니다' };
      }
      
      if (!this.page) {
        await this.setupBrowser();
      }
      
      const profileUrl = `https://x.com/${username}`;
      await this.page!.goto(profileUrl, { 
        waitUntil: 'networkidle',
        timeout: this.timeoutConfig.getHttpTimeout('twitter_page')
      });
      
      await this.delay(2000);
      
      // 프로필이 존재하는지 확인
      const profileExists = await this.page!.$('[data-testid="UserName"]');
      const isNotFound = await this.page!.$('[data-testid="error-detail"]');
      
      if (profileExists && !isNotFound) {
        return { valid: true };
      } else {
        return { valid: false, error: '사용자를 찾을 수 없습니다' };
      }
      
    } catch (error) {
      return { valid: false, error: '사용자명을 확인할 수 없습니다' };
    }
  }

  // Twitter ID 숫자 비교 (BigInt 사용으로 정확한 비교)
  private compareTwitterIds(id1: string, id2: string): number {
    try {
      // Twitter IDs are 64-bit integers, use BigInt for accurate comparison
      const bigInt1 = BigInt(id1);
      const bigInt2 = BigInt(id2);
      
      if (bigInt1 > bigInt2) return 1;
      if (bigInt1 < bigInt2) return -1;
      return 0;
    } catch (error) {
      console.error('Failed to compare Twitter IDs as numbers, falling back to string comparison:', error);
      // Fallback to string comparison if BigInt conversion fails
      if (id1 > id2) return 1;
      if (id1 < id2) return -1;
      return 0;
    }
  }

  // 특정 스트리머의 트윗만 조용히 체크 (baseline 설정용)
  async checkSingleStreamerTweets(streamer: StreamerData): Promise<TwitterTweet[]> {
    try {
      if (!this.isLoggedIn) {
        console.warn(`❌ Twitter not logged in - cannot check ${streamer.name}`);
        return [];
      }
      
      return await this.checkStreamerTweets(streamer);
    } catch (error) {
      this.errorManager.recordError('TwitterMonitor-Single', error);
      console.error(`Failed to check tweets for ${streamer.name}:`, error);
      return [];
    }
  }
  
  /**
   * 로그인 상태 반환
   */
  getLoginStatus(): boolean {
    return this.isLoggedIn;
  }

  /**
   * 로그인 상태를 UI와 동기화
   */
  async syncLoginStatusWithUI(): Promise<void> {
    try {
      const currentSetting = this.settingsService.getSetting('needTwitterLogin') === 'true';
      const actualNeedLogin = !this.isLoggedIn;
      
      console.log(`🔍 Twitter login status sync check: setting=${currentSetting}, actual=${actualNeedLogin}, isLoggedIn=${this.isLoggedIn}`);
      
      // 설정과 실제 상태가 다르면 동기화
      if (currentSetting !== actualNeedLogin) {
        console.log(`🔄 Syncing Twitter login status: ${currentSetting} → ${actualNeedLogin}`);
        await this.settingsService.updateSetting('needTwitterLogin', actualNeedLogin);
        
        // MonitoringService를 통한 UI 업데이트 알림
        if (this.monitoringService && this.monitoringService.notifyTwitterLoginStatusChange) {
          this.monitoringService.notifyTwitterLoginStatusChange(actualNeedLogin);
        }
      }
    } catch (error) {
      console.error('Failed to sync Twitter login status with UI:', error);
    }
  }

  /**
   * 인스턴스 상태 확인 (초기화용)
   */
  async checkInstanceHealth(): Promise<void> {
    try {
      console.log('🔍 Twitter instance health check...');
      
      // 브라우저 상태 확인
      if (!this.browser || !this.context) {
        console.log('⚠️ Twitter browser not initialized - initializing...');
        await this.initialize();
      } else {
        console.log('✅ Twitter browser instance healthy');
      }
      
      // 로그인 상태 확인
      if (this.credentials.isConfigured) {
        const loginStatus = await this.checkLoginStatus();
        if (loginStatus) {
          console.log('✅ Twitter login status: healthy');
        } else {
          console.log('⚠️ Twitter login status: needs login');
        }
      } else {
        console.log('⚠️ Twitter credentials not configured');
      }
      
    } catch (error) {
      console.error('❌ Twitter instance health check failed:', error);
    }
  }
  
  /**
   * 자격 증명 설정 상태 반환
   */
  getCredentialsStatus(): boolean {
    return this.credentials.isConfigured;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 세션 만료 오류 감지
   */
  private isSessionExpired(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || '';
    return errorMessage.includes('login') ||
           errorMessage.includes('suspended') ||
           errorMessage.includes('unauthorized') ||
           errorMessage.includes('session') ||
           errorMessage.includes('authentication');
  }

  /**
   * 브라우저 크래시 감지
   */
  private isBrowserCrashed(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || '';
    return errorMessage.includes('browser') ||
           errorMessage.includes('crashed') ||
           errorMessage.includes('disconnected') ||
           errorMessage.includes('protocol error');
  }

  /**
   * 브라우저 재시작
   */
  private async restartBrowser(): Promise<void> {
    try {
      console.log('🔄 Restarting Twitter browser...');
      await this.closeBrowser();
      await this.delay(5000); // 5초 대기
      await this.setupBrowser();
      
      // 로그인 상태 복구 시도
      if (this.credentials.isConfigured) {
        await this.performLogin();
      }
      
      console.log('✅ Twitter browser restarted successfully');
    } catch (error) {
      console.error('❌ Failed to restart Twitter browser:', error);
    }
  }

  /**
   * 비밀번호 암호화 (AES-256-GCM)
   */
  private encryptPassword(password: string): string {
    try {
      if (!password) return '';
      
      // 머신 고유 키 사용 (보안 강화)
      const machineId = require('os').hostname() + require('os').userInfo().username;
      const key = crypto.scryptSync(machineId, 'twitter-salt', 32);
      
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher('aes-256-cbc', key);
      
      let encrypted = cipher.update(password, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('Failed to encrypt password:', error);
      return password; // 암호화 실패 시 원본 반환 (임시)
    }
  }

  /**
   * 비밀번호 복호화
   */
  private decryptPassword(encryptedPassword: string): string {
    try {
      if (!encryptedPassword || !encryptedPassword.includes(':')) {
        return encryptedPassword; // 암호화되지 않은 비밀번호
      }
      
      const machineId = require('os').hostname() + require('os').userInfo().username;
      const key = crypto.scryptSync(machineId, 'twitter-salt', 32);
      
      const [ivHex, encrypted] = encryptedPassword.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      
      const decipher = crypto.createDecipher('aes-256-cbc', key);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Failed to decrypt password:', error);
      return ''; // 복호화 실패 시 빈 문자열 반환
    }
  }

  /**
   * 세션 데이터 암호화
   */
  private encryptSessionData(sessionData: string): string {
    try {
      if (!sessionData) return '';
      
      const machineId = require('os').hostname() + require('os').userInfo().username;
      const key = crypto.scryptSync(machineId, 'twitter-session-salt', 32);
      
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher('aes-256-cbc', key);
      
      let encrypted = cipher.update(sessionData, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('Failed to encrypt session data:', error);
      return sessionData; // 암호화 실패 시 원본 반환
    }
  }

  /**
   * 세션 데이터 복호화
   */
  private decryptSessionData(encryptedData: string): string {
    try {
      if (!encryptedData || !encryptedData.includes(':')) {
        return ''; // 암호화되지 않은 데이터는 복호화 불가
      }
      
      const machineId = require('os').hostname() + require('os').userInfo().username;
      const key = crypto.scryptSync(machineId, 'twitter-session-salt', 32);
      
      const [ivHex, encrypted] = encryptedData.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      
      const decipher = crypto.createDecipher('aes-256-cbc', key);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Failed to decrypt session data:', error);
      return ''; // 복호화 실패 시 빈 문자열 반환
    }
  }

  // 정리 작업
  async cleanup(): Promise<void> {
    this.lastTweetIds.clear();
    await this.closeBrowser();
  }
}