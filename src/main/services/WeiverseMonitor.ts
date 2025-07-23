import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import { app } from 'electron';
import { DatabaseManager } from './DatabaseManager';
import { NotificationService } from './NotificationService';
import { SettingsService } from './SettingsService';
import { SessionManager } from './SessionManager';
import { weverseLogger, sessionLogger } from './CategoryLogger';
import { WeverseArtist } from '@shared/types';

export interface WeiverseNotification {
  id: string;
  artistName: string;
  title: string;
  content: string;
  url: string;
  timestamp: Date;
  type: 'artist' | 'general';
  timeText?: string;
  profileImageUrl?: string;
}

export interface WeiverseArtist {
  name: string;
  profileImageUrl?: string;
}

export class WeiverseMonitor {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isPersistentContext: boolean = false;
  private databaseManager: DatabaseManager;
  private notificationService: NotificationService;
  private settingsService: SettingsService;
  private sessionManager: SessionManager;
  private browserDataPath: string;
  private isLoggedIn: boolean = false;
  private loginCheckInProgress: boolean = false;
  private lastKnownLoginStatus: boolean = false;
  private lastNotificationIds: Map<string, string> = new Map();
  
  // 토큰 갱신 관리
  private tokenExpiryTime: number = 0; // 토큰 만료 시간 (밀리초)
  private lastTokenRefreshCheck: number = 0;
  private tokenRefreshInterval: number = 30 * 60 * 1000; // 30분 간격으로 만료 시간 체크
  private preemptiveRefreshHours: number = 6; // 6시간 전 선제적 갱신
  
  // 디버깅 및 메트릭 수집
  private sessionMetrics = {
    loginAttempts: 0,
    loginSuccesses: 0,
    sessionFailures: 0,
    tokenRefreshAttempts: 0,
    tokenRefreshSuccesses: 0,
    cookieRecoveryAttempts: 0,
    cookieRecoverySuccesses: 0,
    lastLoginTime: 0,
    totalUptime: 0,
    sessionStateChanges: [] as Array<{
      timestamp: number;
      from: string;
      to: string;
      reason: string;
      success: boolean;
    }>
  };

  // 쿠키 관리 상수 정의
  private static readonly CRITICAL_COOKIES = {
    // 최고 우선순위 - 인증 토큰
    HIGH_PRIORITY: [
      'we2_access_token',
      'we2_refresh_token',
      'access_token',
      'refresh_token'
    ],
    // 중간 우선순위 - 세션 관리
    MEDIUM_PRIORITY: [
      'weverse_session',
      'session_id',
      'auth_token',
      'JSESSIONID'
    ],
    // 낮은 우선순위 - 사용자 설정
    LOW_PRIORITY: [
      'user_id',
      'user_settings',
      'locale',
      'timezone'
    ]
  };

  private static readonly WEVERSE_DOMAINS = [
    'weverse.io',
    '.weverse.io',
    'account.weverse.io',
    '.account.weverse.io',
    'api.weverse.io',
    '.api.weverse.io',
    'global.weverse.io',
    '.global.weverse.io',
    'static.weverse.io',
    '.static.weverse.io'
  ];

  /**
   * 위버스 시간 형식(예: "2025. 07. 01 21:19")을 JavaScript Date 객체로 변환
   * @param timeText 위버스에서 파싱한 시간 문자열
   * @returns JavaScript Date 객체 (UTC 기준)
   */
  // parseWeverseTime 함수는 1270줄에 있는 중복 구현을 사용합니다

  /**
   * 위버스 URL에서 고유한 ID를 추출하는 함수
   * @param url 위버스 URL
   * @returns 추출된 ID 문자열
   */
  private extractWeverseId(url: string): string {
    // ID 추출 로그 간소화 - 개별 URL 처리는 DEBUG 레벨
    
    // 위버스 Live URL 형식: /live/2-161749779 또는 /live/2-161749779?params
    const liveMatch = url.match(/\/live\/([^?#]+)/);
    if (liveMatch) {
      // console.log(`[EXTRACT_ID] ✅ Found Live ID: ${liveMatch[1]}`); // 상세 로그 제거
      return liveMatch[1];
    }
    
    // 위버스 일반 게시물 URL 형식: /artist/2-161749779 또는 /moment/2-161749779
    const postMatch = url.match(/\/(?:artist|moment|media)\/([^?#]+)/);
    if (postMatch) {
      // console.log(`[EXTRACT_ID] ✅ Found Post ID: ${postMatch[1]}`); // 상세 로그 제거
      return postMatch[1];
    }
    
    // 위버스 아티스트 페이지 URL 형식: /artistname/live/2-161749779
    const artistLiveMatch = url.match(/\/[^/]+\/live\/([^?#]+)/);
    if (artistLiveMatch) {
      // console.log(`[EXTRACT_ID] ✅ Found Artist Live ID: ${artistLiveMatch[1]}`); // ID 추출 로그 간소화
      return artistLiveMatch[1];
    }
    
    // 위버스 아티스트 게시물 URL 형식: /artistname/artist/2-161749779
    const artistPostMatch = url.match(/\/[^/]+\/(?:artist|moment|media)\/([^?#]+)/);
    if (artistPostMatch) {
      // console.log(`[EXTRACT_ID] ✅ Found Artist Post ID: ${artistPostMatch[1]}`); // ID 추출 로그 간소화
      return artistPostMatch[1];
    }
    
    // 기존 방식 (숫자만 추출) - 백워드 호환성
    const numericMatch = url.match(/\/(\d+)(?:[?#]|$)/);
    if (numericMatch) {
      // console.log(`[EXTRACT_ID] ✅ Found Numeric ID: ${numericMatch[1]}`); // ID 추출 로그 간소화
      return numericMatch[1];
    }
    
    // 모든 패턴이 실패하면 URL 해시 사용 (타임스탬프 대신)
    const urlHash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
    // console.log(`[EXTRACT_ID] ⚠️ No ID pattern matched, using URL hash: ${urlHash}`); // 상세 로그 제거
    return urlHash;
  }

  /**
   * 제목과 URL을 조합하여 내용 해시를 생성하는 함수
   * @param title 알림 제목
   * @param url 알림 URL
   * @returns 8자리 해시 문자열
   */
  private createContentHash(title: string, url: string): string {
    const hashContent = `${title}${url}`;
    return crypto.createHash('md5').update(hashContent).digest('hex').substring(0, 8);
  }

  constructor(
    databaseManager: DatabaseManager,
    notificationService: NotificationService,
    settingsService: SettingsService
  ) {
    this.databaseManager = databaseManager;
    this.notificationService = notificationService;
    this.settingsService = settingsService;
    this.sessionManager = new SessionManager('weverse');
    
    const userDataPath = app.getPath('userData');
    this.browserDataPath = path.join(userDataPath, 'weverse_browser_data');
  }

  async initialize(): Promise<void> {
    try {
      await this.setupBrowser();
      
      // 초기화 시 로그인 상태 확인
      console.log('🔄 위버스 모니터 초기화 중...');
      const loginStatus = await this.checkLoginStatus();
      
      if (loginStatus) {
        console.log('✅ 위버스 모니터 초기화 완료 - 로그인 상태 유지됨');
      } else {
        console.log('⚠️ 위버스 모니터 초기화 완료 - 로그인 필요');
      }
    } catch (error) {
      console.error('Failed to initialize Weverse monitor:', error);
    }
  }

  private async ensureBrowserInstalled(): Promise<void> {
    try {
      // 브라우저 설치 확인 로그 간소화
      const browserPath = chromium.executablePath();
      
      if (browserPath && fs.existsSync(browserPath)) {
        // console.log('✅ Playwright Chromium already installed'); // 브라우저 설치 로그 간소화
        return;
      }
      
      console.log('📦 Playwright Chromium 설치 중...');
      
      let playwrightCliPath: string;
      
      if (app.isPackaged) {
        playwrightCliPath = path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
          'playwright',
          'cli.js'
        );
      } else {
        playwrightCliPath = path.join(
          __dirname,
          '..',
          '..',
          '..',
          'node_modules',
          'playwright',
          'cli.js'
        );
      }
      
      if (fs.existsSync(playwrightCliPath)) {
        // console.log('Installing Chromium browser for Weverse...'); // 브라우저 설치 로그 간소화
        
        const electronNodePath = process.execPath;
        execSync(`"${electronNodePath}" "${playwrightCliPath}" install chromium`, {
          stdio: 'pipe',
          timeout: 120000
        });
        console.log('✅ Playwright Chromium 설치 완료');
      } else {
        console.warn('⚠️ Playwright CLI 없음 - 수동 설치 필요');
      }
    } catch (error: any) {
      console.error('❌ Failed to install Playwright browser:', error.message);
    }
  }

  private async setupBrowser(): Promise<void> {
    if (this.context) return;

    try {
      await this.ensureBrowserInstalled();
      
      this.context = await chromium.launchPersistentContext(this.browserDataPath, {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=VizDisplayCompositor',
          '--disable-web-security',
          '--disable-features=TranslateUI',
          '--disable-extensions-except',
          '--disable-plugins-discovery',
          '--disable-default-apps',
          '--disable-component-extensions-with-background-pages'
        ],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'ko-KR',
        extraHTTPHeaders: {
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
        },
        // 세션 지속성 강화를 위한 추가 설정
        acceptDownloads: false,
        permissions: ['notifications'],
        colorScheme: 'no-preference'
      });

      this.isPersistentContext = true;
      this.page = await this.context.newPage();
      
      // 자동화 감지 우회 스크립트 주입
      await this.page.addInitScript(() => {
        // webdriver property 제거
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        
        // plugins 배열에 가짜 플러그인 추가
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        
        // languages 속성 설정
        Object.defineProperty(navigator, 'languages', {
          get: () => ['ko-KR', 'ko', 'en-US', 'en'],
        });
        
        // chrome property 추가
        (window as any).chrome = {
          runtime: {},
        };
        
        // permissions property 추가
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission } as PermissionStatus) :
            originalQuery(parameters)
        );
      });
      
      this.page.setDefaultTimeout(15000);
      
      // console.log('Weverse browser initialized with persistent context'); // 브라우저 초기화 로그 간소화
      
      // 세션 복원 시도
      await this.attemptSessionRestore();
      
    } catch (error) {
      console.error('Failed to setup Weverse browser:', error);
      throw error;
    }
  }

  async checkLoginStatus(): Promise<boolean> {
    const startTime = Date.now();
    this.logSessionStateChange('checking', 'check-initiated', 'Login status check started', false);
    
    if (this.loginCheckInProgress) {
      console.log('🔄 Weverse login check already in progress, returning cached status');
      this.logSessionStateChange('checking', 'check-cached', `Returned cached status: ${this.lastKnownLoginStatus}`, false);
      return this.lastKnownLoginStatus;
    }

    this.loginCheckInProgress = true;

    let loginCheckPage: Page | null = null;
    
    try {
      if (!this.context) {
        await this.setupBrowser();
      }

      weverseLogger.info('위버스 로그인 상태 확인 시작');
      
      // 세션 무결성 먼저 검사
      const sessionIntegrity = await this.validateSessionIntegrity();
      if (!sessionIntegrity) {
        console.log('❌ 세션 무결성 검사 실패 - 로그인 필요');
        this.isLoggedIn = false;
        this.lastKnownLoginStatus = false;
        this.settingsService.updateSetting('needWeverseLogin', true).catch(() => {});
        this.notifyWeverseLoginStatusChange(true);
        
        // 세션 무결성 실패 로깅
        const checkDuration = Date.now() - startTime;
        this.logSessionStateChange('checking', 'check-failed', `Session integrity failed after ${checkDuration}ms`, true);
        console.log(`❌ 위버스 로그인 상태 체크 실패 - 세션 무결성 (소요시간: ${checkDuration}ms)`);
        
        return false;
      }
      
      loginCheckPage = await this.context!.newPage();
      
      await loginCheckPage.goto('https://weverse.io/', { 
        waitUntil: 'networkidle',
        timeout: 20000
      });
      
      // JavaScript 로딩 완료까지 충분히 대기
      console.log('🔄 위버스 페이지 완전 로딩 대기 중...');
      await loginCheckPage.waitForTimeout(3000);
      
      try {
        await loginCheckPage.waitForSelector('body', { timeout: 10000 });
        console.log('✅ 위버스 body 요소 확인됨');
      } catch (selectorError) {
        console.warn('⚠️ Weverse body selector not found');
      }
      
      // 더 강화된 로그인 상태 확인 로직
      const loginCheckResult = await loginCheckPage.evaluate(() => {
        // 로그인 관련 요소들 확인 (더 포괄적인 선택자)
        const loginButtonSelectors = [
          '[data-testid="login-button"]',
          '.login-button',
          '[href*="login"]',
          'button[type="submit"]',
          '.sc-a6d4bcd5-1' // 위버스 로그인 페이지의 실제 클래스
        ];
        
        const signupButtonSelectors = [
          '[href*="signup"]',
          '.signup-button',
          '[data-testid="signup-button"]'
        ];
        
        const userProfileSelectors = [
          '[data-testid="user-profile"]',
          '.user-profile',
          '.HeaderNotificationWrapperView_notification__hCLgg',
          '.user-menu',
          'img[alt*="profile"]',
          'img[alt*="avatar"]',
          '[data-testid="user-menu"]'
        ];
        
        // 쿠키 기반 로그인 상태 확인 (더 정확한 방법)
        const cookies = document.cookie;
        console.log('📋 현재 페이지 쿠키:', cookies);
        
        // 위버스 인증 쿠키 패턴 확장
        const authCookiePatterns = [
          'we2_access_token',
          'we2_refresh_token', 
          'access_token',
          'refresh_token',
          'weverse_session',
          'session_id',
          'auth_token'
        ];
        
        const foundAuthCookies = authCookiePatterns.filter(pattern => 
          cookies.includes(pattern + '=')
        );
        
        const hasAuthCookies = foundAuthCookies.length > 0;
        console.log('🔑 발견된 인증 쿠키:', foundAuthCookies);
        
        // 각 선택자로 요소 찾기
        let loginButton = null;
        let signupButton = null;
        let userProfile = null;
        
        for (const selector of loginButtonSelectors) {
          try {
            loginButton = document.querySelector(selector);
            if (loginButton) break;
          } catch (e) {
            // 선택자 오류 무시
          }
        }
        
        for (const selector of signupButtonSelectors) {
          try {
            signupButton = document.querySelector(selector);
            if (signupButton) break;
          } catch (e) {
            // 선택자 오류 무시
          }
        }
        
        for (const selector of userProfileSelectors) {
          try {
            userProfile = document.querySelector(selector);
            if (userProfile) break;
          } catch (e) {
            // 선택자 오류 무시
          }
        }
        
        // 페이지 URL 기반 로그인 상태 확인
        const currentUrl = window.location.href;
        const isLoginPage = currentUrl.includes('account.weverse.io') || 
                           currentUrl.includes('login') || 
                           currentUrl.includes('signup');
        
        // 페이지 제목 기반 확인
        const pageTitle = document.title;
        const isLoginPageTitle = pageTitle.includes('로그인') || 
                               pageTitle.includes('Login') || 
                               pageTitle.includes('Account');
        
        // 페이지 텍스트 기반 확인
        const bodyText = document.body?.innerText || '';
        const hasSignInText = bodyText.includes('Sign in') || bodyText.includes('로그인');
        
        // 로그인 상태 판별 로직 개선
        const hasLoginElements = !!loginButton || !!signupButton || hasSignInText;
        const hasUserElements = !!userProfile;
        const isOnMainSite = currentUrl.includes('weverse.io') && !isLoginPage;
        
        // 우선순위: 쿠키 > UI 요소
        let isLoggedIn = false;
        let loginMethod = '';
        
        if (hasAuthCookies) {
          // 인증 쿠키가 있으면 로그인된 것으로 판단 (가장 신뢰할 수 있는 방법)
          isLoggedIn = true;
          loginMethod = 'cookie-based';
        } else if (isOnMainSite && hasUserElements && !hasLoginElements) {
          // 메인 사이트에서 사용자 요소가 있고 로그인 요소가 없으면 로그인된 것으로 판단
          isLoggedIn = true;
          loginMethod = 'ui-based';
        } else if (isOnMainSite && !hasSignInText && !hasLoginElements) {
          // 로그인 관련 텍스트나 버튼이 전혀 없으면 로그인된 것으로 판단
          isLoggedIn = true;
          loginMethod = 'negative-check';
        } else {
          loginMethod = 'not-logged-in';
        }
        
        return {
          isLoggedIn,
          hasAuthCookies,
          loginMethod,
          cookieCount: cookies.split(';').filter(c => c.trim()).length,
          loginButton: !!loginButton,
          signupButton: !!signupButton,
          userProfile: !!userProfile,
          notificationButton: !!document.querySelector('.HeaderNotificationWrapperView_notification__hCLgg'),
          userMenu: !!document.querySelector('[data-testid="user-menu"]'),
          avatarImage: !!document.querySelector('img[alt*="profile"], img[alt*="avatar"]'),
          isLoginPage,
          isLoginPageTitle,
          isOnMainSite,
          hasLoginElements,
          hasUserElements,
          hasSignInText,
          pageTitle,
          url: currentUrl,
          bodyContent: document.body?.innerText?.substring(0, 200) || ''
        };
      });
      
      // 상세한 로그인 상태 체크 결과 로깅
      weverseLogger.info('로그인 상태 체크 완료', {
        isLoggedIn: loginCheckResult.isLoggedIn,
        loginMethod: loginCheckResult.loginMethod,
        hasAuthCookies: loginCheckResult.hasAuthCookies,
        cookieCount: loginCheckResult.cookieCount,
        url: loginCheckResult.url,
        pageTitle: loginCheckResult.pageTitle
      });

      weverseLogger.debug('UI 요소 감지 결과', {
        loginButton: loginCheckResult.loginButton,
        signupButton: loginCheckResult.signupButton,
        userProfile: loginCheckResult.userProfile,
        notificationButton: loginCheckResult.notificationButton,
        userMenu: loginCheckResult.userMenu,
        avatarImage: loginCheckResult.avatarImage,
        hasLoginElements: loginCheckResult.hasLoginElements,
        hasUserElements: loginCheckResult.hasUserElements,
        hasSignInText: loginCheckResult.hasSignInText
      });

      weverseLogger.debug('페이지 상태 분석', {
        isLoginPage: loginCheckResult.isLoginPage,
        isLoginPageTitle: loginCheckResult.isLoginPageTitle,
        isOnMainSite: loginCheckResult.isOnMainSite
        // bodyContent 로그 제거 - 내용이 너무 길어서 로그 가독성 저하
      });
      
      console.log('🔍 위버스 로그인 상태 체크 결과:', {
        isLoggedIn: loginCheckResult.isLoggedIn,
        hasAuthCookies: loginCheckResult.hasAuthCookies,
        loginMethod: loginCheckResult.loginMethod,
        cookieCount: loginCheckResult.cookieCount,
        url: loginCheckResult.url,
        pageTitle: loginCheckResult.pageTitle
        // bodyContent 등 상세 내용은 로그에서 제외
      });
      
      const isLoggedIn = loginCheckResult.isLoggedIn;
      
      // Winston 로깅 추가
      weverseLogger.info('로그인 상태 확인 완료', {
        isLoggedIn,
        loginMethod: loginCheckResult.loginMethod,
        hasAuthCookies: loginCheckResult.hasAuthCookies,
        cookieCount: loginCheckResult.cookieCount,
        checkDuration: Date.now() - startTime
      });
      
      this.isLoggedIn = isLoggedIn;
      this.lastKnownLoginStatus = isLoggedIn;
      
      this.settingsService.updateSetting('needWeverseLogin', !isLoggedIn).catch(err => {
        console.warn('Failed to update needWeverseLogin setting:', err);
      });
      
      // UI에 위버스 로그인 상태 변경 즉시 알림
      this.notifyWeverseLoginStatusChange(!isLoggedIn);
      
      weverseLogger.info(`위버스 로그인 상태: ${isLoggedIn ? '로그인됨' : '로그아웃됨'}`);
      
      // 로그인 상태 체크 성공 로깅
      const checkDuration = Date.now() - startTime;
      const statusText = isLoggedIn ? 'logged-in' : 'logged-out';
      this.logSessionStateChange('checking', statusText, `Login status check completed in ${checkDuration}ms (${loginCheckResult.loginMethod})`, true);
      console.log(`✅ 위버스 로그인 상태 체크 완료: ${statusText} (소요시간: ${checkDuration}ms, 방식: ${loginCheckResult.loginMethod})`);
      
      return isLoggedIn;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      weverseLogger.error('로그인 상태 확인 실패', { 
        error: errorMessage,
        checkDuration: Date.now() - startTime 
      });
      console.error('Failed to check Weverse login status:', error);
      
      this.isLoggedIn = false;
      this.lastKnownLoginStatus = false;
      
      this.settingsService.updateSetting('needWeverseLogin', true).catch(() => {});
      this.notifyWeverseLoginStatusChange(true);
      
      // 로그인 상태 체크 오류 로깅
      const checkDuration = Date.now() - startTime;
      this.logSessionStateChange('checking', 'check-error', `Login status check error after ${checkDuration}ms: ${errorMessage}`, true);
      console.log(`❌ 위버스 로그인 상태 체크 오류 (소요시간: ${checkDuration}ms):`, errorMessage);
      
      return false;
      
    } finally {
      if (loginCheckPage) {
        try {
          await loginCheckPage.close();
        } catch (closeError) {
          console.warn('Failed to close Weverse login check page:', closeError);
        }
      }
      
      this.loginCheckInProgress = false;
    }
  }

  async ensureLoggedIn(): Promise<boolean> {
    if (this.isLoggedIn) {
      // 세션이 여전히 유효한지 확인
      if (await this.validateSessionIntegrity()) {
        return true;
      } else {
        console.log('🔄 세션 무결성 검사 실패, 로그인 상태 재확인');
        this.isLoggedIn = false;
      }
    }

    return await this.checkLoginStatus();
  }

  private async handleSessionExpiry(): Promise<void> {
    console.log('🔄 세션 만료 처리 중...');
    
    try {
      // 상태 초기화
      this.isLoggedIn = false;
      this.lastKnownLoginStatus = false;
      
      // 설정 업데이트
      await this.settingsService.updateSetting('needWeverseLogin', true);
      
      // 쿠키 정리
      if (this.context) {
        await this.context.clearCookies();
        console.log('만료된 세션 쿠키 정리 완료');
      }
      
      console.log('✅ 세션 만료 처리 완료');
    } catch (error) {
      console.error('❌ 세션 만료 처리 실패:', error);
    }
  }

  private async recoverFromLoginFailure(): Promise<boolean> {
    console.log('🔄 로그인 실패 복구 시도 중...');
    
    try {
      // 1. 세션 정리
      await this.handleSessionExpiry();
      
      // 2. 브라우저 컨텍스트 재설정
      if (this.context) {
        console.log('브라우저 컨텍스트 재설정 중...');
        await this.context.clearCookies();
        
        // 새로운 페이지 생성하여 테스트
        const testPage = await this.context.newPage();
        await testPage.goto('https://weverse.io/', { 
          waitUntil: 'domcontentloaded',
          timeout: 10000 
        });
        await testPage.close();
        
        console.log('브라우저 컨텍스트 재설정 완료');
      }
      
      // 3. 로그인 상태 재확인
      const loginStatus = await this.checkLoginStatus();
      
      if (loginStatus) {
        console.log('✅ 로그인 실패 복구 성공');
        return true;
      } else {
        console.log('⚠️ 로그인 실패 복구 실패 - 수동 로그인 필요');
        return false;
      }
      
    } catch (error) {
      console.error('❌ 로그인 실패 복구 중 오류:', error);
      return false;
    }
  }

  async initiateLogin(): Promise<boolean> {
    const startTime = Date.now();
    const previousLoginStatus = this.isLoggedIn ? 'logged-in' : 'logged-out';
    
    try {
      // 로그인 시도 메트릭 시작
      this.logSessionStateChange(previousLoginStatus, 'login-attempt', 'User initiated login', true);
      console.log('🔄 위버스 로그인 시도 시작...');
      
      // 동일한 프로필 디렉토리 사용을 위해 기존 컨텍스트 종료
      if (this.context) {
        console.log('🔄 로그인을 위해 기존 브라우저 컨텍스트 종료...');
        await this.context.close();
        this.context = null;
      }
      
      // 사용자 프로필 경로 설정 (영구 프로필 사용 - 모니터링과 동일한 컨텍스트)
      const userDataDir = this.browserDataPath;
      
      const loginBrowser = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: [
          '--no-first-run',
          '--disable-blink-features=AutomationControlled'
        ]
      });

      // PersistentContext 사용 시 별도 context 생성 불필요
      const loginPage = await loginBrowser.newPage();
      
      // 최소한의 자동화 감지 우회만 적용
      await loginPage.addInitScript(() => {
        // webdriver property만 제거 (가장 기본적인 우회)
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        
        // 자동화 관련 property 제거
        delete (navigator as any).__proto__.webdriver;
      });
      
      await loginPage.goto('https://account.weverse.io/ko/signup?client_id=weverse&redirect_uri=https%3A%2F%2Fweverse.io%2F&redirect_method=COOKIE', { 
        waitUntil: 'networkidle' 
      });
      
      console.log('Waiting for user to login to Weverse...');
      
      try {
        await loginPage.waitForURL('https://weverse.io/', { timeout: 120000 }); // 2분으로 단축
        
        console.log('Weverse login completed successfully');
        
        const allCookies = await loginBrowser.cookies();
        console.log(`전체 쿠키 개수: ${allCookies.length}`);
        
        // 새로운 쿠키 분석 시스템을 사용하여 쿠키 분석
        const analysis = this.analyzeCookiesByPriority(allCookies);
        console.log(`📊 로그인 쿠키 분석 결과: ${analysis.summary}`);
        
        // 우선순위별 쿠키 로깅
        if (analysis.highPriority.length > 0) {
          console.log('🔑 고우선순위 쿠키:');
          analysis.highPriority.forEach(cookie => {
            console.log(`  - ${cookie.name} (도메인: ${cookie.domain})`);
          });
        }
        
        // 모든 위버스 쿠키 수집 (우선순위별로 정렬됨)
        const weversesCookies = [
          ...analysis.highPriority,
          ...analysis.mediumPriority,
          ...analysis.lowPriority
        ];
        
        // 쿠키 만료 시간 연장 처리 (스코프 외부에서 정의)
        const enhancedCookies = weversesCookies.map(cookie => {
          const enhanced = { ...cookie };
          
          // expires가 -1이거나 짧은 경우 30일로 연장 (더 긴 유지 기간)
          if (!cookie.expires || cookie.expires === -1 || cookie.expires < Date.now() / 1000 + 86400) {
            enhanced.expires = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30일
            weverseLogger.info('쿠키 만료 시간 연장', { 
              cookieName: cookie.name, 
              domain: cookie.domain, 
              newExpiry: new Date(enhanced.expires * 1000).toISOString() 
            });
            console.log(`🔧 쿠키 만료 시간 연장: ${cookie.name} (30일)`);
          }
          
          return enhanced;
        });
        
        if (this.context) {
          try {
            // 기존 쿠키 정리
            await this.cleanupExpiredCookies();
            console.log('기존 쿠키 정리 완료');
            
            // 새로운 백업/복원 시스템으로 쿠키 처리
            if (weversesCookies.length > 0) {
              console.log('🔄 향상된 쿠키 백업/복원 시스템 사용...');
              
              // 새로운 복원 메서드 사용
              const restored = await this.restoreCriticalCookies(enhancedCookies);
              
              if (restored) {
                console.log('✅ 쿠키 복원 성공');
                
                // 쿠키 동기화를 위해 짧은 대기
                console.log('⏱️ 쿠키 동기화 대기 중...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // 복원 후 확인
                await this.logFinalCookieState();
              } else {
                console.warn('⚠️ 쿠키 복원 실패 - 수동 처리 필요');
              }
            } else {
              console.warn('⚠️ 복사할 위버스 쿠키가 없습니다');
            }
          } catch (error) {
            console.error('위버스 쿠키 복사 실패:', error);
            
            // 쿠키 복사 실패 시 개별 쿠키 처리 시도
            await this.fallbackCookieCopy(weversesCookies);
          }
        }
        
        // 중요: 로그인 브라우저 종료 전에 모니터링 컨텍스트를 먼저 설정
        console.log('🔄 모니터링 브라우저 컨텍스트 재시작 (쿠키 동기화 전)...');
        try {
          // 기존 컨텍스트가 있다면 종료
          if (this.context) {
            try {
              await (this.context as any).close();
              this.context = null;
            } catch (error) {
              console.warn('⚠️ 기존 컨텍스트 종료 중 오류:', error);
              this.context = null;
            }
          }
          
          // 새로운 모니터링 컨텍스트 생성
          await this.setupBrowser();
          console.log('✅ 모니터링 브라우저 컨텍스트 재시작 완료');
          
          // 이제 쿠키를 모니터링 컨텍스트로 다시 복사
          if (weversesCookies.length > 0 && this.context) {
            console.log('🔄 모니터링 컨텍스트로 쿠키 복사 중...');
            const restored = await this.restoreCriticalCookies(enhancedCookies);
            if (restored) {
              weverseLogger.info('모니터링 컨텍스트 쿠키 복사 성공', { 
                cookieCount: enhancedCookies.length 
              });
              console.log('✅ 모니터링 컨텍스트 쿠키 복사 성공');
            } else {
              weverseLogger.warn('모니터링 컨텍스트 쿠키 복사 실패');
              console.warn('⚠️ 모니터링 컨텍스트 쿠키 복사 실패');
            }
          }
          
        } catch (setupError) {
          const errorMsg = setupError instanceof Error ? setupError.message : String(setupError);
          weverseLogger.error('모니터링 컨텍스트 재시작 실패', { error: errorMsg });
          console.warn('⚠️ 모니터링 브라우저 컨텍스트 재시작 실패:', setupError);
        }
        
        // 로그인 성공 시 세션 파일에 저장 (로그인 브라우저의 쿠키 직접 저장)
        if (weversesCookies.length > 0) {
          await this.sessionManager.saveCookiesToFile('weverse', weversesCookies);
          weverseLogger.info('로그인 브라우저에서 세션 저장 완료', { cookieCount: weversesCookies.length });
          console.log(`💾 세션 저장 완료: ${weversesCookies.length}개 쿠키`);
        }
        
        // 추가로 모니터링 컨텍스트에서도 저장 시도
        await this.saveCurrentSession();
        
        // 로그인 성공 시 설정 즉시 업데이트
        await this.settingsService.updateSetting('needWeverseLogin', false);
        this.notifyWeverseLoginStatusChange(false);
        
        // 쿠키 동기화 완료 후 브라우저 종료 (1초 대기)
        console.log('🔄 쿠키 동기화 완료, 1초 후 로그인 브라우저 종료...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await loginBrowser.close();
        console.log('✅ 위버스 로그인 브라우저 종료 완료');
        
        // 브라우저 종료 후 백그라운드에서 세션 확인 (브라우저 종료와 독립적)
        console.log('🔄 백그라운드에서 세션 확인 중...');
        this.verifySessionInBackground();
        
        // 로그인 성공 메트릭 기록
        this.sessionMetrics.loginSuccesses++;
        const loginDuration = Date.now() - startTime;
        this.logSessionStateChange(previousLoginStatus, 'logged-in', `Login successful in ${loginDuration}ms`, true);
        
        weverseLogger.info('로그인 성공', {
          duration: loginDuration,
          totalCookies: allCookies.length,
          weversesCookies: weversesCookies.length,
          highPriorityCookies: analysis.highPriority?.length || 0,
          loginAttempts: this.sessionMetrics.loginAttempts,
          loginSuccesses: this.sessionMetrics.loginSuccesses
        });
        
        console.log(`✅ 위버스 로그인 성공 (소요시간: ${loginDuration}ms)`);
        
        return true; // 로그인 성공 반환
      } catch (error) {
        console.log('Weverse login timeout or failed');
        await loginBrowser.close();
        
        // 로그인 실패 시에도 모니터링 컨텍스트 복구
        console.log('🔄 로그인 실패 - 모니터링 브라우저 컨텍스트 복구...');
        try {
          await this.setupBrowser();
          console.log('✅ 모니터링 브라우저 컨텍스트 복구 완료');
        } catch (setupError) {
          console.warn('⚠️ 모니터링 브라우저 컨텍스트 복구 실패:', setupError);
        }
        
        // 로그인 실패 메트릭 기록 (타임아웃/실패)
        this.sessionMetrics.sessionFailures++;
        const loginDuration = Date.now() - startTime;
        this.logSessionStateChange(previousLoginStatus, 'login-failed', `Login timeout/failed after ${loginDuration}ms`, true);
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        weverseLogger.warn('로그인 타임아웃/실패', {
          duration: loginDuration,
          error: errorMessage,
          loginAttempts: this.sessionMetrics.loginAttempts,
          sessionFailures: this.sessionMetrics.sessionFailures
        });
        
        console.log(`❌ 위버스 로그인 실패 - 타임아웃 (소요시간: ${loginDuration}ms)`);
        
        return false;
      }
    } catch (error) {
      console.error('Failed to initiate Weverse login:', error);
      
      // 예외 발생 시에도 모니터링 컨텍스트 복구 시도
      console.log('🔄 로그인 예외 발생 - 모니터링 브라우저 컨텍스트 복구...');
      try {
        await this.setupBrowser();
        console.log('✅ 모니터링 브라우저 컨텍스트 복구 완료');
      } catch (setupError) {
        console.warn('⚠️ 모니터링 브라우저 컨텍스트 복구 실패:', setupError);
      }
      
      // 로그인 실패 메트릭 기록 (예외 발생)
      this.sessionMetrics.sessionFailures++;
      const loginDuration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logSessionStateChange(previousLoginStatus, 'login-error', `Login exception after ${loginDuration}ms: ${errorMessage}`, true);
      console.log(`❌ 위버스 로그인 실패 - 예외 발생 (소요시간: ${loginDuration}ms):`, errorMessage);
      
      return false;
    }
  }

  // 백그라운드에서 세션 확인 (브라우저 종료와 독립적)
  private async verifySessionInBackground(): Promise<void> {
    try {
      // 5초 대기 후 세션 확인
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      console.log('🔍 백그라운드 세션 확인 시작...');
      
      if (this.context) {
        const testPage = await this.context.newPage();
        try {
          await testPage.goto('https://weverse.io/', { 
            waitUntil: 'domcontentloaded',
            timeout: 10000 
          });
          
          const cookies = await testPage.evaluate(() => document.cookie);
          const cookieCount = cookies.split(';').filter(c => c.trim()).length;
          console.log(`🍪 백그라운드 세션 확인: ${cookieCount}개 쿠키 감지`);
          
          await testPage.close();
        } catch (error) {
          console.warn('⚠️ 백그라운드 세션 확인 오류:', error);
          await testPage.close();
        }
      }
      
      console.log('✅ 백그라운드 세션 확인 완료');
    } catch (error) {
      console.error('❌ 백그라운드 세션 확인 실패:', error);
    }
  }

  private async logFinalCookieState(): Promise<void> {
    if (this.context) {
      try {
        const finalAnalysis = this.analyzeCookiesByPriority(await this.context.cookies());
        console.log(`📊 최종 쿠키 상태: ${finalAnalysis.summary}`);
      } catch (error) {
        console.warn('⚠️ 최종 쿠키 상태 확인 실패:', error);
      }
    }
  }

  private async fallbackCookieCopy(weversesCookies: any[]): Promise<void> {
    weverseLogger.info('개별 쿠키 복사 시도 시작', { totalCookies: weversesCookies.length });
    console.log('개별 쿠키 복사 시도...');
    let successCount = 0;
    const failedCookies: string[] = [];
    
    if (this.context) {
      for (const cookie of weversesCookies) {
        try {
          await this.context.addCookies([cookie]);
          successCount++;
          weverseLogger.debug('쿠키 복사 성공', { cookieName: cookie.name, domain: cookie.domain });
        } catch (cookieError) {
          const errorMessage = cookieError instanceof Error ? cookieError.message : String(cookieError);
          failedCookies.push(cookie.name);
          weverseLogger.warn('쿠키 복사 실패', { 
            cookieName: cookie.name, 
            domain: cookie.domain, 
            error: errorMessage 
          });
          console.warn(`쿠키 ${cookie.name} 복사 실패:`, cookieError);
        }
      }
    } else {
      weverseLogger.error('쿠키 복사 실패 - 브라우저 컨텍스트 없음');
    }
    
    const result = `${successCount}/${weversesCookies.length}개 성공`;
    weverseLogger.info('개별 쿠키 복사 완료', { 
      successCount, 
      totalCount: weversesCookies.length, 
      failedCookies: failedCookies.length > 0 ? failedCookies : undefined 
    });
    console.log(`개별 쿠키 복사 결과: ${result}`);
  }

  async initiateLogout(): Promise<boolean> {
    try {
      weverseLogger.info('로그아웃 시도 시작');
      const currentLoginStatus = await this.checkLoginStatus();
      if (!currentLoginStatus) {
        weverseLogger.info('이미 로그아웃 상태');
        console.log('💡 Already logged out from Weverse, no action needed');
        this.isLoggedIn = false;
        await this.settingsService.updateSetting('needWeverseLogin', true);
        this.notifyWeverseLoginStatusChange(true);
        return true;
      }

      if (!this.page) {
        await this.setupBrowser();
      }

      console.log('🚪 Starting Weverse logout process...');
      
      await this.page!.goto('https://weverse.io/', { 
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      await this.page!.waitForTimeout(3000);
      
      if (this.context) {
        await this.context.clearCookies();
        weverseLogger.info('브라우저 쿠키 정리 완료');
        console.log('Weverse 브라우저 쿠키 정리 완료');
      }
      
      const loginStatus = await this.checkLoginStatus();
      
      if (!loginStatus) {
        weverseLogger.info('로그아웃 성공');
        console.log('Weverse 로그아웃 완료');
        await this.settingsService.updateSetting('needWeverseLogin', true);
        this.notifyWeverseLoginStatusChange(true);
        return true;
      } else {
        weverseLogger.warn('로그아웃 실패 - 여전히 로그인 상태');
        console.log('Weverse 로그아웃 실패 - 여전히 로그인 상태');
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      weverseLogger.error('로그아웃 중 오류 발생', { error: errorMessage });
      console.error('Weverse 로그아웃 중 오류 발생:', error);
      
      try {
        if (this.context) {
          await this.context.clearCookies();
        }
        this.isLoggedIn = false;
        await this.settingsService.updateSetting('needWeverseLogin', true);
        this.notifyWeverseLoginStatusChange(true);
      } catch (cleanupError) {
        console.error('Weverse 정리 작업 중 오류:', cleanupError);
      }
      
      return false;
    }
  }

  async extractArtistList(): Promise<string[]> {
    if (!await this.ensureLoggedIn()) {
      console.log('Weverse not logged in, skipping artist extraction');
      return [];
    }

    if (!this.page) {
      await this.setupBrowser();
    }

    try {
      console.log('🎨 위버스 아티스트 목록 추출 시작...');
      
      await this.page!.goto('https://weverse.io/', { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });

      // 페이지 로드 후 충분한 대기 시간
      await this.page!.waitForTimeout(5000);
      console.log('📄 위버스 홈 페이지 로드 완료');

      // 알림 버튼 찾기 및 클릭
      const notificationButton = await this.page!.$('.HeaderNotificationWrapperView_notification__hCLgg button');
      if (!notificationButton) {
        console.warn('❌ 알림 버튼을 찾을 수 없습니다');
        return [];
      }

      console.log('🔔 알림 버튼 클릭...');
      await notificationButton.click();
      
      // 알림 탭이 완전히 열릴 때까지 대기
      console.log('⏳ 알림 탭 열림 대기 중...');
      let notificationTabOpened = false;
      let tabRetryCount = 0;
      const maxTabRetries = 10;

      while (!notificationTabOpened && tabRetryCount < maxTabRetries) {
        try {
          // 알림 탭 컨테이너가 열린 상태인지 확인
          const notificationWrapper = await this.page!.$('.HeaderNotificationWrapperView_notification__hCLgg[aria-expanded="true"]');
          const notificationLayer = await this.page!.$('.HeaderNotificationWrapperView_header_layer__UE6Do');
          
          if (notificationWrapper && notificationLayer) {
            const isLayerVisible = await notificationLayer.isVisible();
            if (isLayerVisible) {
              notificationTabOpened = true;
              console.log('✅ 알림 탭 열림 완료');
            }
          }
          
          if (!notificationTabOpened) {
            tabRetryCount++;
            console.log(`⏳ 알림 탭 열림 대기 ${tabRetryCount}/${maxTabRetries}`);
            await this.page!.waitForTimeout(1000);
          }
        } catch (error) {
          tabRetryCount++;
          console.log(`⏳ 알림 탭 열림 확인 재시도 ${tabRetryCount}/${maxTabRetries}`);
          await this.page!.waitForTimeout(1000);
        }
      }

      if (!notificationTabOpened) {
        console.warn('❌ 알림 탭 열림 실패 - 타임아웃');
        return [];
      }

      // 필터 리스트가 로드될 때까지 대기 (강화된 재시도 로직)
      console.log('🔍 필터 리스트 로드 대기 중...');
      let filterListLoaded = false;
      let retryCount = 0;
      const maxRetries = 10;

      while (!filterListLoaded && retryCount < maxRetries) {
        try {
          // 필터 리스트 존재 및 가시성 확인
          await this.page!.waitForSelector('.HeaderNotificationFilterView_filter_list__SJf-t', { 
            timeout: 2000,
            state: 'visible'
          });
          
          // 필터 아이템들이 실제로 렌더링되었는지 확인
          const filterItems = await this.page!.$$('.HeaderNotificationFilterView_filter_item__qssjd');
          if (filterItems.length > 0) {
            filterListLoaded = true;
            console.log(`✅ 필터 리스트 로드 완료 (${filterItems.length}개 항목)`);
          } else {
            throw new Error('필터 아이템이 없습니다');
          }
        } catch (error) {
          retryCount++;
          console.log(`⏳ 필터 리스트 로드 재시도 ${retryCount}/${maxRetries}`);
          await this.page!.waitForTimeout(1000);
        }
      }

      if (!filterListLoaded) {
        console.warn('❌ 필터 리스트 로드 실패 - 아티스트 목록을 찾을 수 없습니다');
        return [];
      }

      // 아티스트 목록과 프로필 이미지 추출 (디버깅 로그 포함)
      const extractResult = await this.page!.evaluate(() => {
        const filterList = document.querySelector('.HeaderNotificationFilterView_filter_list__SJf-t');
        if (!filterList) {
          console.warn('필터 리스트 요소를 찾을 수 없습니다');
          return { names: [], profileImages: {} };
        }

        const filterItems = filterList.querySelectorAll('.HeaderNotificationFilterView_filter_item__qssjd');
        const names: string[] = [];
        const profileImages: Record<string, string> = {};
        const excludedNames = ['전체', 'All', 'Shop'];
        
        console.log(`발견된 필터 아이템 개수: ${filterItems.length}`);
        console.log('HTML 구조 확인을 위한 첫 번째 아이템:', filterItems[0]?.innerHTML);
        
        filterItems.forEach((item, index) => {
          const nameElement = item.querySelector('.HeaderNotificationFilterView_name__wE6JP');
          const imageElement = item.querySelector('.ProfileThumbnailView_thumbnail__8W3E7') as HTMLImageElement;
          
          if (nameElement) {
            const name = nameElement.textContent?.trim();
            console.log(`아이템 ${index + 1}: "${name}"`);
            
            if (name && !excludedNames.includes(name)) {
              if (!names.includes(name)) {
                names.push(name);
                console.log(`✅ 추가된 아티스트: "${name}"`);
                
                // 프로필 이미지 추출 - 더 구체적인 디버깅
                if (imageElement) {
                  if (imageElement.src && imageElement.src.trim() !== '') {
                    profileImages[name] = imageElement.src;
                    console.log(`📸 프로필 이미지 추출 성공: "${name}" -> ${imageElement.src}`);
                  } else {
                    console.log(`⚠️ 프로필 이미지 URL이 비어있음: "${name}"`);
                    console.log(`  - imageElement.src: "${imageElement.src}"`);
                    console.log(`  - imageElement.alt: "${imageElement.alt}"`);
                    console.log(`  - imageElement.width: ${imageElement.width}`);
                    console.log(`  - imageElement.height: ${imageElement.height}`);
                  }
                } else {
                  console.log(`⚠️ 프로필 이미지 요소를 찾을 수 없음: "${name}"`);
                  // 대체 선택자로 다시 시도
                  const altImageElement = item.querySelector('img') as HTMLImageElement;
                  if (altImageElement && altImageElement.src && altImageElement.src.trim() !== '') {
                    profileImages[name] = altImageElement.src;
                    console.log(`📸 대체 선택자로 프로필 이미지 추출 성공: "${name}" -> ${altImageElement.src}`);
                  } else {
                    console.log(`❌ 대체 선택자로도 프로필 이미지를 찾을 수 없음: "${name}"`);
                  }
                }
              } else {
                console.log(`⚠️ 중복 아티스트 제외: "${name}"`);
              }
            } else {
              console.log(`❌ 제외된 아이템: "${name}"`);
            }
          } else {
            console.log(`❌ 아이템 ${index + 1}: 이름 요소를 찾을 수 없음`);
          }
        });
        
        return { names, profileImages };
      });

      console.log(`✅ 추출된 아티스트 목록 (${extractResult.names.length}개):`, extractResult.names);
      console.log('📸 추출된 프로필 이미지:', extractResult.profileImages);

      // 데이터베이스에 아티스트 새로고침 (프로필 이미지 포함, 기존 설정 유지하면서 목록 업데이트)
      await this.databaseManager.refreshWeverseArtists(extractResult.names, extractResult.profileImages);

      return extractResult.names;
    } catch (error) {
      console.error('❌ 아티스트 목록 추출 실패:', error);
      return [];
    }
  }

  // 기존 시스템 패턴에 맞춘 메서드 (MonitoringService와 호환)
  async checkAllStreamers(): Promise<WeiverseNotification[]> {
    return await this.checkNotifications(true);
  }

  async checkNotifications(silentMode: boolean = false): Promise<WeiverseNotification[]> {
    const startTime = Date.now();
    
    weverseLogger.info('알림 확인 시작', {
      silentMode,
      isLoggedIn: this.isLoggedIn,
      lastKnownLoginStatus: this.lastKnownLoginStatus,
      browserSetup: !!this.browser && !!this.page
    });
    
    // 로그인 상태 확인 및 복구 시도
    if (!await this.ensureLoggedIn()) {
      weverseLogger.warn('로그인 상태 확인 실패, 복구 시도 중');
      if (!silentMode) {
        console.log('Weverse not logged in, attempting recovery...');
      }
      
      // 로그인 실패 복구 시도
      const recoveryResult = await this.recoverFromLoginFailure();
      if (!recoveryResult) {
        weverseLogger.error('로그인 복구 실패', {
          duration: `${Date.now() - startTime}ms`
        });
        if (!silentMode) {
          console.log('❌ 위버스 로그인 복구 실패 - 수동 로그인 필요');
        }
        return [];
      }
    }

    try {
      // 먼저 baseline 설정이 필요한 아티스트들을 확인하고 처리
      const artistsNeedingBaseline = await this.databaseManager.getWeverseArtistsNeedingBaseline();
      
      if (artistsNeedingBaseline.length > 0) {
        weverseLogger.info('기준선 설정 필요한 아티스트 발견', {
          count: artistsNeedingBaseline.length,
          artists: artistsNeedingBaseline.map(a => ({ id: a.id, name: a.artistName }))
        });
        console.log(`🎯 [위버스 기준선] ${artistsNeedingBaseline.length}명의 아티스트에 대해 기준선 설정이 필요합니다`);
        
        // Silent mode로 baseline 설정 (알림 발송 안함)
        await this.establishBaselinesForNewArtists(artistsNeedingBaseline);
      }
      
      const activeArtists = await this.databaseManager.getActiveWeverseArtists();
      
      weverseLogger.debug('활성화된 아티스트 조회 완료', {
        activeArtistsCount: activeArtists.length,
        artistNames: activeArtists.map(a => a.artistName)
      });
      
      if (activeArtists.length === 0) {
        weverseLogger.warn('활성화된 위버스 아티스트 없음');
        if (!silentMode) {
          console.log('활성화된 위버스 아티스트가 없습니다');
        }
        return [];
      }

      weverseLogger.info('아티스트 알림 확인 시작', {
        activeArtistsCount: activeArtists.length,
        silentMode
      });
      if (!silentMode) {
        console.log(`🔍 ${activeArtists.length}개 위버스 아티스트 알림 확인 중...`);
      }

      if (!this.page) {
        await this.setupBrowser();
      }

      // 1단계: 위버스 홈페이지 접근
      console.log('🌐 위버스 홈페이지 접근 중...');
      try {
        await this.page!.goto('https://weverse.io/', { 
          waitUntil: 'domcontentloaded',
          timeout: 20000 
        });
      } catch (error) {
        console.error('❌ 위버스 페이지 접근 실패:', error);
        // 브라우저 재설정 후 재시도
        await this.setupBrowser();
        await this.page!.goto('https://weverse.io/', { 
          waitUntil: 'domcontentloaded',
          timeout: 20000 
        });
      }

      // 2단계: 페이지 로딩 완료 대기
      console.log('⏳ 페이지 로딩 완료 대기 중...');
      await this.page!.waitForTimeout(3000);

      // 3단계: 알림 버튼 찾기 및 클릭 (모달 오버레이 처리 포함)
      console.log('🔍 알림 버튼 찾는 중...');
      const notificationButton = await this.page!.$('.HeaderNotificationWrapperView_notification__hCLgg button');
      if (!notificationButton) {
        weverseLogger.warn('알림 버튼을 찾을 수 없음');
        console.warn('❌ 알림 버튼을 찾을 수 없습니다');
        return [];
      }

      // ReactModal 오버레이 감지 및 처리
      console.log('🔍 ReactModal 오버레이 확인 중...');
      const modalOverlay = await this.page!.$('.ReactModal__Overlay');
      if (modalOverlay) {
        weverseLogger.info('ReactModal 오버레이 감지됨, 닫기 시도');
        console.log('⚠️ ReactModal 오버레이 감지됨, 닫기 시도 중...');
        
        try {
          // 오버레이 클릭으로 모달 닫기 시도
          await modalOverlay.click();
          await this.page!.waitForTimeout(1000);
          
          // ESC 키로 모달 닫기 시도 (백업 방법)
          await this.page!.keyboard.press('Escape');
          await this.page!.waitForTimeout(1000);
          
          // 모달이 완전히 사라질 때까지 대기
          try {
            await this.page!.waitForSelector('.ReactModal__Overlay', { 
              state: 'hidden', 
              timeout: 3000 
            });
            weverseLogger.info('ReactModal 오버레이 성공적으로 닫힘');
            console.log('✅ ReactModal 오버레이 성공적으로 닫힘');
          } catch (modalError) {
            weverseLogger.warn('ReactModal 오버레이 닫기 실패, 계속 진행');
            console.warn('⚠️ ReactModal 오버레이 닫기 실패, 계속 진행...');
          }
        } catch (closeError) {
          const errorMsg = closeError instanceof Error ? closeError.message : String(closeError);
          weverseLogger.error('ReactModal 오버레이 처리 중 오류', { error: errorMsg });
          console.error('❌ ReactModal 오버레이 처리 중 오류:', closeError);
        }
      }

      console.log('🔔 알림 버튼 클릭 중...');
      try {
        // 안전한 클릭을 위해 force 옵션 사용
        await notificationButton.click({ force: true });
        weverseLogger.info('알림 버튼 클릭 성공');
      } catch (clickError) {
        const errorMsg = clickError instanceof Error ? clickError.message : String(clickError);
        weverseLogger.error('알림 버튼 클릭 실패', { error: errorMsg });
        
        // 대안적인 클릭 방법 시도
        console.log('🔄 대안적인 클릭 방법 시도 중...');
        try {
          await this.page!.evaluate(() => {
            const btn = document.querySelector('.HeaderNotificationWrapperView_notification__hCLgg button') as HTMLElement;
            if (btn) btn.click();
          });
          weverseLogger.info('JavaScript 클릭으로 알림 버튼 클릭 성공');
          console.log('✅ JavaScript 클릭으로 성공');
        } catch (jsClickError) {
          const jsErrorMsg = jsClickError instanceof Error ? jsClickError.message : String(jsClickError);
          weverseLogger.error('모든 클릭 방법 실패', { 
            originalError: errorMsg,
            jsClickError: jsErrorMsg
          });
          throw new Error(`알림 버튼 클릭 실패: ${errorMsg}`);
        }
      }
      
      // 4단계: 알림 탭 열림 확인
      console.log('⏳ 알림 탭 열림 확인 중...');
      let notificationTabOpened = false;
      let tabRetryCount = 0;
      const maxTabRetries = 10;

      while (!notificationTabOpened && tabRetryCount < maxTabRetries) {
        try {
          const notificationWrapper = await this.page!.$('.HeaderNotificationWrapperView_notification__hCLgg[aria-expanded="true"]');
          const notificationLayer = await this.page!.$('.HeaderNotificationWrapperView_header_layer__UE6Do');
          
          if (notificationWrapper && notificationLayer) {
            const isLayerVisible = await notificationLayer.isVisible();
            if (isLayerVisible) {
              notificationTabOpened = true;
              console.log('✅ 알림 탭 열림 확인 완료');
            }
          }
          
          if (!notificationTabOpened) {
            tabRetryCount++;
            console.log(`⏳ 알림 탭 열림 대기 ${tabRetryCount}/${maxTabRetries}`);
            await this.page!.waitForTimeout(1000);
          }
        } catch (error) {
          tabRetryCount++;
          console.log(`⏳ 알림 탭 열림 확인 재시도 ${tabRetryCount}/${maxTabRetries}`);
          await this.page!.waitForTimeout(1000);
        }
      }

      if (!notificationTabOpened) {
        console.warn('❌ 알림 탭 열림 실패 - 타임아웃');
        return [];
      }

      // 5단계: 알림 컨테이너 로딩 대기
      const notificationAreaLoaded = await this.waitForNotificationArea();
      if (!notificationAreaLoaded) {
        console.warn('❌ 알림 컨테이너 로딩 실패 - 구조 진단 실행');
        await this.diagnoseNotificationStructure();
        return [];
      }

      // 6단계: 아티스트 프로필 이미지 추출
      console.log('📸 아티스트 프로필 이미지 추출 중...');
      const artistProfileImages = await this.page!.evaluate(() => {
        const profileImages: Record<string, string> = {};
        
        // 필터 목록에서 아티스트 프로필 이미지 추출
        const filterItems = document.querySelectorAll('.HeaderNotificationFilterView_filter_item__qssjd');
        
        filterItems.forEach(item => {
          const nameElement = item.querySelector('.HeaderNotificationFilterView_name__wE6JP');
          const imageElement = item.querySelector('.ProfileThumbnailView_thumbnail__8W3E7') as HTMLImageElement;
          
          if (nameElement && imageElement) {
            const artistName = nameElement.textContent?.trim();
            const imageUrl = imageElement.src;
            
            if (artistName && imageUrl && artistName !== '전체' && artistName !== 'Shop') {
              profileImages[artistName] = imageUrl;
              console.log(`📸 프로필 이미지 추출: ${artistName} -> ${imageUrl}`);
            }
          }
        });
        
        return profileImages;
      });
      
      console.log('📸 추출된 프로필 이미지:', artistProfileImages);

      // 7단계: 알림 파싱 시작
      console.log('🔍 알림 파싱 시작...');
      console.log('📋 활성 아티스트 목록:', activeArtists.map(a => a.artistName));
      const notificationData = await this.page!.evaluate((activeArtistNames: string[]) => {
        const debug = {
          notificationAreaFound: false,
          notificationLists: 0,
          totalNotifications: 0,
          activeArtistNotifications: 0,
          parsedNotifications: [] as string[]
        };

        // 위버스 시간 파싱 함수를 page.evaluate 컨텍스트 내부에 정의
        const parseWeverseTime = (timeText: string): Date => {
          try {
            // 빈 문자열이나 null/undefined 처리
            if (!timeText || timeText.trim() === '') {
              console.warn(`⚠️ 위버스 시간 정보가 비어있음 - 현재 시간 사용`);
              return new Date();
            }
            
            // 새로운 위버스 시간 형식 파싱: "Jul 20, 2025, 20:25"
            const englishTimeMatch = timeText.match(/(\w{3})\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{1,2})/);
            
            if (englishTimeMatch) {
              const [, monthStr, day, year, hour, minute] = englishTimeMatch;
              
              // 월 이름을 숫자로 변환
              const monthMap: { [key: string]: number } = {
                'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
              };
              
              const monthNum = monthMap[monthStr];
              if (monthNum === undefined) {
                console.warn(`⚠️ 위버스 월 이름 인식 실패: "${monthStr}" - 현재 시간 사용`);
                return new Date();
              }
              
              // 입력값 검증
              const yearNum = parseInt(year, 10);
              const dayNum = parseInt(day, 10);
              const hourNum = parseInt(hour, 10);
              const minuteNum = parseInt(minute, 10);
              
              // 유효성 검사
              if (yearNum < 2020 || yearNum > 2030 || 
                  dayNum < 1 || dayNum > 31 ||
                  hourNum < 0 || hourNum > 23 ||
                  minuteNum < 0 || minuteNum > 59) {
                console.warn(`⚠️ 위버스 시간 범위 오류: "${timeText}" - 현재 시간 사용`);
                return new Date();
              }
              
              // UTC 시간으로 직접 Date 객체 생성 (위버스 시간이 KST라고 가정)
              const utcDate = new Date(Date.UTC(
                yearNum,
                monthNum, // monthMap에서 이미 0부터 시작하는 인덱스 사용
                dayNum,
                hourNum - 9, // KST에서 UTC로 변환 (-9시간)
                minuteNum,
                0 // 초
              ));
              
              console.log(`⏰ 위버스 시간 파싱 성공 (영어 형식): "${timeText}" -> ${utcDate.toISOString()}`);
              return utcDate;
            }
            
            // 기존 한국식 시간 형식도 지원: "2025. 07. 01 21:19"
            const koreanTimeMatch = timeText.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
            
            if (koreanTimeMatch) {
              const [, year, month, day, hour, minute] = koreanTimeMatch;
              
              // 입력값 검증
              const yearNum = parseInt(year, 10);
              const monthNum = parseInt(month, 10);
              const dayNum = parseInt(day, 10);
              const hourNum = parseInt(hour, 10);
              const minuteNum = parseInt(minute, 10);
              
              // 유효성 검사
              if (yearNum < 2020 || yearNum > 2030 || 
                  monthNum < 1 || monthNum > 12 ||
                  dayNum < 1 || dayNum > 31 ||
                  hourNum < 0 || hourNum > 23 ||
                  minuteNum < 0 || minuteNum > 59) {
                console.warn(`⚠️ 위버스 시간 범위 오류: "${timeText}" - 현재 시간 사용`);
                return new Date();
              }
              
              // UTC 시간으로 직접 Date 객체 생성 (위버스 시간이 KST라고 가정)
              const utcDate = new Date(Date.UTC(
                yearNum,
                monthNum - 1, // JavaScript에서 월은 0부터 시작
                dayNum,
                hourNum - 9, // KST에서 UTC로 변환 (-9시간)
                minuteNum,
                0 // 초
              ));
              
              console.log(`⏰ 위버스 시간 파싱 성공 (한국 형식): "${timeText}" -> ${utcDate.toISOString()}`);
              return utcDate;
            }
            
            console.warn(`⚠️ 위버스 시간 파싱 실패: "${timeText}" - 현재 시간 사용`);
            return new Date();
            
          } catch (error) {
            console.error(`❌ 위버스 시간 파싱 오류: "${timeText}"`, error);
            return new Date();
          }
        };

        // 알림 컨테이너 확인
        const notificationArea = document.querySelector('.HeaderNotificationView_notification_area__oJsnB');
        if (!notificationArea) {
          console.warn('⚠️ 알림 컨테이너(.HeaderNotificationView_notification_area__oJsnB)를 찾을 수 없습니다');
          return { debug, notifications: [] };
        }

        debug.notificationAreaFound = true;
        console.log('✅ 알림 컨테이너 확인됨');

        // 날짜별 알림 목록 찾기 (실제 구조)
        const notificationLists = notificationArea.querySelectorAll('.HeaderNotificationListView_notification_list__1naSI');
        debug.notificationLists = notificationLists.length;
        console.log(`📋 알림 목록 개수: ${notificationLists.length}`);

        if (notificationLists.length === 0) {
          console.log('ℹ️ 알림 목록이 없습니다 - 실제로 알림이 0개이거나 구조가 변경됨');
          return { debug, notifications: [] };
        }

        const foundNotifications: any[] = [];
        
        // 각 날짜별 알림 목록 처리
        notificationLists.forEach((notificationList, listIndex) => {
          console.log(`🔍 알림 목록 ${listIndex + 1} 분석 중...`);
          
          // 개별 알림 요소들 (<li>) 찾기
          const notificationItems = notificationList.querySelectorAll('li');
          console.log(`  - 개별 알림 개수: ${notificationItems.length}`);
          debug.totalNotifications += notificationItems.length;
          
          notificationItems.forEach((item, itemIndex) => {
            console.log(`    🔍 알림 ${itemIndex + 1} 분석 중...`);
            
            // 아티스트명 찾기 (정확한 선택자 사용)
            const artistElement = item.querySelector('.HeaderNotificationListView_notification_group__LjdF1');
            if (!artistElement) {
              console.log(`      ⚠️ 아티스트명 요소를 찾을 수 없음`);
              return;
            }
            
            const artistName = artistElement.textContent?.trim() || '';
            console.log(`      📋 아티스트명: "${artistName}"`);
            
            if (!artistName) {
              console.log(`      ⚠️ 아티스트명이 비어있음`);
              return;
            }
            
            // 활성 아티스트 확인
            if (!activeArtistNames.includes(artistName)) {
              console.log(`      ⚠️ "${artistName}"는 활성화되지 않은 아티스트입니다`);
              return;
            }
            
            console.log(`      ✅ 활성 아티스트 "${artistName}" 알림 발견!`);
            debug.activeArtistNotifications++;
            
            // 알림 제목 및 내용 추출
            const titleElement = item.querySelector('.HeaderNotificationListView_notification_text__MBYUS');
            const title = titleElement?.textContent?.trim() || '';
            console.log(`      📝 알림 제목: "${title.substring(0, 50)}..."`);
            
            if (!title) {
              console.log(`      ⚠️ 알림 제목을 찾을 수 없음`);
              return;
            }
            
            // 시간 정보 추출
            const timeElement = item.querySelector('.HeaderNotificationListView_notification_time__6oAL6');
            const timeText = timeElement?.textContent?.trim() || '';
            console.log(`      ⏰ 알림 시간: "${timeText}"`);
            
            // URL 추출
            const linkElement = item.querySelector('.HeaderNotificationListView_notification_link__OpT6v');
            const url = linkElement?.getAttribute('href') || '';
            console.log(`      🔗 알림 URL: "${url}"`);
            
            // 광고 알림 필터링
            if (title.includes('(광고)')) {
              console.log(`      🚫 광고 알림 제외: "${title.substring(0, 30)}..."`);
              return;
            }

            // 고유 ID 생성 (URL 기반, 더 안정적으로)
            let notificationId: string;
            if (url && url.length > 0) {
              // URL에서 숫자 추출하여 사용
              const urlMatch = url.match(/\/(\d+)(?:\?|$)/);
              notificationId = urlMatch ? urlMatch[1] : `${artistName}-${Date.now()}-${Math.random()}`;
            } else {
              // URL이 없는 경우 제목과 시간 기반으로 생성
              const titleHash = title.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '');
              notificationId = `${artistName}-${titleHash}-${Date.now()}`;
            }
            
            // 위버스 시간 파싱
            const parsedTimestamp = parseWeverseTime(timeText);
            
            // 알림 객체 생성 (프로필 이미지 포함)
            const notification = {
              id: notificationId,
              artistName: artistName,
              title: title,
              content: title, // 위버스는 제목이 곧 내용
              url: url.startsWith('http') ? url : `https://weverse.io${url}`,
              timestamp: parsedTimestamp,
              type: 'artist' as const,
              timeText: timeText,
              profileImageUrl: '' // 나중에 추가됨
            };
            
            foundNotifications.push(notification);
            debug.parsedNotifications.push(`${artistName}: ${title.substring(0, 30)}...`);
            console.log(`      ✅ 알림 파싱 완료: ${artistName} - ${title.substring(0, 30)}...`);
          });
        });
        
        console.log('📊 알림 파싱 디버깅 정보:');
        console.log(`  - 알림 컨테이너 발견: ${debug.notificationAreaFound}`);
        console.log(`  - 알림 목록 개수: ${debug.notificationLists}`);
        console.log(`  - 활성 아티스트 알림 그룹: ${debug.activeArtistNotifications}`);
        console.log(`  - 총 알림 개수: ${debug.totalNotifications}`);
        console.log(`  - 파싱된 알림: ${foundNotifications.length}개`);
        
        if (foundNotifications.length > 0) {
          console.log(`✅ 위버스 알림 파싱 성공: 총 ${foundNotifications.length}개 알림 발견`);
          // 개별 알림 상세 내용은 로그에서 제외 - 가독성 향상
        } else if (debug.totalNotifications > 0) {
          console.log(`ℹ️ 분석 결과: 총 ${debug.totalNotifications}개 알림이 있지만 활성 아티스트 알림은 ${debug.activeArtistNotifications}개입니다`);
        } else {
          console.log(`ℹ️ 분석 결과: 실제로 알림이 0개입니다 (파싱 성공, 알림 없음)`);
        }

        return { debug, notifications: foundNotifications };
      }, activeArtists.map(a => a.artistName));

      console.log('📊 알림 파싱 디버깅 정보:');
      console.log(`  - 알림 컨테이너 발견: ${notificationData.debug.notificationAreaFound}`);
      console.log(`  - 알림 목록 개수: ${notificationData.debug.notificationLists}`);
      console.log(`  - 활성 아티스트 알림 그룹: ${notificationData.debug.activeArtistNotifications}`);
      console.log(`  - 총 알림 개수: ${notificationData.debug.totalNotifications}`);
      console.log(`  - 파싱된 알림: ${notificationData.notifications.length}개`);

      if (notificationData.notifications.length > 0) {
        console.log(`✅ 위버스 알림 파싱 성공: 총 ${notificationData.notifications.length}개 알림 발견`);
        notificationData.notifications.forEach((notification, index) => {
          console.log(`  ${index + 1}. ${notification.artistName}: ${notification.title.substring(0, 50)}...`);
        });
      } else if (notificationData.debug.totalNotifications > 0) {
        console.log(`ℹ️ 분석 결과: 총 ${notificationData.debug.totalNotifications}개 알림이 있지만 활성 아티스트 알림은 ${notificationData.debug.activeArtistNotifications}개입니다`);
      } else {
        console.log(`ℹ️ 분석 결과: 실제로 알림이 0개입니다 (파싱 성공, 알림 없음)`);
      }

      // 8단계: 프로필 이미지 추가 및 아티스트 테이블 동기화
      console.log('📸 알림에 프로필 이미지 추가 및 아티스트 테이블 동기화 중...');
      
      // 아티스트 프로필 이미지 동기화
      for (const [artistName, profileImageUrl] of Object.entries(artistProfileImages)) {
        try {
          await this.databaseManager.updateWeverseArtistProfileImage(artistName, profileImageUrl);
          console.log(`📸 ${artistName} 프로필 이미지 동기화 완료: ${profileImageUrl}`);
        } catch (error) {
          console.error(`❌ ${artistName} 프로필 이미지 동기화 실패:`, error);
        }
      }
      
      // 알림에 프로필 이미지 추가
      notificationData.notifications.forEach(notification => {
        const profileImageUrl = artistProfileImages[notification.artistName];
        if (profileImageUrl) {
          notification.profileImageUrl = profileImageUrl;
          console.log(`📸 ${notification.artistName} 알림에 프로필 이미지 추가: ${profileImageUrl}`);
        } else {
          console.log(`⚠️ ${notification.artistName} 프로필 이미지를 찾을 수 없음`);
        }
      });

      // 9단계: 새 알림 필터링 (개선된 로직)
      const newNotifications: WeiverseNotification[] = [];

      // 데이터베이스에서 이미 처리된 uniqueKey 목록 조회
      const existingUniqueKeys = await this.databaseManager.getExistingUniqueKeys(30); // 최근 30일
      const existingUniqueKeySet = new Set(existingUniqueKeys);

      for (const notification of notificationData.notifications) {
        const lastNotificationId = activeArtists.find(a => a.artistName === notification.artistName)?.lastNotificationId;
        
        // 위버스 알림의 uniqueKey 생성 (NotificationService와 동일한 로직)
        const urlId = this.extractWeverseId(notification.url);
        const contentHash = this.createContentHash(notification.title, notification.url);
        const uniqueKey = `weverse_${notification.artistName}_${urlId}_${contentHash}`;
        
        // 이중 필터링: lastNotificationId와 uniqueKey 모두 확인
        const isNewByLastId = !lastNotificationId || notification.id !== lastNotificationId;
        const isNewByUniqueKey = !existingUniqueKeySet.has(uniqueKey);
        
        if (isNewByLastId && isNewByUniqueKey) {
          newNotifications.push(notification);
          
          if (!silentMode) {
            console.log(`🎵 ${notification.artistName}: 새 알림 - ${notification.title}`);
          }
        } else {
          if (!silentMode) {
            console.log(`🔄 ${notification.artistName}: 이미 처리된 알림 스킵 - ${notification.title} (lastId: ${!isNewByLastId}, uniqueKey: ${!isNewByUniqueKey})`);
          }
        }
      }

      // 9단계: 최종 결과 출력
      if (notificationData.debug.parsedNotifications.length === 0) {
        console.log('ℹ️ 분석 결과: 실제로 알림이 0개입니다 (파싱 성공, 알림 없음)');
      } else {
        console.log(`✅ 위버스 알림 파싱 성공: 총 ${notificationData.debug.parsedNotifications.length}개 알림 발견`);
      }

      if (!silentMode) {
        console.log(`🔍 [위버스] 스크래핑 결과: ${notificationData.notifications.length}개 알림 감지, 필터링 후 ${newNotifications.length}개 새 알림`);
      }

      return newNotifications;
    } catch (error) {
      console.error('❌ 위버스 알림 확인 실패:', error);
      console.error('스택 트레이스:', (error as Error).stack);
      return [];
    }
  }

  async sendWeverseNotifications(notifications: WeiverseNotification[]): Promise<void> {
    // 배치 처리를 위해 최대 5개씩 나누어 처리
    const BATCH_SIZE = 5;
    const BATCH_DELAY = 2000; // 2초 간격
    
    console.log(`🔔 [위버스] 총 ${notifications.length}개 알림을 ${Math.ceil(notifications.length / BATCH_SIZE)}개 배치로 처리합니다`);
    
    for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
      const batch = notifications.slice(i, i + BATCH_SIZE);
      console.log(`🔄 [위버스] 배치 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(notifications.length / BATCH_SIZE)} 처리 중 (${batch.length}개 알림)`);
      
      // 배치 내 알림들을 순차적으로 처리
      for (const notification of batch) {
        try {
          const notificationData = this.notificationService.createWeverseNotification(
            notification.artistName,
            notification.title,
            notification.url,
            notification.profileImageUrl || undefined, // 추출된 프로필 이미지 사용
            new Date(notification.timestamp),
            notification.content
          );
          
          console.log(`🔔 [위버스] 알림 발송 시작:`, {
            artistName: notification.artistName,
            title: notification.title,
            url: notification.url,
            hasProfileImage: !!notification.profileImageUrl,
            uniqueKey: notificationData.uniqueKey
          });
          
          const sendResult = await this.notificationService.sendNotification(notificationData);
          
          if (sendResult) {
            console.log(`📱 [위버스] ${notification.artistName} 알림 전송 완료`);
            
            // 알림 전송 성공 시에만 lastNotificationId 업데이트
            await this.databaseManager.updateWeverseArtistLastNotification(notification.artistName, notification.id);
            // console.log(`🔄 [위버스] ${notification.artistName}의 lastNotificationId 업데이트: ${notification.id}`); // ID 업데이트 로그 간소화
          } else {
            console.error(`❌ [위버스] ${notification.artistName} 알림 전송 실패`);
            
            // 중복 체크로 인한 전송 실패의 경우, lastNotificationId 업데이트
            // 이렇게 하면 같은 알림이 계속 감지되는 순환 참조 문제 해결
            await this.databaseManager.updateWeverseArtistLastNotification(notification.artistName, notification.id);
            console.log(`🔄 [위버스] ${notification.artistName}의 lastNotificationId 업데이트 (중복 체크): ${notification.id}`);
          }
          
          // 개별 알림 간 짧은 지연 (500ms)
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`${notification.artistName} 알림 전송 실패:`, error);
        }
      }
      
      // 배치 간 지연 (다음 배치가 있는 경우만)
      if (i + BATCH_SIZE < notifications.length) {
        console.log(`⏳ [위버스] 다음 배치 처리까지 ${BATCH_DELAY}ms 대기 중...`);
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }
    
    console.log(`✅ [위버스] 모든 알림 배치 처리 완료`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async waitForNotificationArea(maxRetries: number = 15): Promise<boolean> {
    console.log('🔍 알림 영역 로딩 대기 중...');
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const notificationArea = await this.page!.$('.HeaderNotificationView_notification_area__oJsnB');
        if (notificationArea) {
          const isVisible = await notificationArea.isVisible();
          if (isVisible) {
            console.log(`✅ 알림 영역 로딩 완료 (${i + 1}/${maxRetries})`);
            return true;
          }
        }
        
        console.log(`⏳ 알림 영역 대기 중... (${i + 1}/${maxRetries})`);
        await this.delay(1000);
      } catch (error) {
        console.log(`⚠️ 알림 영역 확인 중 오류 (${i + 1}/${maxRetries}):`, (error as Error).message);
        await this.delay(1000);
      }
    }
    
    console.warn('❌ 알림 영역 로딩 실패 - 타임아웃');
    return false;
  }

  private async attemptSessionRestore(): Promise<void> {
    sessionLogger.info('세션 복원 시도 시작');
    
    try {
      // 1. 파일에서 저장된 세션 로드
      const savedCookies = await this.sessionManager.loadCookiesFromFile('weverse');
      
      if (savedCookies.length > 0) {
        sessionLogger.info(`파일에서 저장된 쿠키 로드 완료`, { cookieCount: savedCookies.length });
        
        // 브라우저 컨텍스트에 쿠키 복원
        await this.context!.clearCookies();
        await this.context!.addCookies(savedCookies);
        
        sessionLogger.info('파일 기반 세션 복원 성공');
        return;
      }
      
      // 2. 기존 브라우저 컨텍스트에서 쿠키 확인 (폴백)
      const existingCookies = await this.context!.cookies();
      const weverseRelatedDomains = [
        'weverse.io',
        '.weverse.io', 
        'account.weverse.io',
        '.account.weverse.io',
        'api.weverse.io',
        '.api.weverse.io',
        'global.weverse.io',
        '.global.weverse.io',
        'static.weverse.io',
        '.static.weverse.io'
      ];
      
      const existingWeversesCookies = existingCookies.filter(cookie => 
        weverseRelatedDomains.some(domain => 
          cookie.domain === domain || cookie.domain.endsWith(domain)
        )
      );
      
      sessionLogger.info(`기존 브라우저 컨텍스트 쿠키 확인`, { existingCookies: existingWeversesCookies.length });
      
      if (existingWeversesCookies.length > 0) {
        console.log('기존 쿠키 정보:');
        existingWeversesCookies.forEach(cookie => {
          const isExpired = cookie.expires ? new Date(cookie.expires * 1000) < new Date() : false;
          console.log(`  - ${cookie.name} (도메인: ${cookie.domain}, 만료: ${isExpired ? '예' : '아니오'})`);
        });
        
        // 만료된 쿠키 제거
        const validCookies = existingWeversesCookies.filter(cookie => {
          if (!cookie.expires) return true; // 세션 쿠키는 유지
          return new Date(cookie.expires * 1000) > new Date();
        });
        
        if (validCookies.length < existingWeversesCookies.length) {
          console.log(`만료된 쿠키 ${existingWeversesCookies.length - validCookies.length}개 제거`);
          await this.context!.clearCookies();
          if (validCookies.length > 0) {
            await this.context!.addCookies(validCookies);
          }
        }
        
        // 유효한 쿠키가 있으면 파일에 저장
        if (validCookies.length > 0) {
          await this.saveCurrentSession();
        }
        
        console.log(`✅ 세션 복원 완료: 유효한 쿠키 ${validCookies.length}개`);
      } else {
        sessionLogger.warn('복원할 세션 쿠키가 없습니다');
      }
      
    } catch (error: any) {
      sessionLogger.error('세션 복원 실패', { error: error?.message || 'Unknown error' });
    }
  }

  /**
   * 현재 세션을 파일에 저장
   */
  private async saveCurrentSession(): Promise<void> {
    try {
      if (!this.context) {
        console.warn('⚠️ [WeiverseMonitor] No context available for session save');
        return;
      }

      const cookies = await this.context.cookies();
      const weverseRelatedDomains = [
        'weverse.io',
        '.weverse.io', 
        'account.weverse.io',
        '.account.weverse.io',
        'api.weverse.io',
        '.api.weverse.io',
        'global.weverse.io',
        '.global.weverse.io',
        'static.weverse.io',
        '.static.weverse.io'
      ];
      
      const weverseCookies = cookies.filter(cookie => 
        weverseRelatedDomains.some(domain => 
          cookie.domain === domain || cookie.domain.endsWith(domain)
        )
      );

      if (weverseCookies.length > 0) {
        await this.sessionManager.saveCookiesToFile('weverse', weverseCookies);
        sessionLogger.info(`세션 저장 완료`, { cookieCount: weverseCookies.length });
      }

    } catch (error: any) {
      sessionLogger.error('세션 저장 실패', { error: error?.message || 'Unknown error' });
    }
  }

  private async validateSessionIntegrity(): Promise<boolean> {
    console.log('🔍 세션 무결성 검사 중...');
    
    try {
      if (!this.context) {
        console.log('❌ 브라우저 컨텍스트가 없습니다');
        return false;
      }
      
      // 새로운 쿠키 분석 시스템 사용
      const cookies = await this.context.cookies();
      const analysis = this.analyzeCookiesByPriority(cookies);
      
      console.log(`📊 세션 무결성 검사 결과: ${analysis.summary}`);
      
      // 만료된 쿠키 필터링
      const now = new Date();
      const validCookies = [
        ...analysis.highPriority,
        ...analysis.mediumPriority,
        ...analysis.lowPriority
      ].filter(cookie => {
        if (!cookie.expires) return true; // 세션 쿠키는 유효한 것으로 간주
        return new Date(cookie.expires * 1000) > now;
      });
      
      // 개선된 검사 기준: 고우선순위 쿠키 1개 이상 + 총 쿠키 5개 이상
      const hasMinimumHighPriority = analysis.highPriority.length >= 1;
      const hasMinimumTotal = analysis.total >= 5;
      const hasValidCookies = validCookies.length >= Math.min(5, analysis.total);
      
      const isValid = hasMinimumHighPriority && hasMinimumTotal && hasValidCookies;
      
      if (!isValid) {
        console.log('⚠️ 세션 무결성 부족 - 자동 복구 시도');
        
        // 만료된 쿠키 정리 및 유효한 쿠키 복원
        if (validCookies.length < analysis.total) {
          await this.cleanupExpiredCookies();
          await this.restoreCriticalCookies(validCookies);
        }
        
        // 백업 쿠키 복원 시도
        const backupCookies = await this.backupCriticalCookies();
        if (backupCookies.length > 0) {
          const restored = await this.restoreCriticalCookies(backupCookies);
          if (restored) {
            console.log('✅ 백업에서 세션 복구 성공');
            return true;
          }
        }
      }
      
      if (isValid) {
        console.log('✅ 세션 무결성 검사 통과');
      } else {
        console.log('❌ 세션 무결성 검사 실패 - 복구 불가');
      }
      
      return isValid;
      
    } catch (error) {
      console.error('❌ 세션 무결성 검사 오류:', error);
      return false;
    }
  }

  /**
   * 만료된 쿠키 정리
   */
  private async cleanupExpiredCookies(): Promise<void> {
    try {
      if (!this.context) return;

      console.log('🧹 만료된 쿠키 정리 중...');
      
      for (const domain of WeiverseMonitor.WEVERSE_DOMAINS) {
        try {
          await this.context.clearCookies({ domain });
        } catch (domainError) {
          console.warn(`⚠️ 도메인 ${domain} 쿠키 정리 오류:`, domainError);
        }
      }
      
      console.log('✅ 만료된 쿠키 정리 완료');
    } catch (error) {
      console.error('❌ 쿠키 정리 실패:', error);
    }
  }

  private async enhanceCookieLifespan(): Promise<void> {
    const startTime = Date.now();
    this.sessionMetrics.cookieRecoveryAttempts++;
    this.logSessionStateChange('cookie-enhancing', 'enhancement-initiated', 'Cookie enhancement started', false);
    
    try {
      console.log('🔧 쿠키 생명주기 관리 및 토큰 갱신 시작...');
      
      if (!this.context) {
        console.log('❌ 브라우저 컨텍스트가 없습니다');
        
        // 브라우저 컨텍스트 없음 로깅
        const enhancementDuration = Date.now() - startTime;
        this.logSessionStateChange('cookie-enhancing', 'enhancement-failed', `No browser context after ${enhancementDuration}ms`, true);
        console.log(`❌ 쿠키 강화 실패 - 브라우저 컨텍스트 없음 (소요시간: ${enhancementDuration}ms)`);
        
        return;
      }
      
      // 1. 현재 쿠키 상태 분석
      const cookies = await this.context.cookies();
      const weverseRelatedDomains = [
        'weverse.io',
        '.weverse.io', 
        'account.weverse.io',
        '.account.weverse.io',
        'api.weverse.io',
        '.api.weverse.io',
        'global.weverse.io',
        '.global.weverse.io'
      ];
      
      const weversesCookies = cookies.filter(cookie => 
        weverseRelatedDomains.some(domain => 
          cookie.domain === domain || 
          cookie.domain.endsWith(domain) ||
          cookie.domain.includes('weverse')
        )
      );
      
      console.log(`📊 현재 위버스 쿠키: ${weversesCookies.length}개`);
      
      // 2. 토큰 갱신 시도 (더 근본적인 해결책)
      await this.attemptTokenRefresh();
      
      // 3. 세션 쿠키 생명주기 연장 (백업 방법)
      const enhancedCookies = weversesCookies.map(cookie => {
        const enhanced = { ...cookie };
        
        // 세션 쿠키이거나 만료 시간이 짧은 경우 연장
        // 단, 너무 과도한 연장은 피함 (3일로 조정)
        if (!cookie.expires || cookie.expires < Date.now() / 1000 + 86400) {
          enhanced.expires = Math.floor(Date.now() / 1000) + (3 * 24 * 60 * 60); // 3일
          console.log(`🔧 쿠키 생명주기 연장: ${cookie.name} (3일)`);
        }
        
        return enhanced;
      });
      
      // 4. 향상된 쿠키 적용
      if (enhancedCookies.length > 0) {
        // 기존 쿠키 제거
        for (const domain of weverseRelatedDomains) {
          try {
            await this.context.clearCookies({ domain });
          } catch (clearError) {
            console.warn(`⚠️ 쿠키 정리 오류 (${domain}):`, clearError);
          }
        }
        
        // 향상된 쿠키 추가
        let appliedCount = 0;
        for (const cookie of enhancedCookies) {
          try {
            await this.context.addCookies([cookie]);
            appliedCount++;
          } catch (addError) {
            console.warn(`⚠️ 쿠키 추가 오류 (${cookie.name}):`, addError);
          }
        }
        
        console.log(`✅ 쿠키 생명주기 관리 완료: ${appliedCount}/${enhancedCookies.length}개 적용`);
        
        // 쿠키 강화 성공 로깅
        this.sessionMetrics.cookieRecoverySuccesses++;
        const enhancementDuration = Date.now() - startTime;
        this.logSessionStateChange('cookie-enhancing', 'cookies-enhanced', `Cookie enhancement completed in ${enhancementDuration}ms: ${appliedCount}/${enhancedCookies.length} cookies applied`, true);
        console.log(`✅ 쿠키 강화 완료 (소요시간: ${enhancementDuration}ms, 적용: ${appliedCount}/${enhancedCookies.length}개)`);
      } else {
        // 쿠키가 없을 경우 로깅
        const enhancementDuration = Date.now() - startTime;
        this.logSessionStateChange('cookie-enhancing', 'no-cookies', `No cookies to enhance after ${enhancementDuration}ms`, true);
        console.log(`⚠️ 쿠키 강화 불필요 - 강화할 쿠키 없음 (소요시간: ${enhancementDuration}ms)`);
      }
      
    } catch (error) {
      console.error('❌ 쿠키 생명주기 관리 오류:', error);
      
      // 쿠키 강화 예외 로깅
      const enhancementDuration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logSessionStateChange('cookie-enhancing', 'enhancement-error', `Cookie enhancement exception after ${enhancementDuration}ms: ${errorMessage}`, true);
      console.log(`❌ 쿠키 강화 예외 발생 (소요시간: ${enhancementDuration}ms):`, errorMessage);
    }
  }

  private async attemptTokenRefresh(): Promise<void> {
    try {
      console.log('🔄 토큰 갱신 시도 중...');
      
      if (!this.page) {
        console.log('❌ 페이지가 없습니다');
        return;
      }
      
      // 위버스 메인 페이지 방문으로 토큰 갱신 유도
      await this.page.goto('https://weverse.io/', { 
        waitUntil: 'networkidle',
        timeout: 10000 
      });
      
      // API 호출 대기 (토큰 갱신 발생 가능)
      await this.delay(2000);
      
      // 로그인 상태 확인
      const isStillLoggedIn = await this.page.evaluate(() => {
        // 로그인 상태 확인을 위한 DOM 요소 체크
        const loginButton = document.querySelector('[data-testid="login-button"]');
        const userProfile = document.querySelector('[data-testid="user-profile"]');
        
        return !loginButton && !!userProfile;
      });
      
      if (isStillLoggedIn) {
        console.log('✅ 토큰 갱신 성공 - 로그인 상태 유지');
        
        // 갱신된 쿠키 확인
        const refreshedCookies = await this.context!.cookies();
        const weversesCookies = refreshedCookies.filter(cookie => 
          cookie.domain.includes('weverse')
        );
        
        console.log(`📊 갱신 후 위버스 쿠키: ${weversesCookies.length}개`);
      } else {
        console.log('⚠️ 토큰 갱신 실패 - 재로그인 필요');
      }
      
    } catch (error) {
      console.warn('⚠️ 토큰 갱신 과정 중 오류:', error);
    }
  }

  /**
   * 토큰 만료 시간을 쿠키에서 추출
   */
  private async extractTokenExpiryTime(): Promise<number> {
    try {
      if (!this.context) {
        return 0;
      }

      const cookies = await this.context.cookies();
      const analysis = this.analyzeCookiesByPriority(cookies);
      
      // 고우선순위 토큰 쿠키에서 가장 빠른 만료 시간 찾기
      let earliestExpiry = Number.MAX_SAFE_INTEGER;
      let foundValidToken = false;
      
      for (const cookie of analysis.highPriority) {
        if (cookie.expires && cookie.expires > Date.now() / 1000) {
          const expiryMs = cookie.expires * 1000;
          if (expiryMs < earliestExpiry) {
            earliestExpiry = expiryMs;
            foundValidToken = true;
          }
          console.log(`🔑 토큰 쿠키 ${cookie.name}: 만료 ${new Date(expiryMs).toLocaleString()}`);
        }
      }
      
      if (foundValidToken) {
        this.tokenExpiryTime = earliestExpiry;
        console.log(`⏰ 토큰 만료 시간 업데이트: ${new Date(earliestExpiry).toLocaleString()}`);
        return earliestExpiry;
      }
      
      return 0;
    } catch (error) {
      console.error('❌ 토큰 만료 시간 추출 실패:', error);
      return 0;
    }
  }

  /**
   * 선제적 토큰 갱신 필요 여부 확인
   */
  private shouldPerformPreemptiveRefresh(): boolean {
    const currentTime = Date.now();
    
    // 토큰 만료 시간이 설정되어 있지 않으면 체크하지 않음
    if (this.tokenExpiryTime === 0) {
      return false;
    }
    
    // 마지막 체크 이후 충분한 시간이 지나지 않았으면 스킵
    if (currentTime - this.lastTokenRefreshCheck < this.tokenRefreshInterval) {
      return false;
    }
    
    // 토큰 만료 6시간 전인지 확인
    const preemptiveRefreshTime = this.preemptiveRefreshHours * 60 * 60 * 1000;
    const timeUntilExpiry = this.tokenExpiryTime - currentTime;
    
    if (timeUntilExpiry <= preemptiveRefreshTime && timeUntilExpiry > 0) {
      console.log(`⚠️ 토큰 만료 ${Math.round(timeUntilExpiry / (60 * 60 * 1000))}시간 전 - 선제적 갱신 필요`);
      return true;
    }
    
    return false;
  }

  /**
   * 향상된 토큰 갱신 (선제적 갱신 지원)
   */
  async performTokenRefresh(): Promise<boolean> {
    const startTime = Date.now();
    this.sessionMetrics.tokenRefreshAttempts++;
    this.logSessionStateChange('token-refreshing', 'refresh-initiated', 'Token refresh started', false);
    
    try {
      console.log('🔄 향상된 토큰 갱신 시작...');
      this.lastTokenRefreshCheck = Date.now();
      
      // 현재 토큰 상태 분석
      const currentExpiry = await this.extractTokenExpiryTime();
      
      if (currentExpiry === 0) {
        console.log('⚠️ 유효한 토큰을 찾을 수 없음 - 재로그인 필요');
        
        // 토큰 없음 로깅
        const refreshDuration = Date.now() - startTime;
        this.logSessionStateChange('token-refreshing', 'refresh-failed', `No valid token found after ${refreshDuration}ms`, true);
        console.log(`❌ 토큰 갱신 실패 - 유효한 토큰 없음 (소요시간: ${refreshDuration}ms)`);
        
        return false;
      }
      
      // 기존 토큰 갱신 로직 실행
      await this.attemptTokenRefresh();
      
      // 갱신 후 토큰 만료 시간 재확인
      const newExpiry = await this.extractTokenExpiryTime();
      
      if (newExpiry > currentExpiry) {
        console.log('✅ 토큰 갱신 성공 - 만료 시간 연장됨');
        console.log(`📅 이전: ${new Date(currentExpiry).toLocaleString()}`);
        console.log(`📅 갱신: ${new Date(newExpiry).toLocaleString()}`);
        
        // 토큰 갱신 성공 로깅
        this.sessionMetrics.tokenRefreshSuccesses++;
        const refreshDuration = Date.now() - startTime;
        const extensionHours = Math.round((newExpiry - currentExpiry) / (1000 * 60 * 60));
        this.logSessionStateChange('token-refreshing', 'token-refreshed', `Token refresh successful in ${refreshDuration}ms, extended by ${extensionHours}h`, true);
        console.log(`✅ 토큰 갱신 성공 (소요시간: ${refreshDuration}ms, 연장: ${extensionHours}시간)`);
        
        return true;
      } else if (newExpiry === currentExpiry) {
        console.log('⚠️ 토큰 갱신 후 만료 시간 변화 없음 - 갱신이 필요하지 않았을 수 있음');
        
        // 토큰 갱신 불필요 로깅
        this.sessionMetrics.tokenRefreshSuccesses++;
        const refreshDuration = Date.now() - startTime;
        this.logSessionStateChange('token-refreshing', 'refresh-unnecessary', `Token refresh unnecessary after ${refreshDuration}ms`, true);
        console.log(`⚠️ 토큰 갱신 불필요 (소요시간: ${refreshDuration}ms)`);
        
        return true; // 실패는 아니므로 true 반환
      } else {
        console.log('❌ 토큰 갱신 실패 - 만료 시간이 감소했거나 토큰이 무효화됨');
        
        // 토큰 갱신 실패 로깅
        const refreshDuration = Date.now() - startTime;
        this.logSessionStateChange('token-refreshing', 'refresh-failed', `Token refresh failed after ${refreshDuration}ms - expiry time decreased`, true);
        console.log(`❌ 토큰 갱신 실패 - 만료 시간 감소 (소요시간: ${refreshDuration}ms)`);
        
        return false;
      }
      
    } catch (error) {
      console.error('❌ 향상된 토큰 갱신 실패:', error);
      
      // 토큰 갱신 예외 로깅
      const refreshDuration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logSessionStateChange('token-refreshing', 'refresh-error', `Token refresh exception after ${refreshDuration}ms: ${errorMessage}`, true);
      console.log(`❌ 토큰 갱신 예외 발생 (소요시간: ${refreshDuration}ms):`, errorMessage);
      
      return false;
    }
  }

  /**
   * 토큰 상태 모니터링 및 선제적 갱신
   */
  async monitorTokenStatus(): Promise<void> {
    try {
      // 토큰 만료 시간 업데이트
      await this.extractTokenExpiryTime();
      
      // 선제적 갱신 필요 여부 확인
      if (this.shouldPerformPreemptiveRefresh()) {
        console.log('🚀 선제적 토큰 갱신 시작...');
        const refreshSuccess = await this.performTokenRefresh();
        
        if (refreshSuccess) {
          console.log('✅ 선제적 토큰 갱신 완료');
        } else {
          console.log('❌ 선제적 토큰 갱신 실패 - 세션 복구 시도');
          
          // 토큰 갱신 실패 시 세션 무결성 복구 시도
          const integrityRestored = await this.validateSessionIntegrity();
          if (!integrityRestored) {
            console.log('⚠️ 세션 복구 실패 - 사용자 재로그인 권장');
            await this.settingsService.updateSetting('needWeverseLogin', true);
          }
        }
      }
      
    } catch (error) {
      console.error('❌ 토큰 상태 모니터링 실패:', error);
    }
  }

  private async diagnoseNotificationStructure(): Promise<void> {
    console.log('🔍 위버스 알림 구조 진단 시작...');
    
    try {
      const structureInfo = await this.page!.evaluate(() => {
        const results = {
          notificationArea: false,
          notificationGroups: 0,
          allElementsInArea: [] as Array<{ tagName: string; className: string; textContent: string; }>,
          possibleSelectors: [] as Array<{ selector: string; count: number; }>
        };

        // 알림 영역 확인
        const notificationArea = document.querySelector('.HeaderNotificationView_notification_area__oJsnB');
        if (notificationArea) {
          results.notificationArea = true;
          
          // 영역 내 모든 요소 확인
          const allElements = notificationArea.querySelectorAll('*');
          results.allElementsInArea = Array.from(allElements).slice(0, 20).map(el => ({
            tagName: el.tagName,
            className: el.className,
            textContent: el.textContent?.trim().substring(0, 100) || ''
          }));

          // 알림 그룹 확인
          const notificationGroups = notificationArea.querySelectorAll('.HeaderNotificationListView_notification_group__LjdF1');
          results.notificationGroups = notificationGroups.length;

          // 가능한 다른 선택자들 확인
          const possibleGroupSelectors = [
            '.notification-group',
            '.HeaderNotificationListView_group',
            '[data-testid="notification-group"]',
            '.notification-list-group',
            '.weverse-notification-group'
          ];

          for (const selector of possibleGroupSelectors) {
            const elements = notificationArea.querySelectorAll(selector);
            if (elements.length > 0) {
              results.possibleSelectors.push({ selector, count: elements.length });
            }
          }
        }

        return results;
      });

      console.log('📊 위버스 알림 구조 진단 결과:');
      console.log(`  - 알림 영역 존재: ${structureInfo.notificationArea}`);
      console.log(`  - 알림 그룹 개수: ${structureInfo.notificationGroups}`);
      
      if (structureInfo.allElementsInArea.length > 0) {
        console.log('  - 알림 영역 내 요소들:');
        structureInfo.allElementsInArea.forEach((el, index) => {
          console.log(`    ${index + 1}. ${el.tagName}.${el.className} - "${el.textContent}"`);
        });
      }

      if (structureInfo.possibleSelectors.length > 0) {
        console.log('  - 가능한 대안 선택자들:');
        structureInfo.possibleSelectors.forEach(sel => {
          console.log(`    ${sel.selector} (${sel.count}개)`);
        });
      }

    } catch (error) {
      console.error('❌ 알림 구조 진단 실패:', error);
    }
  }

  // 아티스트 목록과 프로필 이미지를 함께 가져오는 메서드
  async fetchArtistsWithProfiles(): Promise<any[]> {
    try {
      console.log('🎨 위버스 아티스트 및 프로필 이미지 가져오기 시작...');
      
      if (!await this.ensureLoggedIn()) {
        console.log('❌ 위버스 로그인이 필요합니다');
        return [];
      }

      if (!this.page) {
        await this.setupBrowser();
      }

      await this.page!.goto('https://weverse.io/', { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });

      await this.page!.waitForTimeout(5000);

      // 알림 버튼 클릭
      const notificationButton = await this.page!.$('.HeaderNotificationWrapperView_notification__hCLgg button');
      if (!notificationButton) {
        console.warn('❌ 알림 버튼을 찾을 수 없습니다');
        return [];
      }

      await notificationButton.click();
      await this.page!.waitForTimeout(3000);

      // 필터 리스트 로드 대기
      try {
        await this.page!.waitForSelector('.HeaderNotificationFilterView_filter_list__SJf-t', { 
          timeout: 10000,
          state: 'visible'
        });
      } catch (error) {
        console.warn('❌ 필터 리스트 로드 실패');
        return [];
      }

      // 아티스트 정보 추출
      const artistsData = await this.page!.evaluate(() => {
        const filterItems = document.querySelectorAll('.HeaderNotificationFilterView_filter_item__qssjd');
        const artists: any[] = [];
        const excludedNames = ['전체', 'All', 'Shop'];
        
        filterItems.forEach(item => {
          const nameElement = item.querySelector('.HeaderNotificationFilterView_name__wE6JP');
          const imageElement = item.querySelector('.ProfileThumbnailView_thumbnail__8W3E7') as HTMLImageElement;
          
          if (nameElement) {
            const name = nameElement.textContent?.trim();
            
            if (name && !excludedNames.includes(name)) {
              const artist: any = {
                id: 0, // 임시 ID, 나중에 데이터베이스에서 설정
                artistName: name,
                isEnabled: true,
                profileImageUrl: imageElement?.src || undefined
              };
              
              artists.push(artist);
            }
          }
        });
        
        return artists;
      });

      console.log(`✅ 위버스 아티스트 및 프로필 이미지 가져오기 완료: ${artistsData.length}개`);
      return artistsData;

    } catch (error) {
      console.error('❌ 위버스 아티스트 정보 가져오기 실패:', error);
      return [];
    }
  }

  // 새로운 아티스트들의 baseline 설정 (알림 폭탄 방지)
  async establishBaselinesForNewArtists(artists: { id: number, artistName: string }[]): Promise<void> {
    try {
      console.log(`🎯 [위버스 기준선] ${artists.length}명의 아티스트에 대해 기준선 설정 시작`);
      
      if (!this.page) {
        await this.setupBrowser();
      }

      // 위버스 홈페이지 접근
      await this.page!.goto('https://weverse.io/', { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });
      await this.page!.waitForTimeout(3000);

      // 알림 버튼 클릭하여 알림 탭 열기
      const notificationButton = await this.page!.$('.HeaderNotificationWrapperView_notification__hCLgg button');
      if (!notificationButton) {
        console.warn('🎯 [위버스 기준선] 알림 버튼을 찾을 수 없습니다');
        return;
      }

      await notificationButton.click();
      await this.page!.waitForTimeout(2000);

      // 알림 탭이 열렸는지 확인
      const notificationAreaLoaded = await this.waitForNotificationArea();
      if (!notificationAreaLoaded) {
        console.warn('🎯 [위버스 기준선] 알림 컨테이너 로딩 실패');
        return;
      }

      // 현재 표시된 알림들에서 최신 알림 ID 추출
      const latestNotificationIds = await this.page!.evaluate((artistNames: string[]) => {
        const artistNotificationIds: Record<string, string> = {};
        
        const notificationArea = document.querySelector('.HeaderNotificationView_notification_area__oJsnB');
        if (!notificationArea) return artistNotificationIds;

        const notificationLists = notificationArea.querySelectorAll('.HeaderNotificationListView_notification_list__1naSI');
        
        notificationLists.forEach(notificationList => {
          const notificationItems = notificationList.querySelectorAll('li');
          
          notificationItems.forEach(item => {
            const artistElement = item.querySelector('.HeaderNotificationListView_notification_group__LjdF1');
            if (!artistElement) return;
            
            const artistName = artistElement.textContent?.trim() || '';
            if (!artistNames.includes(artistName)) return;
            
            // URL에서 알림 ID 추출
            const linkElement = item.querySelector('.HeaderNotificationListView_notification_link__OpT6v');
            const url = linkElement?.getAttribute('href') || '';
            
            if (url && url.length > 0) {
              const urlMatch = url.match(/\/(\d+)(?:\?|$)/);
              if (urlMatch) {
                const notificationId = urlMatch[1];
                
                // 가장 최신 알림 ID만 저장 (숫자가 큰 것)
                if (!artistNotificationIds[artistName] || 
                    parseInt(notificationId) > parseInt(artistNotificationIds[artistName])) {
                  artistNotificationIds[artistName] = notificationId;
                }
              }
            }
          });
        });
        
        return artistNotificationIds;
      }, artists.map(a => a.artistName));

      // 각 아티스트의 baseline 설정
      for (const artist of artists) {
        const latestId = latestNotificationIds[artist.artistName];
        
        if (latestId) {
          await this.databaseManager.establishWeverseBaseline(artist.id, latestId);
          console.log(`🎯 [위버스 기준선] ${artist.artistName}: ${latestId}`);
        } else {
          // 알림이 없는 경우 현재 시간을 기준으로 더미 ID 설정
          const dummyId = `baseline_${Date.now()}`;
          await this.databaseManager.establishWeverseBaseline(artist.id, dummyId);
          console.log(`🎯 [위버스 기준선] ${artist.artistName}: ${dummyId} (더미 기준선)`);
        }
      }

      console.log(`✅ [위버스 기준선] ${artists.length}명의 아티스트 기준선 설정 완료`);
      
    } catch (error) {
      console.error('❌ [위버스 기준선] 기준선 설정 실패:', error);
    }
  }

  private notifyWeverseLoginStatusChange(needLogin: boolean): void {
    try {
      console.log(`📢 [WeiverseMonitor] Broadcasting login status: needLogin=${needLogin}`);
      
      // 더 안전한 메인 윈도우 대상 알림 (NotificationService 패턴 사용)
      const { BrowserWindow } = require('electron');
      const allWindows = BrowserWindow.getAllWindows();
      
      let notificationsSent = 0;
      let failedNotifications = 0;
      
      allWindows.forEach((window: any) => {
        try {
          // 메인 윈도우만 대상으로 하고, 파괴된 윈도우/WebContents 필터링
          if (!window.isDestroyed() && 
              window.webContents && 
              !window.webContents.isDestroyed() &&
              window.webContents.getURL().includes('index.html')) {
            
            console.log(`📢 [WeiverseMonitor] Sending login status to main window: needLogin=${needLogin}`);
            window.webContents.send('weverse-login-status-changed', { needLogin });
            notificationsSent++;
          }
        } catch (windowError) {
          console.error(`❌ [WeiverseMonitor] Failed to send to specific window:`, windowError);
          failedNotifications++;
        }
      });
      
      console.log(`📊 [WeiverseMonitor] Login status broadcast complete: ${notificationsSent} sent, ${failedNotifications} failed`);
      
      // 백업: 전체 WebContents 대상 (안전성 강화)
      if (notificationsSent === 0) {
        console.log(`⚠️ [WeiverseMonitor] No main window found, trying fallback method`);
        
        try {
          const { webContents } = require('electron');
          const allWebContents = webContents.getAllWebContents();
          let fallbackSent = 0;
          
          allWebContents.forEach((wc: any) => {
            try {
              if (!wc.isDestroyed() && wc.getURL && wc.getURL().includes('index.html')) {
                wc.send('weverse-login-status-changed', { needLogin });
                fallbackSent++;
              }
            } catch (fallbackError) {
              // 개별 WebContents 오류는 무시
            }
          });
          
          console.log(`📊 [WeiverseMonitor] Fallback broadcast: ${fallbackSent} sent`);
        } catch (fallbackError) {
          console.error(`❌ [WeiverseMonitor] Fallback broadcast failed:`, fallbackError);
        }
      }
      
    } catch (error) {
      console.error('❌ [WeiverseMonitor] Failed to notify Weverse login status change:', error);
    }
  }

  /**
   * 쿠키를 우선순위별로 분류하고 분석
   */
  private analyzeCookiesByPriority(cookies: any[]): {
    highPriority: any[];
    mediumPriority: any[];
    lowPriority: any[];
    total: number;
    summary: string;
  } {
    const weversesCookies = cookies.filter(cookie => 
      WeiverseMonitor.WEVERSE_DOMAINS.some(domain => 
        cookie.domain === domain || 
        cookie.domain.endsWith(domain) ||
        domain.includes(cookie.domain) ||
        cookie.domain.includes('weverse')
      )
    );

    const highPriority = weversesCookies.filter(cookie => 
      WeiverseMonitor.CRITICAL_COOKIES.HIGH_PRIORITY.some(critical => 
        cookie.name.toLowerCase().includes(critical.toLowerCase())
      )
    );

    const mediumPriority = weversesCookies.filter(cookie => 
      WeiverseMonitor.CRITICAL_COOKIES.MEDIUM_PRIORITY.some(critical => 
        cookie.name.toLowerCase().includes(critical.toLowerCase())
      )
    );

    const lowPriority = weversesCookies.filter(cookie => 
      WeiverseMonitor.CRITICAL_COOKIES.LOW_PRIORITY.some(critical => 
        cookie.name.toLowerCase().includes(critical.toLowerCase())
      )
    );

    const summary = `총 ${weversesCookies.length}개 (고우선순위: ${highPriority.length}, 중우선순위: ${mediumPriority.length}, 저우선순위: ${lowPriority.length})`;

    return {
      highPriority,
      mediumPriority,
      lowPriority,
      total: weversesCookies.length,
      summary
    };
  }

  /**
   * 중요 쿠키를 백업
   */
  private async backupCriticalCookies(): Promise<any[]> {
    try {
      if (!this.context) {
        console.warn('⚠️ 브라우저 컨텍스트가 없어 쿠키 백업 불가');
        return [];
      }

      const cookies = await this.context.cookies();
      const analysis = this.analyzeCookiesByPriority(cookies);
      
      console.log(`🔒 중요 쿠키 백업 중... ${analysis.summary}`);
      
      // 우선순위 순으로 백업
      const backupCookies = [
        ...analysis.highPriority,
        ...analysis.mediumPriority,
        ...analysis.lowPriority
      ];

      // 쿠키 만료 시간 연장 처리
      const enhancedCookies = backupCookies.map(cookie => {
        const enhanced = { ...cookie };
        
        // 세션 쿠키이거나 만료 시간이 짧은 경우 연장 (7일로 확대)
        if (!cookie.expires || cookie.expires < Date.now() / 1000 + 86400) {
          enhanced.expires = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7일
          console.log(`🔧 쿠키 만료 시간 연장: ${cookie.name} (7일)`);
        }
        
        return enhanced;
      });

      console.log(`✅ 중요 쿠키 백업 완료: ${enhancedCookies.length}개`);
      return enhancedCookies;

    } catch (error) {
      console.error('❌ 중요 쿠키 백업 실패:', error);
      return [];
    }
  }

  /**
   * 백업된 쿠키를 복원
   */
  private async restoreCriticalCookies(backupCookies: any[]): Promise<boolean> {
    try {
      if (!this.context) {
        const errorMsg = '브라우저 컨텍스트가 없어 쿠키 복원 불가';
        weverseLogger.error(errorMsg);
        console.warn('⚠️ ' + errorMsg);
        return false;
      }

      if (!backupCookies || backupCookies.length === 0) {
        const warnMsg = '복원할 백업 쿠키가 없음';
        weverseLogger.warn(warnMsg);
        console.warn('⚠️ ' + warnMsg);
        return false;
      }

      weverseLogger.info('백업 쿠키 복원 시작', { totalCookies: backupCookies.length });
      console.log(`🔄 백업 쿠키 복원 중... ${backupCookies.length}개`);
      
      let successCount = 0;
      let highPrioritySuccess = 0;
      const failedCookies: string[] = [];
      
      // 우선순위별로 복원 시도
      for (const cookie of backupCookies) {
        try {
          await this.context.addCookies([cookie]);
          successCount++;
          
          // 고우선순위 쿠키 성공 개수 계산
          if (WeiverseMonitor.CRITICAL_COOKIES.HIGH_PRIORITY.some(critical => 
            cookie.name.toLowerCase().includes(critical.toLowerCase()))) {
            highPrioritySuccess++;
          }
          
          weverseLogger.debug('쿠키 복원 성공', { cookieName: cookie.name, domain: cookie.domain });
          console.log(`✅ 쿠키 복원 성공: ${cookie.name} (도메인: ${cookie.domain})`);
        } catch (restoreError) {
          const errorMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
          failedCookies.push(cookie.name);
          weverseLogger.warn('쿠키 복원 실패', { 
            cookieName: cookie.name, 
            domain: cookie.domain, 
            error: errorMessage 
          });
          console.warn(`⚠️ 쿠키 복원 실패 (${cookie.name}):`, restoreError);
        }
      }

      const successRate = (successCount / backupCookies.length) * 100;
      const isSuccess = successRate >= 70 && highPrioritySuccess >= 1;
      
      weverseLogger.info('쿠키 복원 완료', {
        successCount,
        totalCount: backupCookies.length,
        successRate: Number(successRate.toFixed(1)),
        highPrioritySuccess,
        isSuccess,
        failedCookies: failedCookies.length > 0 ? failedCookies : undefined
      });
      
      console.log(`📊 쿠키 복원 결과: ${successCount}/${backupCookies.length}개 성공 (${successRate.toFixed(1)}%)`);
      console.log(`🔑 고우선순위 쿠키 복원: ${highPrioritySuccess}개`);

      // 복원 성공률이 70% 이상이고 고우선순위 쿠키가 최소 1개 이상 복원되면 성공으로 간주
      return isSuccess;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      weverseLogger.error('쿠키 복원 실패', { error: errorMessage });
      console.error('❌ 쿠키 복원 실패:', error);
      return false;
    }
  }

  /**
   * 쿠키 무결성 검사 및 자동 복구
   */
  private async validateAndRepairCookies(): Promise<boolean> {
    try {
      if (!this.context) {
        return false;
      }

      const cookies = await this.context.cookies();
      const analysis = this.analyzeCookiesByPriority(cookies);
      
      console.log(`🔍 쿠키 무결성 검사: ${analysis.summary}`);

      // 무결성 검사 기준
      const hasMinimumHighPriority = analysis.highPriority.length >= 1;
      const hasMinimumTotal = analysis.total >= 5;
      
      if (hasMinimumHighPriority && hasMinimumTotal) {
        console.log('✅ 쿠키 무결성 검사 통과');
        return true;
      }

      console.log('⚠️ 쿠키 무결성 검사 실패 - 복구 시도');
      
      // 백업에서 복원 시도
      const backupCookies = await this.backupCriticalCookies();
      if (backupCookies.length > 0) {
        return await this.restoreCriticalCookies(backupCookies);
      }

      return false;

    } catch (error) {
      console.error('❌ 쿠키 무결성 검사 실패:', error);
      return false;
    }
  }

  /**
   * 세션 무결성 검증 (Public API)
   */
  async checkSessionIntegrity(): Promise<boolean> {
    return await this.validateSessionIntegrity();
  }

  /**
   * 쿠키 생명주기 강화 (Public API)
   */
  async enhanceSessionPersistence(): Promise<void> {
    return await this.enhanceCookieLifespan();
  }

  /**
   * 토큰 상태 모니터링 및 선제적 갱신 (Public API)
   */
  async performTokenMonitoring(): Promise<void> {
    return await this.monitorTokenStatus();
  }

  /**
   * 직접 토큰 갱신 수행 (Public API)
   */
  async forceTokenRefresh(): Promise<boolean> {
    return await this.performTokenRefresh();
  }

  /**
   * 세션 메트릭 조회 (Public API)
   */
  getSessionMetrics() {
    return {
      ...this.sessionMetrics,
      currentTime: Date.now(),
      uptimeHours: this.sessionMetrics.totalUptime / (1000 * 60 * 60),
      successRate: {
        login: this.sessionMetrics.loginAttempts > 0 ? 
          (this.sessionMetrics.loginSuccesses / this.sessionMetrics.loginAttempts * 100).toFixed(1) + '%' : 'N/A',
        tokenRefresh: this.sessionMetrics.tokenRefreshAttempts > 0 ? 
          (this.sessionMetrics.tokenRefreshSuccesses / this.sessionMetrics.tokenRefreshAttempts * 100).toFixed(1) + '%' : 'N/A',
        cookieRecovery: this.sessionMetrics.cookieRecoveryAttempts > 0 ? 
          (this.sessionMetrics.cookieRecoverySuccesses / this.sessionMetrics.cookieRecoveryAttempts * 100).toFixed(1) + '%' : 'N/A'
      }
    };
  }

  /**
   * 디버깅 정보 덤프 (Public API)
   */
  async dumpDebugInfo(): Promise<any> {
    try {
      const debugInfo: any = {
        timestamp: new Date().toISOString(),
        metrics: this.getSessionMetrics(),
        sessionState: {
          isLoggedIn: this.isLoggedIn,
          lastKnownLoginStatus: this.lastKnownLoginStatus,
          loginCheckInProgress: this.loginCheckInProgress,
          tokenExpiryTime: this.tokenExpiryTime ? new Date(this.tokenExpiryTime).toISOString() : null,
          lastTokenRefreshCheck: this.lastTokenRefreshCheck ? new Date(this.lastTokenRefreshCheck).toISOString() : null
        },
        browserState: {
          hasContext: !!this.context,
          hasPage: !!this.page,
          browserDataPath: this.browserDataPath,
          isPersistentContext: this.isPersistentContext
        }
      };

      if (this.context) {
        try {
          const cookies = await this.context.cookies();
          const analysis = this.analyzeCookiesByPriority(cookies);
          debugInfo['cookieState'] = {
            analysis: analysis.summary,
            highPriority: analysis.highPriority.length,
            mediumPriority: analysis.mediumPriority.length,
            lowPriority: analysis.lowPriority.length,
            total: analysis.total
          };
        } catch (cookieError) {
          const errorMessage = cookieError instanceof Error ? cookieError.message : String(cookieError);
          debugInfo['cookieState'] = { error: errorMessage };
        }
      }

      console.log('🔍 위버스 디버그 정보 덤프:');
      console.log(JSON.stringify(debugInfo, null, 2));

      return debugInfo;
    } catch (error) {
      console.error('❌ 디버그 정보 덤프 실패:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: errorMessage };
    }
  }

  /**
   * 세션 상태 변화 기록
   */
  private logSessionStateChange(from: string, to: string, reason: string, success: boolean): void {
    const change = {
      timestamp: Date.now(),
      from,
      to,
      reason,
      success
    };
    
    this.sessionMetrics.sessionStateChanges.push(change);
    
    // 최근 100개 변화만 유지
    if (this.sessionMetrics.sessionStateChanges.length > 100) {
      this.sessionMetrics.sessionStateChanges = this.sessionMetrics.sessionStateChanges.slice(-100);
    }
    
    // 상세 로깅
    const emoji = success ? '✅' : '❌';
    const timestamp = new Date(change.timestamp).toLocaleString();
    console.log(`${emoji} 세션 상태 변화: ${from} → ${to} (${reason}) [${timestamp}]`);
    
    // 실패한 상태 변화의 경우 추가 정보 로깅
    if (!success) {
      this.sessionMetrics.sessionFailures++;
      console.warn(`⚠️ 세션 실패 #${this.sessionMetrics.sessionFailures}: ${reason}`);
    }
  }

  /**
   * 메트릭 업데이트
   */
  private updateMetrics(type: 'login' | 'tokenRefresh' | 'cookieRecovery', success: boolean): void {
    switch (type) {
      case 'login':
        this.sessionMetrics.loginAttempts++;
        if (success) {
          this.sessionMetrics.loginSuccesses++;
          this.sessionMetrics.lastLoginTime = Date.now();
        }
        break;
      case 'tokenRefresh':
        this.sessionMetrics.tokenRefreshAttempts++;
        if (success) {
          this.sessionMetrics.tokenRefreshSuccesses++;
        }
        break;
      case 'cookieRecovery':
        this.sessionMetrics.cookieRecoveryAttempts++;
        if (success) {
          this.sessionMetrics.cookieRecoverySuccesses++;
        }
        break;
    }
    
    // 성공률 로깅 (매 10번마다)
    if (type === 'login' && this.sessionMetrics.loginAttempts % 10 === 0) {
      const successRate = (this.sessionMetrics.loginSuccesses / this.sessionMetrics.loginAttempts * 100).toFixed(1);
      console.log(`📊 로그인 성공률: ${successRate}% (${this.sessionMetrics.loginSuccesses}/${this.sessionMetrics.loginAttempts})`);
    }
  }

  /**
   * 업타임 업데이트
   */
  private updateUptime(): void {
    if (this.sessionMetrics.lastLoginTime > 0) {
      const currentUptime = Date.now() - this.sessionMetrics.lastLoginTime;
      this.sessionMetrics.totalUptime = currentUptime;
    }
  }


  async cleanup(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      
      if (this.context) {
        if (this.isPersistentContext) {
          console.log('Weverse persistent context preserved for session retention');
        } else {
          await this.context.close();
        }
        this.context = null;
      }
      
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      
      this.lastNotificationIds.clear();
      console.log('Weverse monitor cleaned up');
    } catch (error) {
      console.error('Error during Weverse cleanup:', error);
    }
  }
}