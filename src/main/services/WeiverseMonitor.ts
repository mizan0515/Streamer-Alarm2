import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { app } from 'electron';
import { DatabaseManager } from './DatabaseManager';
import { NotificationService } from './NotificationService';
import { SettingsService } from './SettingsService';

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
  private browserDataPath: string;
  private isLoggedIn: boolean = false;
  private loginCheckInProgress: boolean = false;
  private lastKnownLoginStatus: boolean = false;
  private lastNotificationIds: Map<string, string> = new Map();

  /**
   * 위버스 시간 형식(예: "2025. 07. 01 21:19")을 JavaScript Date 객체로 변환
   * @param timeText 위버스에서 파싱한 시간 문자열
   * @returns JavaScript Date 객체 (UTC 기준)
   */
  private parseWeverseTime(timeText: string): Date {
    try {
      // 빈 문자열이나 null/undefined 처리
      if (!timeText || timeText.trim() === '') {
        console.warn(`⚠️ 위버스 시간 정보가 비어있음 - 현재 시간 사용`);
        return new Date();
      }
      
      // 정규식으로 시간 정보 추출: "2025. 07. 01 21:19"
      const timeMatch = timeText.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
      
      if (timeMatch) {
        const [, year, month, day, hour, minute] = timeMatch;
        
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
        
        // 한국 시간(KST, UTC+9)으로 Date 객체 생성
        const kstDate = new Date(
          yearNum,
          monthNum - 1, // JavaScript에서 월은 0부터 시작
          dayNum,
          hourNum,
          minuteNum,
          0 // 초
        );
        
        // 한국 시간을 UTC로 변환 (9시간 차이)
        const utcDate = new Date(kstDate.getTime() - (9 * 60 * 60 * 1000));
        
        console.log(`⏰ 위버스 시간 파싱 성공: "${timeText}" -> ${utcDate.toISOString()}`);
        return utcDate;
      }
      
      console.warn(`⚠️ 위버스 시간 파싱 실패: "${timeText}" - 현재 시간 사용`);
      return new Date();
      
    } catch (error) {
      console.error(`❌ 위버스 시간 파싱 오류: "${timeText}"`, error);
      return new Date();
    }
  }

  /**
   * 위버스 URL에서 고유한 ID를 추출하는 함수
   * @param url 위버스 URL
   * @returns 추출된 ID 문자열
   */
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
      console.log('🔍 Checking Playwright browser installation for Weverse...');
      
      const browserPath = chromium.executablePath();
      
      if (browserPath && fs.existsSync(browserPath)) {
        console.log('✅ Playwright Chromium already installed');
        return;
      }
      
      console.log('📦 Playwright Chromium not found, attempting installation...');
      
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
        console.log('Installing Chromium browser for Weverse...');
        
        const electronNodePath = process.execPath;
        execSync(`"${electronNodePath}" "${playwrightCliPath}" install chromium`, {
          stdio: 'pipe',
          timeout: 120000
        });
        console.log('✅ Playwright Chromium installed successfully');
      } else {
        console.warn('⚠️ Playwright CLI not found, browser may need manual installation');
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
          '--disable-features=VizDisplayCompositor'
        ],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'ko-KR',
        extraHTTPHeaders: {
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
        }
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
      
      console.log('Weverse browser initialized with persistent context');
      
      // 세션 복원 시도
      await this.attemptSessionRestore();
      
    } catch (error) {
      console.error('Failed to setup Weverse browser:', error);
      throw error;
    }
  }

  async checkLoginStatus(): Promise<boolean> {
    if (this.loginCheckInProgress) {
      console.log('🔄 Weverse login check already in progress, returning cached status');
      return this.lastKnownLoginStatus;
    }

    this.loginCheckInProgress = true;

    let loginCheckPage: Page | null = null;
    
    try {
      if (!this.context) {
        await this.setupBrowser();
      }

      console.log('🔍 Checking Weverse login status...');
      
      // 세션 무결성 먼저 검사
      const sessionIntegrity = await this.validateSessionIntegrity();
      if (!sessionIntegrity) {
        console.log('❌ 세션 무결성 검사 실패 - 로그인 필요');
        this.isLoggedIn = false;
        this.lastKnownLoginStatus = false;
        this.settingsService.updateSetting('needWeverseLogin', true).catch(() => {});
      this.notifyWeverseLoginStatusChange(true);
        this.notifyWeverseLoginStatusChange(true);
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
      
      console.log('🔍 위버스 로그인 상태 체크 결과:', loginCheckResult);
      
      const isLoggedIn = loginCheckResult.isLoggedIn;
      
      this.isLoggedIn = isLoggedIn;
      this.lastKnownLoginStatus = isLoggedIn;
      
      this.settingsService.updateSetting('needWeverseLogin', !isLoggedIn).catch(err => {
        console.warn('Failed to update needWeverseLogin setting:', err);
      });
      
      // UI에 위버스 로그인 상태 변경 즉시 알림
      this.notifyWeverseLoginStatusChange(!isLoggedIn);
      
      console.log(isLoggedIn ? '✅ Weverse login status: LOGGED IN' : '❌ Weverse login status: NOT LOGGED IN');
      
      return isLoggedIn;
      
    } catch (error) {
      console.error('Failed to check Weverse login status:', error);
      
      this.isLoggedIn = false;
      this.lastKnownLoginStatus = false;
      
      this.settingsService.updateSetting('needWeverseLogin', true).catch(() => {});
      this.notifyWeverseLoginStatusChange(true);
      
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
    try {
      const loginBrowser = await chromium.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=VizDisplayCompositor'
        ]
      });

      const loginContext = await loginBrowser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'ko-KR',
        extraHTTPHeaders: {
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
        }
      });

      const loginPage = await loginContext.newPage();
      
      // 로그인 페이지에도 자동화 감지 우회 스크립트 주입
      await loginPage.addInitScript(() => {
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
          csi: () => {},
          loadTimes: () => ({}),
          app: {
            isInstalled: false,
            InstallState: {
              DISABLED: 'disabled',
              INSTALLED: 'installed',
              NOT_INSTALLED: 'not_installed'
            },
            RunningState: {
              CANNOT_RUN: 'cannot_run',
              READY_TO_RUN: 'ready_to_run',
              RUNNING: 'running'
            }
          }
        };
        
        // permissions property 추가
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission } as PermissionStatus) :
            originalQuery(parameters)
        );
        
        // 기타 감지 우회
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        
        delete (navigator as any).__proto__.webdriver;
      });
      
      await loginPage.goto('https://account.weverse.io/ko/signup?client_id=weverse&redirect_uri=https%3A%2F%2Fweverse.io%2F&redirect_method=COOKIE', { 
        waitUntil: 'networkidle' 
      });
      
      console.log('Waiting for user to login to Weverse...');
      
      try {
        await loginPage.waitForURL('https://weverse.io/', { timeout: 300000 });
        
        console.log('Weverse login completed successfully');
        
        const allCookies = await loginContext.cookies();
        console.log(`전체 쿠키 개수: ${allCookies.length}`);
        
        // 위버스 관련 도메인 쿠키만 필터링 (더 포괄적인 도메인 목록)
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
        
        const weversesCookies = allCookies.filter(cookie => 
          weverseRelatedDomains.some(domain => 
            cookie.domain === domain || 
            cookie.domain.endsWith(domain) ||
            domain.includes(cookie.domain) ||
            cookie.domain.includes('weverse')
          )
        );
        
        console.log(`위버스 관련 쿠키 개수: ${weversesCookies.length}`);
        console.log('위버스 쿠키 상세:', weversesCookies.map(c => ({
          name: c.name,
          domain: c.domain,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
          expires: c.expires
        })));
        
        // 중요한 인증 관련 쿠키 존재 확인
        const criticalCookies = ['access_token', 'refresh_token', 'session_id', 'auth_token', 'weverse_session'];
        const foundCriticalCookies = weversesCookies.filter(cookie => 
          criticalCookies.some(critical => cookie.name.toLowerCase().includes(critical.toLowerCase()))
        );
        
        console.log(`중요 인증 쿠키 발견: ${foundCriticalCookies.length}개`);
        foundCriticalCookies.forEach(cookie => {
          console.log(`중요 쿠키: ${cookie.name} (도메인: ${cookie.domain})`);
        });
        
        if (this.context) {
          try {
            // 기존 쿠키 완전 삭제
            await this.context.clearCookies();
            console.log('기존 쿠키 삭제 완료');
            
            // 새 쿠키 추가 (개별 처리로 오류 확인)
            if (weversesCookies.length > 0) {
              console.log('🍪 쿠키 개별 설정 시작...');
              let successCount = 0;
              
              for (const cookie of weversesCookies) {
                try {
                  // 쿠키 유효성 검사 및 영구화
                  const cookieToAdd = { ...cookie };
                  
                  // expires가 -1이면 영구 쿠키로 변환 (30일 유효)
                  if (cookieToAdd.expires === -1) {
                    const thirtyDaysFromNow = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
                    cookieToAdd.expires = thirtyDaysFromNow;
                    console.log(`🔄 세션 쿠키 ${cookieToAdd.name}을 영구 쿠키로 변환 (30일)`);
                  }
                  
                  // 도메인은 원본 그대로 유지 (.weverse.io는 유효한 도메인 형태)
                  
                  console.log(`설정 중: ${cookieToAdd.name} (도메인: ${cookieToAdd.domain})`);
                  await this.context.addCookies([cookieToAdd]);
                  successCount++;
                  console.log(`✅ 성공: ${cookieToAdd.name}`);
                } catch (cookieError) {
                  console.error(`❌ 쿠키 설정 실패 ${cookie.name}:`, cookieError instanceof Error ? cookieError.message : String(cookieError));
                }
              }
              
              console.log(`🍪 쿠키 설정 완료: ${successCount}/${weversesCookies.length}개 성공`);
              
              // 쿠키 동기화를 위해 3초 대기
              console.log('⏱️ 쿠키 동기화를 위해 3초 대기 중...');
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              // 설정 후 확인
              console.log('🔍 쿠키 설정 후 확인...');
              const savedCookies = await this.context.cookies();
              const savedWeversesCookies = savedCookies.filter(cookie => 
                weverseRelatedDomains.some(domain => 
                  cookie.domain === domain || 
                  cookie.domain.endsWith(domain) ||
                  domain.includes(cookie.domain)
                )
              );
              
              console.log(`📊 저장된 위버스 쿠키: ${savedWeversesCookies.length}개`);
              savedWeversesCookies.forEach(cookie => {
                console.log(`  ✓ ${cookie.name}: ${cookie.domain} (${cookie.path})`);
              });
              
              if (savedWeversesCookies.length < successCount) {
                console.warn(`⚠️ 쿠키 저장 불일치: 설정 ${successCount}개 vs 저장 ${savedWeversesCookies.length}개`);
              }
            } else {
              console.warn('⚠️ 복사할 위버스 쿠키가 없습니다');
            }
          } catch (error) {
            console.error('위버스 쿠키 복사 실패:', error);
            
            // 쿠키 복사 실패 시 개별 쿠키 처리 시도
            console.log('개별 쿠키 복사 시도...');
            let successCount = 0;
            for (const cookie of weversesCookies) {
              try {
                await this.context.addCookies([cookie]);
                successCount++;
              } catch (cookieError) {
                console.warn(`쿠키 ${cookie.name} 복사 실패:`, cookieError);
              }
            }
            console.log(`개별 쿠키 복사 결과: ${successCount}/${weversesCookies.length}개 성공`);
          }
        }
        
        await loginBrowser.close();
        
        // 쿠키 설정 후 브라우저 컨텍스트 새로고침
        console.log('쿠키 동기화 및 세션 확립을 위해 처리 중...');
        
        // persistent context의 새 페이지에서 쿠키 확인
        if (this.context) {
          const testPage = await this.context.newPage();
          try {
            console.log('📄 새 페이지에서 위버스 접속하여 쿠키 동기화 확인...');
            await testPage.goto('https://weverse.io/', { 
              waitUntil: 'domcontentloaded',
              timeout: 15000 
            });
            
            // 페이지 완전 로딩 대기
            await testPage.waitForTimeout(3000);
            
            // 쿠키 확인
            const cookiesInNewPage = await testPage.evaluate(() => document.cookie);
            console.log(`🍪 새 페이지에서 확인된 쿠키 수: ${cookiesInNewPage.split(';').filter(c => c.trim()).length}개`);
            
            await testPage.close();
          } catch (testError) {
            console.warn('⚠️ 쿠키 동기화 테스트 페이지 오류:', testError);
            await testPage.close();
          }
        }
        
        // 대기 시간 증가 및 단계별 확인
        console.log('세션 안정화를 위해 8초 대기합니다...');
        await this.delay(8000);
        
        console.log('위버스 로그인 상태를 확인합니다...');
        
        // 단일 로그인 상태 확인 (재시도 제거)
        console.log('🔍 위버스 로그인 상태 최종 확인...');
        const loginSuccess = await this.checkLoginStatus();
        
        if (loginSuccess) {
          console.log('✅ 위버스 로그인 최종 성공!');
          await this.settingsService.updateSetting('needWeverseLogin', false);
          this.notifyWeverseLoginStatusChange(false);
        } else {
          console.log('❌ 위버스 로그인 최종 실패 - 모든 시도 완료');
          
          // 실패 원인 분석을 위한 추가 디버깅
          console.log('🔍 실패 원인 분석을 위한 추가 정보 수집...');
          try {
            const debugPage = await this.context!.newPage();
            await debugPage.goto('https://weverse.io/', { waitUntil: 'domcontentloaded', timeout: 15000 });
            
            // 더 긴 대기 시간으로 페이지 완전 로딩 확보
            await debugPage.waitForTimeout(5000);
            
            const debugInfo = await debugPage.evaluate(() => ({
              cookies: document.cookie,
              cookieCount: document.cookie.split(';').filter(c => c.trim()).length,
              hasAccessToken: document.cookie.includes('we2_access_token'),
              hasRefreshToken: document.cookie.includes('we2_refresh_token'),
              userAgent: navigator.userAgent,
              pageContent: document.body?.innerText?.substring(0, 500) || 'No content',
              hasLoginButton: !!document.querySelector('[data-testid="login-button"]'),
              hasNotificationButton: !!document.querySelector('.HeaderNotificationWrapperView_notification__hCLgg'),
              hasSignInText: (document.body?.innerText || '').includes('Sign in'),
              pageTitle: document.title,
              url: window.location.href
            }));
            
            console.log('🐛 상세 디버그 정보:', debugInfo);
            
            // 쿠키 상태 재확인
            const contextCookies = await this.context!.cookies('https://weverse.io');
            console.log(`🍪 컨텍스트 쿠키 상태: ${contextCookies.length}개`);
            contextCookies.forEach(cookie => {
              console.log(`  - ${cookie.name}: ${cookie.domain} (만료: ${cookie.expires ? new Date(cookie.expires * 1000).toISOString() : '세션'})`);
            });
            
            await debugPage.close();
          } catch (debugError) {
            console.log('디버그 정보 수집 실패:', debugError);
          }
        }
        
        return loginSuccess;
      } catch (error) {
        console.log('Weverse login timeout or failed');
        await loginBrowser.close();
        return false;
      }
    } catch (error) {
      console.error('Failed to initiate Weverse login:', error);
      return false;
    }
  }

  async initiateLogout(): Promise<boolean> {
    try {
      const currentLoginStatus = await this.checkLoginStatus();
      if (!currentLoginStatus) {
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
        console.log('Weverse 브라우저 쿠키 정리 완료');
      }
      
      const loginStatus = await this.checkLoginStatus();
      
      if (!loginStatus) {
        console.log('Weverse 로그아웃 완료');
        await this.settingsService.updateSetting('needWeverseLogin', true);
        this.notifyWeverseLoginStatusChange(true);
        return true;
      } else {
        console.log('Weverse 로그아웃 실패 - 여전히 로그인 상태');
        return false;
      }
    } catch (error) {
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
    // 로그인 상태 확인 및 복구 시도
    if (!await this.ensureLoggedIn()) {
      if (!silentMode) {
        console.log('Weverse not logged in, attempting recovery...');
      }
      
      // 로그인 실패 복구 시도
      const recoveryResult = await this.recoverFromLoginFailure();
      if (!recoveryResult) {
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
        console.log(`🎯 [위버스 기준선] ${artistsNeedingBaseline.length}명의 아티스트에 대해 기준선 설정이 필요합니다`);
        
        // Silent mode로 baseline 설정 (알림 발송 안함)
        await this.establishBaselinesForNewArtists(artistsNeedingBaseline);
      }
      
      const activeArtists = await this.databaseManager.getActiveWeverseArtists();
      
      if (activeArtists.length === 0) {
        if (!silentMode) {
          console.log('활성화된 위버스 아티스트가 없습니다');
        }
        return [];
      }

      if (!silentMode) {
        console.log(`🔍 ${activeArtists.length}개 위버스 아티스트 알림 확인 중...`);
      }

      if (!this.page) {
        await this.setupBrowser();
      }

      // 1단계: 위버스 홈페이지 접근
      console.log('🌐 위버스 홈페이지 접근 중...');
      await this.page!.goto('https://weverse.io/', { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });

      // 2단계: 페이지 로딩 완료 대기
      console.log('⏳ 페이지 로딩 완료 대기 중...');
      await this.page!.waitForTimeout(3000);

      // 3단계: 알림 버튼 찾기 및 클릭
      console.log('🔍 알림 버튼 찾는 중...');
      const notificationButton = await this.page!.$('.HeaderNotificationWrapperView_notification__hCLgg button');
      if (!notificationButton) {
        console.warn('❌ 알림 버튼을 찾을 수 없습니다');
        return [];
      }

      console.log('🔔 알림 버튼 클릭 중...');
      await notificationButton.click();
      
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
            
            // 정규식으로 시간 정보 추출: "2025. 07. 01 21:19"
            const timeMatch = timeText.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
            
            if (timeMatch) {
              const [, year, month, day, hour, minute] = timeMatch;
              
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
              
              // 한국 시간(KST, UTC+9)으로 Date 객체 생성
              const kstDate = new Date(
                yearNum,
                monthNum - 1, // JavaScript에서 월은 0부터 시작
                dayNum,
                hourNum,
                minuteNum,
                0 // 초
              );
              
              // 한국 시간을 UTC로 변환 (9시간 차이)
              const utcDate = new Date(kstDate.getTime() - (9 * 60 * 60 * 1000));
              
              console.log(`⏰ 위버스 시간 파싱 성공: "${timeText}" -> ${utcDate.toISOString()}`);
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
          foundNotifications.forEach((notification, index) => {
            console.log(`  ${index + 1}. ${notification.artistName}: ${notification.title.substring(0, 50)}...`);
          });
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
            console.log(`📱 [위버스] ${notification.artistName}: "${notification.title}" 알림 전송 완료`);
            
            // 알림 전송 성공 시에만 lastNotificationId 업데이트
            await this.databaseManager.updateWeverseArtistLastNotification(notification.artistName, notification.id);
            console.log(`🔄 [위버스] ${notification.artistName}의 lastNotificationId 업데이트: ${notification.id}`);
          } else {
            console.error(`❌ [위버스] ${notification.artistName}: "${notification.title}" 알림 전송 실패`);
            
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
    console.log('🔄 세션 복원 시도 중...');
    
    try {
      // 기존 쿠키 확인
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
      
      console.log(`기존 위버스 쿠키: ${existingWeversesCookies.length}개`);
      
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
        
        console.log(`✅ 세션 복원 완료: 유효한 쿠키 ${validCookies.length}개`);
      } else {
        console.log('⚠️ 복원할 세션 쿠키가 없습니다');
      }
      
    } catch (error) {
      console.error('❌ 세션 복원 실패:', error);
    }
  }

  private async validateSessionIntegrity(): Promise<boolean> {
    console.log('🔍 세션 무결성 검사 중...');
    
    try {
      if (!this.context) {
        console.log('❌ 브라우저 컨텍스트가 없습니다');
        return false;
      }
      
      const cookies = await this.context.cookies();
      const weverseRelatedDomains = [
        'weverse.io',
        '.weverse.io', 
        'account.weverse.io',
        '.account.weverse.io',
        'api.weverse.io',
        '.api.weverse.io'
      ];
      
      const weversesCookies = cookies.filter(cookie => 
        weverseRelatedDomains.some(domain => 
          cookie.domain === domain || 
          cookie.domain.endsWith(domain) ||
          domain.includes(cookie.domain) ||
          cookie.domain.includes('weverse')
        )
      );
      
      // 중요한 인증 관련 쿠키 확인
      const criticalCookies = ['access_token', 'refresh_token', 'session_id', 'auth_token', 'weverse_session'];
      const foundCriticalCookies = weversesCookies.filter(cookie => 
        criticalCookies.some(critical => cookie.name.toLowerCase().includes(critical.toLowerCase()))
      );
      
      // 만료된 쿠키 필터링
      const now = new Date();
      const validCookies = weversesCookies.filter(cookie => {
        if (!cookie.expires) return true; // 세션 쿠키는 유효한 것으로 간주
        return new Date(cookie.expires * 1000) > now;
      });
      
      console.log(`세션 무결성 검사 결과:`);
      console.log(`  - 총 위버스 쿠키: ${weversesCookies.length}개`);
      console.log(`  - 유효한 쿠키: ${validCookies.length}개`);
      console.log(`  - 중요 인증 쿠키: ${foundCriticalCookies.length}개`);
      
      // 개선된 검사 기준: 유효한 쿠키가 3개 이상 있거나 중요 쿠키가 1개 이상 있어야 함
      const hasMinimumCookies = validCookies.length >= 3 || foundCriticalCookies.length >= 1;
      
      // 만료된 쿠키가 있으면 정리
      if (validCookies.length < weversesCookies.length) {
        console.log(`⚠️ 만료된 쿠키 ${weversesCookies.length - validCookies.length}개 발견, 정리 중...`);
        try {
          await this.context.clearCookies();
          if (validCookies.length > 0) {
            await this.context.addCookies(validCookies);
            console.log(`✅ 유효한 쿠키 ${validCookies.length}개 복원 완료`);
          }
        } catch (cleanupError) {
          console.warn('⚠️ 쿠키 정리 중 오류:', cleanupError);
        }
      }
      
      if (hasMinimumCookies) {
        console.log('✅ 세션 무결성 검사 통과');
      } else {
        console.log('❌ 세션 무결성 검사 실패 - 쿠키가 부족하거나 만료됨');
      }
      
      return hasMinimumCookies;
      
    } catch (error) {
      console.error('❌ 세션 무결성 검사 오류:', error);
      return false;
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