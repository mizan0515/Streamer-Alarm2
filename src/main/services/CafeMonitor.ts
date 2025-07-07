import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { DatabaseManager } from './DatabaseManager';
import { NotificationService } from './NotificationService';
import { SettingsService } from './SettingsService';
import { StreamerData, CafePost } from '@shared/types';

export class CafeMonitor {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isPersistentContext: boolean = false;
  private databaseManager: DatabaseManager;
  private notificationService: NotificationService;
  private settingsService: SettingsService;
  private browserDataPath: string;
  private lastPostIds: Map<string, string> = new Map();
  private isLoggedIn: boolean = false;

  constructor(
    databaseManager: DatabaseManager, 
    notificationService: NotificationService,
    settingsService: SettingsService
  ) {
    this.databaseManager = databaseManager;
    this.notificationService = notificationService;
    this.settingsService = settingsService;
    
    // 브라우저 데이터 경로 설정
    const userDataPath = app.getPath('userData');
    this.browserDataPath = path.join(userDataPath, 'cafe_browser_data');
  }

  async initialize(): Promise<void> {
    try {
      await this.setupBrowser();
      await this.checkLoginStatus();
    } catch (error) {
      console.error('Failed to initialize cafe monitor:', error);
    }
  }

  private async ensureBrowserInstalled(): Promise<void> {
    try {
      console.log('🔍 Checking Playwright browser installation...');
      
      // Chromium 설치 여부 확인
      const browserPath = chromium.executablePath();
      
      if (browserPath && fs.existsSync(browserPath)) {
        console.log('✅ Playwright Chromium already installed');
        return;
      }
      
      console.log('📦 Playwright Chromium not found, attempting installation...');
      
      // 프로덕션 환경에서 Playwright CLI 경로 찾기
      let playwrightCliPath: string;
      
      if (app.isPackaged) {
        // 패키징된 앱에서는 asar.unpacked 경로 사용
        playwrightCliPath = path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
          'playwright',
          'cli.js'
        );
      } else {
        // 개발 환경에서는 일반 node_modules 경로 사용
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
        console.log('Installing Chromium browser...');
        execSync(`node "${playwrightCliPath}" install chromium`, {
          stdio: 'pipe',
          timeout: 120000 // 2분 타임아웃
        });
        console.log('✅ Playwright Chromium installed successfully');
      } else {
        console.warn('⚠️ Playwright CLI not found, browser may need manual installation');
      }
    } catch (error: any) {
      console.error('❌ Failed to install Playwright browser:', error.message);
      // 설치 실패해도 계속 시도 (브라우저가 이미 있을 수 있음)
    }
  }

  private async setupBrowser(): Promise<void> {
    if (this.context) return;

    try {
      // Playwright 브라우저 바이너리 확인 및 설치
      await this.ensureBrowserInstalled();
      
      // Chromium 브라우저 시작 (영구 데이터 디렉토리 사용)
      this.context = await chromium.launchPersistentContext(this.browserDataPath, {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'ko-KR'
      });

      // 영구 컨텍스트 사용 플래그 설정
      this.isPersistentContext = true;
      this.page = await this.context.newPage();
      
      // 타임아웃 설정
      this.page.setDefaultTimeout(15000);
      
      console.log('Cafe browser initialized with persistent context');
    } catch (error) {
      console.error('Failed to setup browser:', error);
      throw error;
    }
  }

  async checkLoginStatus(): Promise<boolean> {
    if (!this.page) {
      await this.setupBrowser();
    }

    try {
      // 네이버 메인 페이지에서 로그인 상태 확인 (가장 정확한 방법)
      console.log('🔍 Checking Naver login status via main page...');
      await this.page!.goto('https://www.naver.com', { 
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      // 페이지 로드 대기
      await this.page!.waitForTimeout(5000);
      
      const loginCheck = await this.page!.evaluate(() => {
        // 로그인된 상태 확인 요소들
        const loggedInElement = document.querySelector('.MyView-module__my_info___GNmHz');
        const nicknameElement = document.querySelector('.MyView-module__nickname___fcxwI');
        const logoutButton = document.querySelector('.MyView-module__btn_logout___bsTOJ');
        
        // 로그인 안된 상태 확인 요소들
        const notLoggedInElement = document.querySelector('.MyView-module__my_login___tOTgr');
        const loginButton = document.querySelector('.MyView-module__link_login___HpHMW');
        
        // 로그인 상태 판단
        const isLoggedIn = !!(loggedInElement && nicknameElement);
        const isLoggedOut = !!(notLoggedInElement && loginButton);
        
        // 닉네임 추출 (로그인된 경우)
        const nickname = nicknameElement ? nicknameElement.textContent?.trim() || '' : '';
        
        return {
          isLoggedIn: isLoggedIn,
          isLoggedOut: isLoggedOut,
          nickname: nickname,
          hasLoggedInElement: !!loggedInElement,
          hasNicknameElement: !!nicknameElement,
          hasLogoutButton: !!logoutButton,
          hasNotLoggedInElement: !!notLoggedInElement,
          hasLoginButton: !!loginButton,
          currentUrl: window.location.href
        };
      });
      
      console.log(`🔍 Login check result:`, loginCheck);
      
      // 로그인 상태 판단 및 저장
      this.isLoggedIn = loginCheck.isLoggedIn;
      
      if (loginCheck.isLoggedIn) {
        console.log(`✅ Naver login status: LOGGED IN (nickname: ${loginCheck.nickname})`);
        await this.settingsService.updateSetting('needNaverLogin', false);
      } else {
        console.log('❌ Naver login status: NOT LOGGED IN');
        await this.settingsService.updateSetting('needNaverLogin', true);
      }
      
      return this.isLoggedIn;
    } catch (error) {
      console.error('Failed to check login status:', error);
      // 오류 발생시 안전하게 미로그인으로 처리
      this.isLoggedIn = false;
      await this.settingsService.updateSetting('needNaverLogin', true);
      return false;
    }
  }

  async ensureLoggedIn(): Promise<boolean> {
    if (this.isLoggedIn) {
      return true;
    }

    return await this.checkLoginStatus();
  }

  async initiateLogout(): Promise<boolean> {
    try {
      // 먼저 현재 로그인 상태 확인
      const currentLoginStatus = await this.checkLoginStatus();
      if (!currentLoginStatus) {
        console.log('💡 Already logged out, no action needed');
        this.isLoggedIn = false;
        await this.settingsService.updateSetting('needNaverLogin', true);
        return true; // 이미 로그아웃된 상태이므로 성공으로 처리
      }

      if (!this.page) {
        await this.setupBrowser();
      }

      console.log('🚪 Starting Naver logout process...');
      
      // 네이버 메인 페이지로 이동
      await this.page!.goto('https://www.naver.com', { 
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      await this.page!.waitForTimeout(3000);
      
      // 로그아웃 버튼 찾기 및 클릭
      const logoutResult = await this.page!.evaluate(() => {
        // 로그아웃 버튼 셀렉터들
        const logoutSelectors = [
          '.MyView-module__btn_logout___bsTOJ',
          '[class*="btn_logout"]',
          'button:has-text("로그아웃")',
          'a:has-text("로그아웃")'
        ];
        
        for (const selector of logoutSelectors) {
          const logoutButton = document.querySelector(selector);
          if (logoutButton) {
            (logoutButton as HTMLElement).click();
            return { success: true, selector };
          }
        }
        
        return { success: false, selector: null };
      });
      
      if (logoutResult.success) {
        console.log(`로그아웃 버튼 클릭됨: ${logoutResult.selector}`);
        
        // 로그아웃 완료 대기
        await this.page!.waitForTimeout(3000);
        
        // 쿠키 및 세션 정리
        if (this.context) {
          await this.context.clearCookies();
          console.log('브라우저 쿠키 정리 완료');
        }
        
        // 로그인 상태 재확인
        const loginStatus = await this.checkLoginStatus();
        
        if (!loginStatus) {
          console.log('네이버 로그아웃 완료');
          await this.settingsService.updateSetting('needNaverLogin', true);
          return true;
        } else {
          console.log('로그아웃 실패 - 여전히 로그인 상태');
          return false;
        }
      } else {
        console.log('로그아웃 버튼을 찾을 수 없습니다');
        
        // 강제 쿠키 정리
        if (this.context) {
          await this.context.clearCookies();
          console.log('강제 쿠키 정리 완료');
        }
        
        this.isLoggedIn = false;
        await this.settingsService.updateSetting('needNaverLogin', true);
        return true;
      }
    } catch (error) {
      console.error('로그아웃 중 오류 발생:', error);
      
      // 오류 발생시에도 강제 정리
      try {
        if (this.context) {
          await this.context.clearCookies();
        }
        this.isLoggedIn = false;
        await this.settingsService.updateSetting('needNaverLogin', true);
      } catch (cleanupError) {
        console.error('정리 작업 중 오류:', cleanupError);
      }
      
      return false;
    }
  }

  async initiateLogin(): Promise<boolean> {
    try {
      // 로그인 전용 브라우저 인스턴스 생성 (headless: false)
      const loginBrowser = await chromium.launch({
        headless: false, // 사용자가 볼 수 있는 브라우저 창 표시
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote'
        ]
      });

      // 로그인 전용 컨텍스트 생성
      const loginContext = await loginBrowser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'ko-KR'
      });

      const loginPage = await loginContext.newPage();
      
      await loginPage.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'networkidle' });
      
      // 로그인 상태 유지 체크박스 자동 선택
      try {
        await loginPage.waitForSelector('#keep', { timeout: 5000 });
        
        // 체크박스가 체크되어 있지 않다면 라벨을 클릭하여 체크
        const isChecked = await loginPage.isChecked('#keep');
        if (!isChecked) {
          // 라벨을 클릭하는 방식으로 변경 (라벨이 체크박스를 가로채는 문제 해결)
          await loginPage.click('label[for="keep"]');
          console.log('로그인 상태 유지가 자동으로 선택되었습니다.');
        } else {
          console.log('로그인 상태 유지가 이미 선택되어 있습니다.');
        }
      } catch (error) {
        console.log('로그인 상태 유지 체크박스를 찾을 수 없습니다:', error instanceof Error ? error.message : String(error));
      }
      
      // 사용자가 로그인할 때까지 대기 (최대 5분)
      console.log('Waiting for user to login...');
      
      try {
        // 로그인 완료 감지 (리다이렉트 확인)
        await loginPage.waitForURL('https://www.naver.com/', { timeout: 300000 });
        
        console.log('Login completed successfully');
        
        // 로그인 세션 쿠키를 기존 컨텍스트로 복사
        const cookies = await loginContext.cookies();
        console.log(`복사할 쿠키 개수: ${cookies.length}`);
        
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
        
        // 로그인 전용 브라우저 정리
        await loginBrowser.close();
        
        // 약간의 딜레이 후 로그인 상태 재확인
        await this.delay(2000);
        console.log('로그인 상태를 확인합니다...');
        const loginSuccess = await this.checkLoginStatus();
        
        if (loginSuccess) {
          await this.settingsService.updateSetting('needNaverLogin', false);
        }
        
        return loginSuccess;
      } catch (error) {
        console.log('Login timeout or failed');
        await loginBrowser.close();
        return false;
      }
    } catch (error) {
      console.error('Failed to initiate login:', error);
      return false;
    }
  }

  async checkAllStreamers(): Promise<CafePost[]> {
    if (!await this.ensureLoggedIn()) {
      console.log('Not logged in to Naver Cafe, skipping cafe monitoring');
      return [];
    }

    // robots.txt 준수 확인
    if (!await this.respectRobotsTxt()) {
      console.log('robots.txt에 의해 카페 접근이 제한됨, 모니터링 중단');
      return [];
    }

    try {
      const streamers = await this.databaseManager.getStreamers();
      const activeStreamers = streamers.filter(s => s.isActive && s.naverCafeUserId);

      console.log(`Checking ${activeStreamers.length} cafe streamers...`);

      const allPosts: CafePost[] = [];

      for (const streamer of activeStreamers) {
        try {
          const posts = await this.checkStreamerPosts(streamer);
          
          if (posts.length > 0) {
            console.log(`${streamer.name}: ${posts.length}개 새 게시물 발견, 알림 전송 시작...`);
            
            // 즉시 알림 전송
            for (const post of posts) {
              try {
                const notification = this.notificationService.createCafeNotification(
                  streamer.name,
                  post.title,
                  post.url,
                  streamer.profileImageUrl
                );
                await this.notificationService.sendNotification(notification);
                console.log(`${streamer.name}: "${post.title}" 알림 전송 완료`);
              } catch (notifError) {
                console.error(`${streamer.name}: 알림 전송 실패 - ${notifError}`);
              }
            }
          }
          
          allPosts.push(...posts);
          
          // 적응형 딜레이 (서버 부하 방지 및 법적 안전)
          await this.adaptiveDelay();
        } catch (error) {
          console.error(`Failed to check ${streamer.name} posts:`, error);
        }
      }

      console.log(`Cafe check completed. New posts: ${allPosts.length}`);
      
      return allPosts;
    } catch (error) {
      console.error('Failed to check cafe streamers:', error);
      return [];
    }
  }

  private async checkStreamerPosts(streamer: StreamerData): Promise<CafePost[]> {
    if (!streamer.naverCafeUserId || !this.page) {
      console.log(`${streamer.name}: 카페 사용자 ID 또는 페이지가 없습니다.`);
      return [];
    }

    try {
      // 카페 멤버 페이지로 이동
      const cafeUrl = `https://cafe.naver.com/ca-fe/cafes/${streamer.cafeClubId}/members/${streamer.naverCafeUserId}`;
      console.log(`${streamer.name}: 카페 URL 접근 - ${cafeUrl}`);
      
      await this.page.goto(cafeUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      
      // 최소 대기 - 테이블이 바로 로드되는지 확인
      try {
        await this.page.waitForSelector('.article-board table tbody tr', { timeout: 5000 });
      } catch (selectorError) {
        console.log(`${streamer.name}: 게시물 목록을 찾을 수 없습니다.`);
        return [];
      }
      
      const posts = await this.page.evaluate(() => {
        const rows = document.querySelectorAll('.article-board table tbody tr');
        const posts: any[] = [];

        rows.forEach((row, index) => {
          if (index >= 15) return; // 최신 15개만
          
          const articleCell = row.querySelector('td.td_article');
          const dateCell = row.querySelector('td.td_date');
          const articleLink = articleCell?.querySelector('a[href*="articleid"]');
          
          if (articleLink && dateCell) {
            const title = articleLink.textContent?.trim();
            const href = articleLink.getAttribute('href');
            const date = dateCell.textContent?.trim();
            const articleIdMatch = href?.match(/articleid=(\d+)/);
            const articleId = articleIdMatch ? articleIdMatch[1] : '';
            
            if (title && href && articleId) {
              posts.push({
                title,
                url: href.startsWith('http') ? href : `https://cafe.naver.com${href}`,
                date,
                id: articleId
              });
            }
          }
        });

        return { posts, debugInfo: [] };
      });
      
      // 데이터베이스에서 마지막 게시물 ID 조회
      const lastState = await this.databaseManager.getMonitorState(streamer.id, 'cafe');
      const lastPostId = lastState?.lastContentId || this.lastPostIds.get(streamer.naverCafeUserId);
      
      const newPosts: CafePost[] = [];

      for (const post of posts.posts) {
        if (!post.id) continue;

        // 새 게시물인지 확인
        const isNewPost = !lastPostId || parseInt(post.id) > parseInt(lastPostId);
        
        if (isNewPost) {
          newPosts.push({
            id: post.id,
            title: post.title,
            url: post.url,
            author: streamer.name,
            timestamp: this.parseDate(post.date)
          });
        }
      }

      console.log(`${streamer.name}: 총 ${posts.posts.length}개 게시물 중 새 게시물 ${newPosts.length}개 발견`);
      
      if (newPosts.length > 0) {
        console.log(`${streamer.name}: 새 게시물 목록:`);
        newPosts.forEach((post, index) => {
          console.log(`  ${index + 1}. [${post.id}] ${post.title}`);
        });
      }

      // 가장 최신 게시물 ID를 데이터베이스에 저장
      if (posts.posts.length > 0 && posts.posts[0].id) {
        await this.databaseManager.setMonitorState(
          streamer.id,
          'cafe',
          posts.posts[0].id, // 첫 번째가 가장 최신
          'checked'
        );
        
        // 메모리 캐시도 업데이트 (호환성 유지)
        this.lastPostIds.set(streamer.naverCafeUserId, posts.posts[0].id);
        console.log(`${streamer.name}: 최신 게시물 ID ${posts.posts[0].id} 저장 완료`);
      }

      return newPosts;
    } catch (error) {
      console.error(`Error checking posts for ${streamer.name}:`, error);
      return [];
    }
  }

  private extractPostId(url: string): string {
    const match = url.match(/articleid=(\d+)/);
    return match ? match[1] : '';
  }

  private parseDate(dateStr: string): string {
    try {
      // "12.25" 형식을 현재 년도로 변환
      if (/^\d{2}\.\d{2}$/.test(dateStr)) {
        const currentYear = new Date().getFullYear();
        const [month, day] = dateStr.split('.');
        return new Date(currentYear, parseInt(month) - 1, parseInt(day)).toISOString();
      }
      
      // 기타 형식은 그대로 반환
      return new Date().toISOString();
    } catch (error) {
      return new Date().toISOString();
    }
  }

  private async handleNewPosts(streamer: StreamerData, posts: CafePost[]): Promise<void> {
    if (posts.length === 0) return;

    // 스트리머별 카페 알림 설정 확인
    if (!streamer.notifications?.cafe) return;

    // 데이터베이스에서 마지막 게시물 ID 조회 (중복 방지)
    const lastState = await this.databaseManager.getMonitorState(streamer.id, 'cafe');
    const lastPostId = lastState?.lastContentId;

    for (const post of posts) {
      // 이미 처리된 게시물인지 확인
      if (lastPostId && parseInt(post.id) <= parseInt(lastPostId)) {
        continue;
      }

      const notification = this.notificationService.createCafeNotification(
        streamer.name,
        post.title,
        post.url,
        streamer.profileImageUrl
      );

      await this.notificationService.sendNotification(notification);
      console.log(`Cafe notification sent for ${streamer.name}: ${post.title}`);
    }

    // 가장 최신 게시물 ID를 데이터베이스에 저장
    if (posts.length > 0) {
      const latestPost = posts[posts.length - 1]; // 시간순으로 정렬된 배열의 마지막
      await this.databaseManager.setMonitorState(
        streamer.id,
        'cafe',
        latestPost.id,
        'checked'
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 법적 안전을 위한 추가 보호 조치
  private async respectRobotsTxt(): Promise<boolean> {
    try {
      // robots.txt 준수 여부 확인 (일반적으로 네이버 카페는 허용)
      const response = await fetch('https://cafe.naver.com/robots.txt');
      const robotsTxt = await response.text();
      
      // User-agent: * 에 대한 Disallow 규칙 확인
      const lines = robotsTxt.split('\n');
      let userAgentSection = false;
      
      for (const line of lines) {
        if (line.toLowerCase().includes('user-agent: *')) {
          userAgentSection = true;
        } else if (line.toLowerCase().startsWith('user-agent:')) {
          userAgentSection = false;
        } else if (userAgentSection && line.toLowerCase().includes('disallow: /ca-fe')) {
          return false; // 카페 접근이 금지된 경우
        }
      }
      
      return true; // 기본적으로 허용
    } catch (error) {
      console.log('robots.txt 확인 실패, 기본 허용으로 처리');
      return true;
    }
  }

  // 서버 부하 방지를 위한 적응형 딜레이
  private async adaptiveDelay(): Promise<void> {
    // 기본 2초 + 랜덤 0-1초 (서버 부하 분산)
    const baseDelay = 2000;
    const randomDelay = Math.random() * 1000;
    const totalDelay = baseDelay + randomDelay;
    
    console.log(`Adaptive delay: ${Math.round(totalDelay)}ms`);
    await this.delay(totalDelay);
  }

  // 사용자 ID 검증
  async validateUserId(userId: string, cafeClubId: string): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!await this.ensureLoggedIn()) {
        return { valid: false, error: '네이버 로그인이 필요합니다' };
      }

      const testUrl = `https://cafe.naver.com/ca-fe/cafes/${cafeClubId}/members/${userId}`;
      await this.page!.goto(testUrl, { waitUntil: 'networkidle' });
      
      // 에러 페이지 확인
      const errorElement = await this.page!.$('.error_content, .no_content');
      if (errorElement) {
        return { valid: false, error: '사용자를 찾을 수 없습니다' };
      }
      
      // 게시물 목록 확인
      const hasContent = await this.page!.$('.board-list, .article-board');
      if (hasContent) {
        return { valid: true };
      } else {
        return { valid: false, error: '게시물을 찾을 수 없습니다' };
      }
    } catch (error) {
      return { valid: false, error: '사용자 ID를 확인할 수 없습니다' };
    }
  }

  // 메모리 캐시 초기화
  clearMemoryCache(): void {
    this.lastPostIds.clear();
    console.log('카페 모니터링 메모리 캐시 초기화 완료');
  }

  // 정리 작업
  async cleanup(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      
      if (this.context) {
        if (this.isPersistentContext) {
          // 영구 컨텍스트는 닫지 않고 유지 (세션 보존)
          console.log('Persistent context preserved for session retention');
        } else {
          await this.context.close();
        }
        this.context = null;
      }
      
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      
      this.lastPostIds.clear();
      console.log('Cafe monitor cleaned up');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}