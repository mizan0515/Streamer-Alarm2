import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { DatabaseManager } from './DatabaseManager';
import { NotificationService } from './NotificationService';
import { SettingsService } from './SettingsService';
import { StreamerData, CafePost } from '@shared/types';
import { LRUCache, CleanupScheduler, MemoryMonitor } from './MemoryManager';
import { TimeoutConfig } from './TimeoutConfig';

export class CafeMonitor {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isPersistentContext: boolean = false;
  private databaseManager: DatabaseManager;
  private notificationService: NotificationService;
  private settingsService: SettingsService;
  private browserDataPath: string;
  private lastPostIds: LRUCache<string, string>;
  private isLoggedIn: boolean = false;
  private loginCheckInProgress: boolean = false;
  private lastKnownLoginStatus: boolean = false;
  private timeoutConfig: TimeoutConfig;

  // 카페 시간 파싱 함수
  private parseCafeDate(dateText: string): Date {
    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const currentDate = now.getDate();

      // 오늘 작성된 글 (예: "02:23")
      if (/^\d{2}:\d{2}$/.test(dateText)) {
        const [hours, minutes] = dateText.split(':').map(Number);
        const postDate = new Date(currentYear, currentMonth, currentDate, hours, minutes);
        return postDate;
      }

      // 이전 날짜 (예: "2025.07.07.")
      if (/^\d{4}\.\d{2}\.\d{2}\.$/.test(dateText)) {
        const [year, month, day] = dateText.replace('.', '').split('.').map(Number);
        const postDate = new Date(year, month - 1, day); // month는 0-based
        return postDate;
      }

      // 파싱 실패 시 현재 시간 반환
      console.warn(`Failed to parse cafe date: ${dateText}, using current time`);
      return now;

    } catch (error) {
      console.error(`Error parsing cafe date: ${dateText}`, error);
      return new Date(); // 백업으로 현재 시간 사용
    }
  }

  constructor(
    databaseManager: DatabaseManager, 
    notificationService: NotificationService,
    settingsService: SettingsService
  ) {
    this.databaseManager = databaseManager;
    this.notificationService = notificationService;
    this.settingsService = settingsService;
    this.timeoutConfig = TimeoutConfig.getInstance();
    
    // LRU 캐시 초기화 (최대 500개 항목, 4시간 TTL)
    this.lastPostIds = new LRUCache(500, 4 * 60 * 60 * 1000);
    
    // 정리 작업 등록
    const cleanup = CleanupScheduler.getInstance();
    cleanup.addTask('CafeMonitor-Cache-Cleanup', () => {
      const cleaned = this.lastPostIds.cleanup();
      console.log(`🧹 CafeMonitor cache cleanup: ${cleaned} items removed`);
    }, 2 * 60 * 60 * 1000); // 2시간마다 정리
    
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

  /**
   * 시스템 브라우저를 감지하고 실행하는 함수
   * Chrome > Edge > Chromium 순으로 시도
   */
  private async launchSystemBrowser(): Promise<BrowserContext | null> {
    const browsers = [
      { name: 'Chrome', channel: 'chrome' as const },
      { name: 'Edge', channel: 'msedge' as const }
    ];

    for (const browserInfo of browsers) {
      try {
        console.log(`🔍 ${browserInfo.name} 브라우저 시도 중...`);
        
        const launchOptions = {
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
          locale: 'ko-KR',
          channel: browserInfo.channel
        };

        const context = await chromium.launchPersistentContext(this.browserDataPath, launchOptions);

        console.log(`✅ ${browserInfo.name} 브라우저 실행 성공`);
        
        // 브라우저 정보를 설정에 저장 (사용자 정보용)
        if (this.settingsService) {
          await this.settingsService.updateSetting('currentCafeBrowser', browserInfo.name);
        }
        
        return context;
        
      } catch (error: any) {
        console.warn(`⚠️ ${browserInfo.name} 브라우저 실행 실패:`, error.message);
        continue;
      }
    }

    console.error('❌ 시스템에 Chrome 또는 Edge 브라우저를 찾을 수 없습니다.');
    console.error('💡 해결 방법:');
    console.error('   1. Google Chrome 설치: https://www.google.com/chrome/');
    console.error('   2. Microsoft Edge 설치: https://www.microsoft.com/edge');
    console.error('   3. 브라우저 업데이트 후 재시도');
    console.error('   4. 관리자 권한으로 애플리케이션 실행');
    
    throw new Error('Chrome 또는 Edge 브라우저가 필요합니다. 브라우저를 설치한 후 다시 시도해주세요.');
  }


  private async setupBrowser(): Promise<void> {
    if (this.context) return;

    try {
      // 시스템 브라우저 사용 (Chrome > Edge > Chromium 순으로 시도)
      this.context = await this.launchSystemBrowser();
      
      if (!this.context) {
        throw new Error('브라우저 컨텍스트 생성 실패');
      }

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
    // 동시 실행 방지 - 이미 진행 중이면 기존 결과 반환
    if (this.loginCheckInProgress) {
      console.log('🔄 Login check already in progress, returning cached status');
      return this.lastKnownLoginStatus;
    }

    // 뮤텍스 락 설정
    this.loginCheckInProgress = true;

    let loginCheckPage: Page | null = null;
    
    try {
      if (!this.context) {
        await this.setupBrowser();
      }

      console.log('🔍 Checking Naver login status via isolated page...');
      
      // 전용 페이지 생성 (기존 페이지와 격리)
      loginCheckPage = await this.context!.newPage();
      
      // 더 안정적인 페이지 로드 설정
      await loginCheckPage.goto('https://www.naver.com', { 
        waitUntil: 'domcontentloaded',  // networkidle 대신 더 안정적인 옵션
        timeout: this.timeoutConfig.getBrowserTimeout('navigation')
      });
      
      // DOM 요소 대기 (더 관대한 타임아웃)
      try {
        await loginCheckPage.waitForSelector('#account', { 
          timeout: this.timeoutConfig.getBrowserTimeout('selector_wait') 
        });
      } catch (selectorError) {
        console.warn('⚠️ #account selector not found, trying alternative method');
      }
      
      // 로그인 상태 확인 (더 안정적인 다중 시도 방식)
      let isLoggedIn = false;
      const maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`🔍 로그인 상태 확인 시도 ${attempt}/${maxRetries}...`);
        
        try {
          // 페이지가 완전히 로드될 때까지 잠시 대기
          await loginCheckPage.waitForTimeout(1000);
          
          isLoggedIn = await loginCheckPage.evaluate(() => {
            // 다중 로그인 상태 감지 방법 (더 포괄적)
            const loginElement = document.querySelector('.MyView-module__my_login___tOTgr');
            const profileElement = document.querySelector('.MyView-module__my_account_name___n6R_V');
            const accountElement = document.querySelector('#account .MyView-module__my_nickname___IJ_wH');
            const userNameElement = document.querySelector('.MyView-module__user_name___EWKUe');
            
            // 로그인 버튼이 없거나, 프로필/계정/유저명 요소가 있으면 로그인 상태
            const hasLoginButton = !!loginElement;
            const hasProfileInfo = !!(profileElement || accountElement || userNameElement);
            
            console.log('Login status check:', {
              hasLoginButton,
              hasProfileInfo,
              loginElement: !!loginElement,
              profileElement: !!profileElement,
              accountElement: !!accountElement,
              userNameElement: !!userNameElement
            });
            
            return !hasLoginButton || hasProfileInfo;
          });
          
          // 명확한 결과가 나왔거나 마지막 시도라면 종료
          if (isLoggedIn || attempt === maxRetries) {
            break;
          }
          
          // 다음 시도 전 잠시 대기
          if (attempt < maxRetries) {
            console.log('❓ 로그인 상태가 불분명합니다. 재시도 중...');
            await loginCheckPage.waitForTimeout(2000);
          }
          
        } catch (evalError) {
          console.warn(`⚠️ 로그인 상태 확인 시도 ${attempt} 실패:`, evalError);
          if (attempt === maxRetries) {
            // 모든 시도가 실패하면 안전하게 미로그인으로 처리
            isLoggedIn = false;
          }
        }
      }
      
      // 상태 업데이트
      this.isLoggedIn = isLoggedIn;
      this.lastKnownLoginStatus = isLoggedIn;
      
      // 설정 업데이트 (비동기로 처리하되 에러는 무시)
      this.settingsService.updateSetting('needNaverLogin', !isLoggedIn).catch(err => {
        console.warn('Failed to update needNaverLogin setting:', err);
      });
      
      console.log(isLoggedIn ? '✅ Naver login status: LOGGED IN' : '❌ Naver login status: NOT LOGGED IN');
      
      return isLoggedIn;
      
    } catch (error) {
      console.error('Failed to check login status:', error);
      
      // 오류 발생시 안전하게 미로그인으로 처리
      this.isLoggedIn = false;
      this.lastKnownLoginStatus = false;
      
      // 설정 업데이트 (에러 무시)
      this.settingsService.updateSetting('needNaverLogin', true).catch(() => {});
      
      return false;
      
    } finally {
      // 전용 페이지 정리
      if (loginCheckPage) {
        try {
          await loginCheckPage.close();
        } catch (closeError) {
          console.warn('Failed to close login check page:', closeError);
        }
      }
      
      // 뮤텍스 락 해제
      this.loginCheckInProgress = false;
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
        timeout: this.timeoutConfig.getBrowserTimeout('navigation')
      });
      
      await this.page!.waitForTimeout(this.timeoutConfig.getDelay('medium'));
      
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
        await this.page!.waitForTimeout(this.timeoutConfig.getDelay('medium'));
        
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
      // 로그인용 시스템 브라우저 시도 (headless: false)
      let loginBrowser: Browser | null = null;
      
      const loginBrowsers = [
        { name: 'Chrome', channel: 'chrome' as const },
        { name: 'Edge', channel: 'msedge' as const }
      ];

      for (const browserInfo of loginBrowsers) {
        try {
          console.log(`🔍 로그인용 ${browserInfo.name} 브라우저 시도 중...`);
          loginBrowser = await chromium.launch({
            headless: false,
            channel: browserInfo.channel,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote'
            ]
          });
          console.log(`✅ 로그인용 ${browserInfo.name} 브라우저 실행 성공`);
          break;
        } catch (error: any) {
          console.warn(`⚠️ 로그인용 ${browserInfo.name} 실행 실패:`, error.message);
          continue;
        }
      }

      if (!loginBrowser) {
        throw new Error('로그인용 브라우저를 실행할 수 없습니다. Chrome 또는 Edge를 설치해주세요.');
      }

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
        await loginPage.waitForSelector('#keep', { 
          timeout: this.timeoutConfig.getBrowserTimeout('selector_fast') 
        });
        
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
      
      // 사용자가 로그인할 때까지 대기 (최대 3분)
      console.log('Waiting for user to login...');
      
      try {
        // 로그인 완료 감지 (리다이렉트 확인) - 5분에서 3분으로 단축
        await loginPage.waitForURL('https://www.naver.com/', { 
          timeout: this.timeoutConfig.getBrowserTimeout('login_wait') 
        });
        
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
        
        // 로그인 완료 후 안정적인 상태 확인 (여러 번 시도)
        console.log('로그인 완료! 상태 확인 중...');
        let loginSuccess = false;
        const maxStatusChecks = 3;
        
        for (let attempt = 1; attempt <= maxStatusChecks; attempt++) {
          console.log(`로그인 상태 확인 시도 ${attempt}/${maxStatusChecks}...`);
          
          // 각 시도 전에 딜레이 (첫 번째 시도는 더 긴 딜레이)
          const delayTime = attempt === 1 ? 
            this.timeoutConfig.getDelay('login_retry') : 
            this.timeoutConfig.getDelay('short');
          await this.delay(delayTime);
          
          loginSuccess = await this.checkLoginStatus();
          
          if (loginSuccess) {
            console.log(`✅ 로그인 상태 확인 성공 (${attempt}번째 시도)`);
            break;
          } else {
            console.log(`❌ 로그인 상태 확인 실패 (${attempt}번째 시도)`);
            if (attempt < maxStatusChecks) {
              console.log('재시도 중...');
            }
          }
        }
        
        if (loginSuccess) {
          console.log('🎉 네이버 로그인이 성공적으로 완료되었습니다!');
          await this.settingsService.updateSetting('needNaverLogin', false);
        } else {
          console.log('⚠️ 로그인은 완료되었지만 상태 확인에 실패했습니다.');
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

  async checkAllStreamers(silentMode: boolean = false): Promise<CafePost[]> {
    if (!await this.ensureLoggedIn()) {
      if (!silentMode) {
        console.log('Not logged in to Naver Cafe, skipping cafe monitoring');
      }
      return [];
    }

    // robots.txt 준수 확인
    if (!await this.respectRobotsTxt()) {
      if (!silentMode) {
        console.log('robots.txt에 의해 카페 접근이 제한됨, 모니터링 중단');
      }
      return [];
    }

    try {
      const streamers = await this.databaseManager.getStreamers();
      const activeStreamers = streamers.filter(s => s.isActive && s.naverCafeUserId);

      if (!silentMode) {
        console.log(`Checking ${activeStreamers.length} cafe streamers...`);
      }

      const allPosts: CafePost[] = [];
      let processedCount = 0;
      const totalStreamers = activeStreamers.length;
      
      // 효율적인 순차 처리 (브라우저 기반이므로 병렬 처리 대신)
      for (const streamer of activeStreamers) {
        try {
          processedCount++;
          
          if (!silentMode) {
            console.log(`🔄 Processing cafe streamer ${processedCount}/${totalStreamers}: ${streamer.name}`);
          }
          
          const posts = await this.checkStreamerPosts(streamer, silentMode);
          
          if (posts.length > 0 && !silentMode) {
            console.log(`${streamer.name}: ${posts.length}개 새 게시물 발견`);
            
            // 최신 스트리머 정보 다시 조회 (알림 설정 동기화)
            const latestStreamers = await this.databaseManager.getStreamers();
            const latestStreamer = latestStreamers.find(s => s.id === streamer.id);
            
            // 스트리머별 카페 알림 설정 확인 (최신 정보 기준)
            if (latestStreamer?.notifications?.cafe && latestStreamer.isActive) {
              console.log(`${streamer.name}: 카페 알림이 활성화되어 있음, 알림 전송 시작...`);
              
              // 알림 전송 (HTML 본문 포함)
              for (const post of posts) {
                try {
                  // 게시물 HTML 본문 추출
                  let contentHtml: string | undefined;
                  try {
                    contentHtml = await this.fetchPostContent(post.url) || undefined;
                    if (contentHtml) {
                      console.log(`${streamer.name}: "${post.title}" HTML 본문 추출 성공 (${contentHtml.length}자)`);
                    }
                  } catch (htmlError) {
                    console.warn(`${streamer.name}: HTML 본문 추출 실패 - ${htmlError}`);
                  }

                  const notification = this.notificationService.createCafeNotification(
                    latestStreamer.name,
                    post.title,
                    post.url,
                    latestStreamer.profileImageUrl,
                    new Date(post.timestamp), // Pass the original post timestamp
                    contentHtml // Pass the extracted HTML content
                  );
                  await this.notificationService.sendNotification(notification);
                  console.log(`${streamer.name}: "${post.title}" 알림 전송 완료`);
                } catch (notifError) {
                  console.error(`${streamer.name}: 알림 전송 실패 - ${notifError}`);
                }
              }
            } else {
              console.log(`${streamer.name}: 카페 알림이 비활성화되어 있음, 알림 전송 스킵`);
            }
          }
          
          allPosts.push(...posts);
          
          // 적응형 딜레이 (서버 부하 방지 및 법적 안전)
          await this.adaptiveDelay();
        } catch (error) {
          console.error(`❌ Failed to check ${streamer.name} posts:`, error);
          
          // 에러 유형에 따른 적응적 처리
          if (error instanceof Error) {
            if (error.message.includes('timeout')) {
              console.warn(`⏰ ${streamer.name}: Timeout detected, increasing delay for next streamer`);
              await this.delay(this.timeoutConfig.getDelay('error_timeout')); // 타임아웃 시 추가 대기
            } else if (error.message.includes('Navigation failed')) {
              console.warn(`🌐 ${streamer.name}: Navigation failed, might be network issue`);
              await this.delay(this.timeoutConfig.getDelay('error_network')); // 네비게이션 실패 시 추가 대기
            } else if (error.message.includes('Page closed')) {
              console.warn(`📄 ${streamer.name}: Page was closed, reinitializing browser context`);
              try {
                await this.setupBrowser(); // 페이지 종료 시 브라우저 재초기화
              } catch (setupError) {
                console.error('Failed to reinitialize browser:', setupError);
              }
            }
          }
        }
      }

      if (!silentMode) {
        console.log(`Cafe check completed. New posts: ${allPosts.length}`);
      }
      
      return allPosts;
    } catch (error) {
      console.error('Failed to check cafe streamers:', error);
      return [];
    }
  }

  private async checkStreamerPosts(streamer: StreamerData, _silentMode: boolean = false): Promise<CafePost[]> {
    if (!streamer.naverCafeUserId || !this.page) {
      console.log(`${streamer.name}: 카페 사용자 ID 또는 페이지가 없습니다.`);
      return [];
    }

    try {
      // 카페 멤버 페이지로 이동
      const cafeUrl = `https://cafe.naver.com/ca-fe/cafes/${streamer.cafeClubId}/members/${streamer.naverCafeUserId}`;
      console.log(`${streamer.name}: 카페 URL 접근 - ${cafeUrl}`);
      
      await this.page.goto(cafeUrl, { 
        waitUntil: 'domcontentloaded', 
        timeout: this.timeoutConfig.getBrowserTimeout('navigation_fast') 
      });
      
      // 최소 대기 - 테이블이 바로 로드되는지 확인
      try {
        await this.page.waitForSelector('.article-board table tbody tr', { 
          timeout: this.timeoutConfig.getBrowserTimeout('selector_fast') 
        });
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
      
      // 🚨 NEW: 새 스트리머 초기화 처리 (과거 알림 폭탄 방지)
      const isNewStreamer = !lastPostId;
      if (isNewStreamer) {
        console.log(`🆕 ${streamer.name}: 새 스트리머 감지됨 - 과거 알림 차단 모드 활성화`);
        
        // 최신 게시물 ID만 저장하고 알림은 차단
        if (posts.posts.length > 0 && posts.posts[0].id) {
          await this.databaseManager.setMonitorState(
            streamer.id,
            'cafe',
            posts.posts[0].id, // 현재 최신 게시물을 기준점으로 설정
            'initialized'
          );
          this.lastPostIds.set(streamer.naverCafeUserId, posts.posts[0].id);
          console.log(`🆕 ${streamer.name}: 초기 기준점 설정 완료 (ID: ${posts.posts[0].id})`);
        }
        
        // 새 스트리머는 빈 배열 반환 (과거 알림 차단)
        return [];
      }
      
      const newPosts: CafePost[] = [];

      for (const post of posts.posts) {
        if (!post.id) continue;

        // 새 게시물인지 확인 (숫자 비교)
        const isNewPost = this.compareCafePostIds(post.id, lastPostId) > 0;
        
        if (isNewPost) {
          const originalTimestamp = this.parseCafeDate(post.date);
          
          // 🚨 NEW: 시간 기반 이중 필터링 (설정 가능한 시간 내 게시물만)
          const now = new Date();
          const timeDiff = now.getTime() - originalTimestamp.getTime();
          const hoursAgo = timeDiff / (1000 * 60 * 60);
          const filterHours = parseInt(this.settingsService.getSetting('newStreamerFilterHours'));
          
          if (hoursAgo > filterHours) {
            console.log(`⏰ ${streamer.name}: 게시물 "${post.title}" - ${filterHours}시간 이상 경과 (${hoursAgo.toFixed(1)}시간), 알림 차단`);
            continue;
          }
          
          console.log(`${streamer.name}: 게시물 "${post.title}" - 원본 시간: ${post.date} → 파싱된 시간: ${originalTimestamp.toISOString()}`);
          
          newPosts.push({
            id: post.id,
            title: post.title,
            url: post.url,
            author: streamer.name,
            timestamp: originalTimestamp.toISOString()
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

  // 사용하지 않는 유틸리티 메서드들 (호환성 유지를 위해 보존)
  private _extractPostId(url: string): string {
    const match = url.match(/articleid=(\d+)/);
    return match ? match[1] : '';
  }

  private _parseDate(dateStr: string): string {
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

  private async _handleNewPosts(streamer: StreamerData, posts: CafePost[]): Promise<void> {
    if (posts.length === 0) return;

    // 스트리머별 카페 알림 설정 확인
    if (!streamer.notifications?.cafe) return;

    // 데이터베이스에서 마지막 게시물 ID 조회 (중복 방지)
    const lastState = await this.databaseManager.getMonitorState(streamer.id, 'cafe');
    const lastPostId = lastState?.lastContentId;

    for (const post of posts) {
      // 이미 처리된 게시물인지 확인 (숫자 비교)
      if (lastPostId && this.compareCafePostIds(post.id, lastPostId) <= 0) {
        continue;
      }

      // 게시물 HTML 본문 추출
      let contentHtml: string | undefined;
      try {
        contentHtml = await this.fetchPostContent(post.url) || undefined;
      } catch (htmlError) {
        console.warn(`HTML 본문 추출 실패: ${htmlError}`);
      }

      const notification = this.notificationService.createCafeNotification(
        streamer.name,
        post.title,
        post.url,
        streamer.profileImageUrl,
        new Date(post.timestamp), // Pass the original post timestamp
        contentHtml // Pass the extracted HTML content
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
    // 기본 딜레이 설정
    let baseDelay = 2000; // 기본 2초
    
    // 메모리 상황에 따른 딜레이 조정
    try {
      const memoryMonitor = MemoryMonitor.getInstance();
      const usage = memoryMonitor.getCurrentUsage();
      
      if (usage.level === 'critical' || usage.level === 'emergency') {
        baseDelay *= 2; // 메모리 부족 시 딜레이 2배
        console.log(`🚨 High memory usage detected, increasing delay to ${baseDelay}ms`);
      } else if (usage.level === 'warning') {
        baseDelay *= 1.5; // 메모리 경고 시 딜레이 1.5배
      }
    } catch (error) {
      // 메모리 모니터 오류 시 기본 딜레이 사용
    }
    
    // 시간대별 딜레이 조정 (한국 시간 기준)
    const now = new Date();
    const hour = now.getHours();
    
    // 피크 시간대 (오후 6시-11시)에는 더 긴 딜레이
    if (hour >= 18 && hour <= 23) {
      baseDelay *= 1.3;
    }
    
    // 랜덤 지터 추가 (서버 부하 분산)
    const randomJitter = Math.random() * 1000;
    const totalDelay = baseDelay + randomJitter;
    
    console.log(`⏰ Adaptive delay: ${Math.round(totalDelay)}ms (base: ${baseDelay}ms)`);
    await this.delay(totalDelay);
  }

  // 특정 스트리머의 카페 글만 조용히 체크 (baseline 설정용)
  async checkSingleStreamerPosts(streamer: StreamerData): Promise<CafePost[]> {
    try {
      return await this.checkStreamerPosts(streamer, true); // silent mode
    } catch (error) {
      console.error(`Failed to check cafe posts for ${streamer.name}:`, error);
      return [];
    }
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

  // 카페 게시물 ID 숫자 비교 (오류 처리 포함)
  private compareCafePostIds(id1: string, id2: string): number {
    try {
      const num1 = parseInt(id1, 10);
      const num2 = parseInt(id2, 10);
      
      // 숫자 변환 검증
      if (isNaN(num1) || isNaN(num2)) {
        console.warn(`Invalid cafe post ID comparison: ${id1} vs ${id2}, falling back to string comparison`);
        // 숫자 변환 실패 시 문자열 비교로 폴백
        if (id1 > id2) return 1;
        if (id1 < id2) return -1;
        return 0;
      }
      
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
      return 0;
    } catch (error) {
      console.error('Failed to compare cafe post IDs:', error);
      // 오류 시 문자열 비교로 폴백
      if (id1 > id2) return 1;
      if (id1 < id2) return -1;
      return 0;
    }
  }

  // 카페 게시물의 전체 HTML 내용 추출 (아이프레임 대응)
  async fetchPostContent(postUrl: string): Promise<string | null> {
    if (!this.page) {
      console.warn('Browser page not available for content extraction');
      return null;
    }

    try {
      console.log(`📄 카페 게시물 내용 추출 시작: ${postUrl}`);
      
      // 아이프레임 URL인지 확인
      const isIframeUrl = postUrl.includes('ArticleRead.nhn');
      
      if (isIframeUrl) {
        console.log('🖼️ 아이프레임 URL 감지, 직접 접근 시도');
        
        // 아이프레임 URL로 직접 이동
        await this.page.goto(postUrl, { 
          waitUntil: 'domcontentloaded', 
          timeout: 15000 
        });
        
        // 아이프레임 내부 컨텐츠 대기
        try {
          await Promise.race([
            this.page.waitForSelector('.se-main-container', { timeout: 10000 }),
            this.page.waitForSelector('.se-viewer', { timeout: 10000 }),
            this.page.waitForSelector('#postViewArea', { timeout: 10000 })
          ]);
        } catch (selectorError) {
          console.warn('아이프레임 내부 컨텐츠 로드 대기 실패');
          await this.page.waitForTimeout(5000);
        }
      } else {
        console.log('📄 일반 게시물 URL, 표준 접근 시도');
        
        // 일반 게시물 페이지로 이동
        await this.page.goto(postUrl, { 
          waitUntil: 'domcontentloaded', 
          timeout: 15000 
        });
        
        // 게시물 내용 영역이 로드될 때까지 대기
        try {
          await Promise.race([
            this.page.waitForSelector('.se-viewer', { timeout: 8000 }),
            this.page.waitForSelector('.se-main-container', { timeout: 8000 }),
            this.page.waitForSelector('.ArticleContentBox', { timeout: 8000 }),
            this.page.waitForSelector('#postViewArea', { timeout: 8000 })
          ]);
        } catch (selectorError) {
          console.warn('게시물 내용 영역을 찾을 수 없습니다, 대체 방법 시도');
          // 추가 대기 시간 주기
          await this.page.waitForTimeout(3000);
        }
      }
      
      // HTML 내용 추출 (직접 접근 방식)
      const contentHtml = await this.page.evaluate(() => {
        // 우선순위별 셀렉터로 게시물 내용 찾기
        const contentSelectors = [
          '.se-main-container',           // 스마트에디터 메인 컨테이너 (가장 정확)
          '.se-viewer .se-main-container', // 뷰어 내부의 메인 컨테이너
          '.article_viewer .se-main-container', // 아티클 뷰어 내부
          '.CafeViewer .se-main-container',     // 카페 뷰어 내부
          '.se-viewer',                   // 스마트에디터 뷰어 전체
          '.article_viewer',              // 게시물 뷰어
          '.CafeViewer',                  // 카페 뷰어
          '.ArticleContentBox .content',  // 게시물 컨텐츠 박스
          '#postViewArea'                 // 게시물 보기 영역
        ];
        
        console.log('🔍 카페 게시물 내용 추출 시도...');
        
        // 우선순위별로 컨텐츠 검색
        for (const selector of contentSelectors) {
          const contentElement = document.querySelector(selector);
          if (contentElement) {
            console.log(`✅ 셀렉터로 요소 발견: ${selector}`);
            
            // HTML 내용 정제
            let htmlContent = contentElement.innerHTML;
            
            // 불필요한 요소들 제거
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            
            // 스크립트, 데이터, 광고 등 제거
            const unwantedSelectors = [
              'script[type="text/data"]',     // 스마트에디터 데이터 스크립트
              'script', 'style', 'noscript',
              '.ad', '.advertisement', '.sponsor',
              '.share-button', '.reaction-button',
              '[class*="ad-"]', '[id*="ad-"]',
              '.__se_module_data'             // 스마트에디터 모듈 데이터
            ];
            
            unwantedSelectors.forEach(sel => {
              const elements = tempDiv.querySelectorAll(sel);
              elements.forEach(el => el.remove());
            });
            
            // 정제된 HTML 반환
            const cleanedHtml = tempDiv.innerHTML.trim();
            
            // 텍스트 내용 확인 (빈 내용 방지)
            const textContent = tempDiv.textContent || tempDiv.innerText || '';
            const cleanTextContent = textContent.replace(/\s+/g, ' ').trim();
            
            console.log(`📄 추출된 텍스트 길이: ${cleanTextContent.length}자`);
            console.log(`📄 추출된 텍스트 샘플: "${cleanTextContent.substring(0, 100)}..."`);
            
            if (cleanTextContent.length > 5) { // 최소 5자 이상의 텍스트가 있어야 함
              console.log(`✅ 유효한 내용 발견: ${selector}`);
              return cleanedHtml;
            } else {
              console.log(`❌ 내용이 너무 짧음: ${selector}`);
            }
          } else {
            console.log(`❌ 요소 없음: ${selector}`);
          }
        }
        
        console.log('❌ 모든 셀렉터에서 유효한 내용을 찾지 못함');
        return null; // 유효한 내용을 찾지 못함
      });
      
      if (contentHtml && contentHtml.length > 20) {
        console.log(`✅ 게시물 내용 추출 성공: ${contentHtml.length}자`);
        return contentHtml;
      } else {
        console.warn('게시물 내용이 너무 짧거나 비어있습니다');
        return null;
      }
      
    } catch (error) {
      console.error(`게시물 내용 추출 실패: ${postUrl}`, error);
      return null;
    }
  }

  // 정리 작업
  async cleanup(): Promise<void> {
    console.log('🧹 Starting CafeMonitor cleanup...');
    
    try {
      // 1. 진행 중인 작업 중단
      this.loginCheckInProgress = false;
      
      // 2. 페이지 정리
      if (this.page) {
        try {
          // 페이지가 닫혀있지 않은 경우에만 정리
          if (!this.page.isClosed()) {
            await Promise.race([
              this.page.close(),
              new Promise(resolve => setTimeout(resolve, 5000)) // 5초 타임아웃
            ]);
          }
        } catch (pageError) {
          console.warn('Failed to close cafe page gracefully:', pageError);
        } finally {
          this.page = null;
        }
      }
      
      // 3. 컨텍스트 정리
      if (this.context) {
        try {
          if (this.isPersistentContext) {
            // 영구 컨텍스트의 경우 쿠키만 정리
            console.log('🔄 Cleaning persistent context cookies...');
            await this.context.clearCookies();
          } else {
            // 일반 컨텍스트는 완전히 정리
            await Promise.race([
              this.context.close(),
              new Promise(resolve => setTimeout(resolve, 5000)) // 5초 타임아웃
            ]);
          }
        } catch (contextError) {
          console.warn('Failed to clean context gracefully:', contextError);
        } finally {
          if (!this.isPersistentContext) {
            this.context = null;
          }
        }
      }
      
      // 4. 브라우저 정리
      if (this.context) {
        try {
          const pages = this.context.pages();
          console.log(`🔄 Closing ${pages.length} remaining pages...`);
          
          // 모든 페이지 강제 종료
          await Promise.allSettled(
            pages.map((page: any) => 
              Promise.race([
                page.close(),
                new Promise(resolve => setTimeout(resolve, 3000))
              ])
            )
          );
          
          // 브라우저 종료
          if (this.browser) {
            await Promise.race([
              this.browser.close(),
              new Promise(resolve => setTimeout(resolve, 10000)) // 10초 타임아웃
            ]);
          }
        } catch (browserError) {
          console.warn('Failed to close browser gracefully:', browserError);
          
          // 브라우저 종료는 close()로 충분
        } finally {
          this.browser = null;
        }
      }
      
      // 5. 캐시 정리
      this.lastPostIds.clear();
      
      // 6. 상태 초기화
      this.isLoggedIn = false;
      this.lastKnownLoginStatus = false;
      this.isPersistentContext = false;
      
      console.log('✅ CafeMonitor cleanup completed successfully');
      
    } catch (error) {
      console.error('❌ Error during CafeMonitor cleanup:', error);
      
      // 긴급 정리: 모든 상태 초기화
      this.page = null;
      this.context = null;
      this.browser = null;
      this.isLoggedIn = false;
      this.lastKnownLoginStatus = false;
      this.isPersistentContext = false;
      this.lastPostIds.clear();
    }
  }

  /**
   * 메모리 압박 시 즉시 정리를 수행합니다.
   */
  async emergencyCleanup(): Promise<void> {
    console.log('🚨 CafeMonitor emergency cleanup triggered');
    
    try {
      // 모든 리소스 강제 정리
      if (this.page && !this.page.isClosed()) {
        await this.page.close().catch(() => {});
      }
      
      if (this.context) {
        await this.context.close().catch(() => {});
      }
      
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
      
      // 상태 초기화
      this.page = null;
      this.context = null;
      this.browser = null;
      this.lastPostIds.clear();
      
      console.log('✅ CafeMonitor emergency cleanup completed');
      
    } catch (error) {
      console.error('❌ CafeMonitor emergency cleanup failed:', error);
    }
  }
}