/**
 * 에러 처리 및 복구 로직을 관리하는 중앙화된 클래스
 */
export class ErrorManager {
  private static instance: ErrorManager;
  
  // 에러 타입별 통계
  private errorStats = {
    network: { count: 0, lastOccurred: 0, consecutive: 0 },
    timeout: { count: 0, lastOccurred: 0, consecutive: 0 },
    browser: { count: 0, lastOccurred: 0, consecutive: 0 },
    auth: { count: 0, lastOccurred: 0, consecutive: 0 },
    parsing: { count: 0, lastOccurred: 0, consecutive: 0 },
    unknown: { count: 0, lastOccurred: 0, consecutive: 0 }
  };
  
  // 서비스별 에러 상태
  private serviceErrors = new Map<string, {
    errorCount: number;
    lastErrorTime: number;
    isHealthy: boolean;
    consecutiveFailures: number;
    lastSuccessTime: number;
    circuitBreakerOpen: boolean;
    nextRetryTime: number;
  }>();
  
  // 복구 전략 설정
  private recoveryStrategies = {
    network: {
      maxRetries: 3,
      backoffMultiplier: 2,
      baseDelay: 1000,
      maxDelay: 30000,
      circuitBreakerThreshold: 5
    },
    timeout: {
      maxRetries: 2,
      backoffMultiplier: 1.5,
      baseDelay: 2000,
      maxDelay: 15000,
      circuitBreakerThreshold: 3
    },
    browser: {
      maxRetries: 2,
      backoffMultiplier: 2,
      baseDelay: 3000,
      maxDelay: 20000,
      circuitBreakerThreshold: 3
    },
    auth: {
      maxRetries: 1,
      backoffMultiplier: 1,
      baseDelay: 5000,
      maxDelay: 10000,
      circuitBreakerThreshold: 2
    },
    parsing: {
      maxRetries: 1,
      backoffMultiplier: 1,
      baseDelay: 500,
      maxDelay: 2000,
      circuitBreakerThreshold: 10
    },
    unknown: {
      maxRetries: 1,
      backoffMultiplier: 1.5,
      baseDelay: 2000,
      maxDelay: 10000,
      circuitBreakerThreshold: 5
    }
  };

  static getInstance(): ErrorManager {
    if (!ErrorManager.instance) {
      ErrorManager.instance = new ErrorManager();
    }
    return ErrorManager.instance;
  }

  /**
   * 에러 타입을 분류합니다.
   */
  classifyError(error: Error | any): keyof typeof this.errorStats {
    const errorMessage = error?.message?.toLowerCase() || '';
    const errorName = error?.name?.toLowerCase() || '';
    
    // 네트워크 관련 에러
    if (errorMessage.includes('network') || 
        errorMessage.includes('fetch') ||
        errorMessage.includes('connection') ||
        errorMessage.includes('econnreset') ||
        errorMessage.includes('enotfound') ||
        error?.code === 'ECONNRESET' ||
        error?.code === 'ENOTFOUND' ||
        error?.response?.status >= 500) {
      return 'network';
    }
    
    // 타임아웃 에러
    if (errorMessage.includes('timeout') || 
        errorMessage.includes('time out') ||
        errorName.includes('timeout')) {
      return 'timeout';
    }
    
    // 브라우저 관련 에러
    if (errorMessage.includes('browser') ||
        errorMessage.includes('page') ||
        errorMessage.includes('context') ||
        errorMessage.includes('navigation') ||
        errorMessage.includes('selector') ||
        errorMessage.includes('element')) {
      return 'browser';
    }
    
    // 인증 관련 에러
    if (errorMessage.includes('auth') ||
        errorMessage.includes('login') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('forbidden') ||
        error?.response?.status === 401 ||
        error?.response?.status === 403) {
      return 'auth';
    }
    
    // 파싱 관련 에러
    if (errorMessage.includes('parse') ||
        errorMessage.includes('json') ||
        errorMessage.includes('xml') ||
        errorMessage.includes('invalid') ||
        errorName.includes('syntaxerror')) {
      return 'parsing';
    }
    
    return 'unknown';
  }

  /**
   * 에러를 기록하고 통계를 업데이트합니다.
   */
  recordError(serviceName: string, error: Error | any): void {
    const errorType = this.classifyError(error);
    const now = Date.now();
    
    // 전체 에러 통계 업데이트
    const errorStat = this.errorStats[errorType];
    errorStat.count++;
    errorStat.lastOccurred = now;
    
    // 연속 실패 계산 (5분 내 발생한 에러만 연속으로 간주)
    if (now - errorStat.lastOccurred < 5 * 60 * 1000) {
      errorStat.consecutive++;
    } else {
      errorStat.consecutive = 1;
    }
    
    // 서비스별 에러 상태 업데이트
    if (!this.serviceErrors.has(serviceName)) {
      this.serviceErrors.set(serviceName, {
        errorCount: 0,
        lastErrorTime: 0,
        isHealthy: true,
        consecutiveFailures: 0,
        lastSuccessTime: now,
        circuitBreakerOpen: false,
        nextRetryTime: 0
      });
    }
    
    const serviceError = this.serviceErrors.get(serviceName)!;
    serviceError.errorCount++;
    serviceError.lastErrorTime = now;
    serviceError.consecutiveFailures++;
    serviceError.isHealthy = false;
    
    // 서킷 브레이커 체크
    const strategy = this.recoveryStrategies[errorType];
    if (serviceError.consecutiveFailures >= strategy.circuitBreakerThreshold) {
      serviceError.circuitBreakerOpen = true;
      serviceError.nextRetryTime = now + this.calculateBackoffDelay(
        serviceError.consecutiveFailures, 
        errorType
      );
      
      console.warn(`🚨 Circuit breaker opened for ${serviceName} (${errorType} errors)`);
    }
    
    console.error(`❌ Error recorded [${serviceName}]: ${errorType} - ${error?.message || 'Unknown error'}`);
  }

  /**
   * 성공을 기록하고 상태를 복구합니다.
   */
  recordSuccess(serviceName: string): void {
    const now = Date.now();
    
    if (!this.serviceErrors.has(serviceName)) {
      this.serviceErrors.set(serviceName, {
        errorCount: 0,
        lastErrorTime: 0,
        isHealthy: true,
        consecutiveFailures: 0,
        lastSuccessTime: now,
        circuitBreakerOpen: false,
        nextRetryTime: 0
      });
      return;
    }
    
    const serviceError = this.serviceErrors.get(serviceName)!;
    const wasUnhealthy = !serviceError.isHealthy || serviceError.circuitBreakerOpen;
    
    serviceError.isHealthy = true;
    serviceError.consecutiveFailures = 0;
    serviceError.lastSuccessTime = now;
    serviceError.circuitBreakerOpen = false;
    serviceError.nextRetryTime = 0;
    
    // 연속 에러 통계 리셋
    for (const errorStat of Object.values(this.errorStats)) {
      errorStat.consecutive = 0;
    }
    
    if (wasUnhealthy) {
      console.log(`✅ Service ${serviceName} recovered successfully`);
    }
  }

  /**
   * 서비스가 재시도 가능한지 확인합니다.
   */
  canRetry(serviceName: string): boolean {
    if (!this.serviceErrors.has(serviceName)) {
      return true;
    }
    
    const serviceError = this.serviceErrors.get(serviceName)!;
    
    // 서킷 브레이커가 열려있으면 재시도 시간 체크
    if (serviceError.circuitBreakerOpen) {
      const now = Date.now();
      if (now < serviceError.nextRetryTime) {
        return false;
      }
      
      // 재시도 시간이 되면 반쯤 열린 상태로 전환
      console.log(`🔄 Circuit breaker half-open for ${serviceName}`);
    }
    
    return true;
  }

  /**
   * 에러 타입별 백오프 딜레이를 계산합니다.
   */
  calculateBackoffDelay(attempt: number, errorType: keyof typeof this.errorStats): number {
    const strategy = this.recoveryStrategies[errorType];
    const delay = Math.min(
      strategy.baseDelay * Math.pow(strategy.backoffMultiplier, attempt - 1),
      strategy.maxDelay
    );
    
    // 지터 추가 (thundering herd 방지)
    const jitter = Math.random() * 0.1 * delay;
    return Math.round(delay + jitter);
  }

  /**
   * 재시도 실행 헬퍼 함수
   */
  async executeWithRetry<T>(
    serviceName: string,
    operation: () => Promise<T>,
    maxRetries?: number
  ): Promise<T> {
    let lastError: any;
    let attempt = 0;
    
    while (attempt < (maxRetries || 3)) {
      attempt++;
      
      // 서킷 브레이커 체크
      if (!this.canRetry(serviceName)) {
        const serviceError = this.serviceErrors.get(serviceName);
        const waitTime = serviceError ? serviceError.nextRetryTime - Date.now() : 0;
        throw new Error(`Circuit breaker open for ${serviceName}. Retry in ${Math.round(waitTime/1000)}s`);
      }
      
      try {
        const result = await operation();
        this.recordSuccess(serviceName);
        return result;
      } catch (error) {
        lastError = error;
        this.recordError(serviceName, error);
        
        const errorType = this.classifyError(error);
        const strategy = this.recoveryStrategies[errorType];
        
        // 마지막 시도가 아니면 백오프 딜레이
        if (attempt < (maxRetries || strategy.maxRetries)) {
          const delay = this.calculateBackoffDelay(attempt, errorType);
          console.warn(`⏳ Retrying ${serviceName} in ${delay}ms (attempt ${attempt}/${maxRetries || strategy.maxRetries})`);
          await this.delay(delay);
        }
      }
    }
    
    throw lastError;
  }

  /**
   * 서비스 상태를 가져옵니다.
   */
  getServiceStatus(serviceName: string): {
    isHealthy: boolean;
    errorCount: number;
    consecutiveFailures: number;
    circuitBreakerOpen: boolean;
    lastErrorTime: number;
    lastSuccessTime: number;
  } {
    if (!this.serviceErrors.has(serviceName)) {
      return {
        isHealthy: true,
        errorCount: 0,
        consecutiveFailures: 0,
        circuitBreakerOpen: false,
        lastErrorTime: 0,
        lastSuccessTime: Date.now()
      };
    }
    
    const serviceError = this.serviceErrors.get(serviceName)!;
    return {
      isHealthy: serviceError.isHealthy,
      errorCount: serviceError.errorCount,
      consecutiveFailures: serviceError.consecutiveFailures,
      circuitBreakerOpen: serviceError.circuitBreakerOpen,
      lastErrorTime: serviceError.lastErrorTime,
      lastSuccessTime: serviceError.lastSuccessTime
    };
  }

  /**
   * 전체 에러 통계를 가져옵니다.
   */
  getErrorStats(): typeof this.errorStats {
    return { ...this.errorStats };
  }

  /**
   * 모든 서비스의 상태를 가져옵니다.
   */
  getAllServiceStatuses(): Map<string, ReturnType<typeof this.getServiceStatus>> {
    const statuses = new Map();
    for (const [serviceName] of this.serviceErrors) {
      statuses.set(serviceName, this.getServiceStatus(serviceName));
    }
    return statuses;
  }

  /**
   * 특정 에러 타입의 발생률을 계산합니다.
   */
  getErrorRate(errorType: keyof typeof this.errorStats, timeWindow: number = 60 * 60 * 1000): number {
    const now = Date.now();
    const errorStat = this.errorStats[errorType];
    
    if (now - errorStat.lastOccurred > timeWindow) {
      return 0;
    }
    
    // 간단한 발생률 계산 (시간 창 대비 연속 실패 횟수)
    return Math.min(errorStat.consecutive / 10, 1.0);
  }

  /**
   * 시스템 전체 건강도를 평가합니다.
   */
  getSystemHealth(): {
    overallHealth: 'healthy' | 'degraded' | 'critical';
    healthyServices: number;
    totalServices: number;
    criticalErrors: string[];
    recommendations: string[];
  } {
    const serviceStatuses = this.getAllServiceStatuses();
    const totalServices = serviceStatuses.size || 1;
    let healthyServices = 0;
    const criticalErrors: string[] = [];
    const recommendations: string[] = [];
    
    for (const [serviceName, status] of serviceStatuses) {
      if (status.isHealthy && !status.circuitBreakerOpen) {
        healthyServices++;
      } else if (status.circuitBreakerOpen) {
        criticalErrors.push(`${serviceName}: Circuit breaker open`);
      } else if (status.consecutiveFailures > 3) {
        criticalErrors.push(`${serviceName}: ${status.consecutiveFailures} consecutive failures`);
      }
    }
    
    const healthRatio = healthyServices / totalServices;
    let overallHealth: 'healthy' | 'degraded' | 'critical';
    
    if (healthRatio >= 0.8) {
      overallHealth = 'healthy';
    } else if (healthRatio >= 0.5) {
      overallHealth = 'degraded';
      recommendations.push('일부 서비스에 문제가 발생했습니다. 네트워크 상태를 확인해주세요.');
    } else {
      overallHealth = 'critical';
      recommendations.push('다수의 서비스에 심각한 문제가 발생했습니다. 시스템 재시작을 고려해주세요.');
    }
    
    // 에러 타입별 권장사항
    for (const [errorType, stats] of Object.entries(this.errorStats)) {
      if (stats.consecutive > 5) {
        switch (errorType) {
          case 'network':
            recommendations.push('네트워크 연결 상태를 확인하고 방화벽 설정을 점검해주세요.');
            break;
          case 'timeout':
            recommendations.push('시스템 성능이 저하되었습니다. 메모리 사용량을 확인해주세요.');
            break;
          case 'browser':
            recommendations.push('브라우저 관련 문제가 발생했습니다. 브라우저를 재시작해주세요.');
            break;
          case 'auth':
            recommendations.push('인증 문제가 발생했습니다. 로그인 상태를 확인해주세요.');
            break;
        }
      }
    }
    
    return {
      overallHealth,
      healthyServices,
      totalServices,
      criticalErrors,
      recommendations
    };
  }

  /**
   * 에러 통계를 리셋합니다.
   */
  resetStats(): void {
    for (const errorType of Object.keys(this.errorStats) as Array<keyof typeof this.errorStats>) {
      this.errorStats[errorType] = { count: 0, lastOccurred: 0, consecutive: 0 };
    }
    
    this.serviceErrors.clear();
    console.log('📊 Error statistics reset');
  }

  /**
   * 딜레이 헬퍼 함수
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}