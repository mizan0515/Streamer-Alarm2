/**
 * 타임아웃 및 딜레이 설정을 중앙 관리하는 클래스
 */
export class TimeoutConfig {
  private static instance: TimeoutConfig;
  
  // 기본 타임아웃 설정 (밀리초)
  private config = {
    // HTTP 요청 타임아웃
    http: {
      default: 10000,        // 기본 HTTP 요청 (10초)
      chzzk_api: 8000,       // CHZZK API 요청 (8초)
      twitter_rss: 20000,    // Twitter RSS 요청 (20초) - rate limit 대응
      twitter_page: 25000,   // Twitter 페이지 로드 (25초) - 증가
      twitter_tweet_load: 15000, // Twitter 트윗 로드 (15초) - 증가
      twitter_element: 12000, // Twitter 요소 대기 (12초) - 증가
      search: 10000          // 검색 요청 (10초)
    },
    
    // 브라우저 작업 타임아웃
    browser: {
      navigation: 25000,     // 페이지 네비게이션 (25초) - 증가
      navigation_fast: 15000, // 빠른 네비게이션 (15초) - 증가
      login_wait: 180000,    // 로그인 대기 (3분)
      selector_wait: 12000,  // 셀렉터 대기 (12초) - 증가
      selector_fast: 8000,   // 빠른 셀렉터 대기 (8초) - 증가
      content_load: 15000,   // 콘텐츠 로딩 (15초) - 증가
      page_close: 5000,      // 페이지 종료 (5초)
      context_close: 5000,   // 컨텍스트 종료 (5초)
      browser_close: 10000   // 브라우저 종료 (10초)
    },
    
    // 딜레이 설정
    delay: {
      // 기본 딜레이
      default: 1000,         // 기본 1초
      short: 500,            // 짧은 딜레이 (0.5초) 
      medium: 2000,          // 중간 딜레이 (2초)
      long: 5000,            // 긴 딜레이 (5초)
      
      // 스트리머 체크 간 딜레이
      between_streamers: 1000,     // 스트리머 간 기본 딜레이
      between_batches: 5000,       // 배치 간 딜레이 (rate limit 대응)
      
      // 에러 상황별 딜레이
      error_timeout: 10000,        // 타임아웃 에러 시 (rate limit 대응)
      error_network: 5000,         // 네트워크 에러 시
      error_general: 3000,         // 일반 에러 시
      error_rate_limit: 15000,     // rate limit 에러 시 (새로 추가)
      
      // 복구 딜레이
      browser_restart: 3000,       // 브라우저 재시작 후
      login_retry: 2000,           // 로그인 재시도 간
      
      // 적응형 딜레이 범위
      adaptive_base: 2000,         // 적응형 기본값
      adaptive_jitter_max: 1000,   // 최대 지터 (랜덤 추가)
      
      // 플랫폼별 특수 딜레이
      cafe_post_check: 2000,       // 카페 게시물 체크 간
      weverse_notification: 500,   // 위버스 알림 간
      twitter_fallback: 1500       // 트위터 폴백 시
    },
    
    // 재시도 설정
    retry: {
      max_attempts: 3,        // 최대 재시도 횟수
      backoff_base: 1000,     // 백오프 기본 시간
      backoff_multiplier: 2,  // 백오프 배수
      max_backoff: 30000      // 최대 백오프 시간
    }
  };
  
  // 동적 조정 팩터
  private dynamicFactors = {
    memoryPressure: 1.0,    // 메모리 압박 시 타임아웃 조정
    errorRate: 1.0,         // 에러율에 따른 조정
    timeOfDay: 1.0,         // 시간대별 조정
    systemLoad: 1.0         // 시스템 로드에 따른 조정
  };

  static getInstance(): TimeoutConfig {
    if (!TimeoutConfig.instance) {
      TimeoutConfig.instance = new TimeoutConfig();
    }
    return TimeoutConfig.instance;
  }

  /**
   * HTTP 타임아웃 값을 가져옵니다.
   */
  getHttpTimeout(type: 'default' | 'chzzk_api' | 'twitter_rss' | 'twitter_page' | 'twitter_tweet_load' | 'twitter_element' | 'search' = 'default'): number {
    const baseTimeout = this.config.http[type];
    return Math.round(baseTimeout * this.getAdjustmentFactor());
  }

  /**
   * 브라우저 타임아웃 값을 가져옵니다.
   */
  getBrowserTimeout(type: keyof typeof this.config.browser): number {
    const baseTimeout = this.config.browser[type];
    return Math.round(baseTimeout * this.getAdjustmentFactor());
  }

  /**
   * 딜레이 값을 가져옵니다.
   */
  getDelay(type: keyof typeof this.config.delay): number {
    const baseDelay = this.config.delay[type];
    
    // 적응형 딜레이의 경우 지터 추가
    if (type === 'adaptive_base') {
      const jitter = Math.random() * this.config.delay.adaptive_jitter_max;
      return Math.round((baseDelay + jitter) * this.getAdjustmentFactor());
    }
    
    return Math.round(baseDelay * this.getAdjustmentFactor());
  }

  /**
   * 재시도 설정을 가져옵니다.
   */
  getRetryConfig() {
    return { ...this.config.retry };
  }

  /**
   * 백오프 딜레이를 계산합니다.
   */
  getBackoffDelay(attempt: number): number {
    const baseDelay = this.config.retry.backoff_base;
    const multiplier = Math.pow(this.config.retry.backoff_multiplier, attempt - 1);
    const delay = Math.min(baseDelay * multiplier, this.config.retry.max_backoff);
    
    // 지터 추가 (thundering herd 방지)
    const jitter = Math.random() * 0.1 * delay;
    return Math.round(delay + jitter);
  }

  /**
   * 메모리 압박 상태에 따라 타임아웃 조정
   */
  updateMemoryPressure(level: 'normal' | 'warning' | 'critical' | 'emergency'): void {
    switch (level) {
      case 'normal':
        this.dynamicFactors.memoryPressure = 1.0;
        break;
      case 'warning':
        this.dynamicFactors.memoryPressure = 1.2; // 20% 증가
        break;
      case 'critical':
        this.dynamicFactors.memoryPressure = 1.5; // 50% 증가
        break;
      case 'emergency':
        this.dynamicFactors.memoryPressure = 2.0; // 100% 증가
        break;
    }
  }

  /**
   * 에러율에 따라 타임아웃 조정
   */
  updateErrorRate(errorRate: number): void {
    // 에러율이 높을수록 타임아웃 증가
    if (errorRate < 0.1) {
      this.dynamicFactors.errorRate = 1.0;
    } else if (errorRate < 0.3) {
      this.dynamicFactors.errorRate = 1.3;
    } else if (errorRate < 0.5) {
      this.dynamicFactors.errorRate = 1.6;
    } else {
      this.dynamicFactors.errorRate = 2.0;
    }
  }

  /**
   * 시간대에 따라 타임아웃 조정
   */
  updateTimeOfDay(): void {
    const hour = new Date().getHours();
    
    // 피크 시간대 (오후 6시-11시)에는 타임아웃 증가
    if (hour >= 18 && hour <= 23) {
      this.dynamicFactors.timeOfDay = 1.3;
    } else if (hour >= 0 && hour <= 6) {
      // 새벽 시간대에는 타임아웃 감소
      this.dynamicFactors.timeOfDay = 0.8;  
    } else {
      this.dynamicFactors.timeOfDay = 1.0;
    }
  }

  /**
   * 종합 조정 팩터 계산
   */
  private getAdjustmentFactor(): number {
    // 시간대 조정 업데이트
    this.updateTimeOfDay();
    
    // 모든 팩터의 평균 (극단적 증가 방지)
    const factors = Object.values(this.dynamicFactors);
    const averageFactor = factors.reduce((sum, factor) => sum + factor, 0) / factors.length;
    
    // 최소 0.5배, 최대 3배로 제한
    return Math.max(0.5, Math.min(3.0, averageFactor));
  }

  /**
   * 현재 설정 상태를 반환합니다.
   */
  getStatus() {
    const adjustmentFactor = this.getAdjustmentFactor();
    
    return {
      factors: { ...this.dynamicFactors },
      adjustmentFactor,
      sampleTimeouts: {
        httpDefault: this.getHttpTimeout('default'),
        browserNavigation: this.getBrowserTimeout('navigation'),
        delayDefault: this.getDelay('default')
      }
    };
  }

  /**
   * 설정을 기본값으로 재설정합니다.
   */
  reset(): void {
    this.dynamicFactors = {
      memoryPressure: 1.0,
      errorRate: 1.0,
      timeOfDay: 1.0,
      systemLoad: 1.0
    };
  }
}