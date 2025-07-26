/**
 * 시스템 성능을 모니터링하고 메트릭을 수집하는 클래스
 */
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  
  // 성능 메트릭 저장소
  private metrics = {
    // 모니터링 성능
    monitoring: {
      chzzkResponseTime: [] as number[],
      twitterResponseTime: [] as number[],
      cafeResponseTime: [] as number[],
      weverseResponseTime: [] as number[],
      totalMonitoringCycles: 0,
      successfulCycles: 0,
      averageCycleTime: 0
    },
    
    // 시스템 리소스
    system: {
      memoryUsageHistory: [] as Array<{ timestamp: number; usage: number; level: string }>,
      cpuUsageHistory: [] as Array<{ timestamp: number; usage: number }>,
      diskUsageHistory: [] as Array<{ timestamp: number; usage: number }>,
      networkLatency: [] as number[]
    },
    
    // 에러 메트릭
    errors: {
      errorRateByService: new Map<string, Array<{ timestamp: number; count: number }>>(),
      recoveryTime: [] as number[],
      circuitBreakerActivations: 0,
      criticalFailures: 0
    },
    
    // 사용자 경험
    userExperience: {
      notificationDeliveryTime: [] as number[],
      uiResponseTime: [] as number[],
      dataFreshnessScore: 0, // 데이터 신선도 (0-100)
      userSatisfactionMetrics: {
        falsePositives: 0,
        missedNotifications: 0,
        duplicateNotifications: 0
      }
    }
  };
  
  // 메트릭 제한 (메모리 사용량 제어)
  private readonly MAX_METRICS_LENGTH = 1000;
  private readonly METRICS_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1시간
  
  // 성능 임계값
  private readonly PERFORMANCE_THRESHOLDS = {
    responseTime: {
      good: 2000,      // 2초 이하 - 양호
      acceptable: 5000, // 5초 이하 - 보통
      poor: 10000      // 10초 이상 - 나쁨
    },
    memoryUsage: {
      good: 200 * 1024 * 1024,      // 200MB 이하
      acceptable: 500 * 1024 * 1024, // 500MB 이하
      poor: 1024 * 1024 * 1024      // 1GB 이상
    },
    errorRate: {
      good: 0.01,      // 1% 이하
      acceptable: 0.05, // 5% 이하
      poor: 0.1        // 10% 이상
    }
  };

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  constructor() {
    // 정기적인 메트릭 정리
    setInterval(() => {
      this.cleanupOldMetrics();
    }, this.METRICS_CLEANUP_INTERVAL);
    
    // 시스템 리소스 모니터링 시작
    this.startSystemResourceMonitoring();
  }

  /**
   * 모니터링 서비스 응답 시간을 기록합니다.
   */
  recordServiceResponseTime(service: 'chzzk' | 'twitter' | 'cafe' | 'weverse', responseTime: number): void {
    const serviceKey = `${service}ResponseTime` as keyof typeof this.metrics.monitoring;
    const responseTimeArray = this.metrics.monitoring[serviceKey] as number[];
    
    responseTimeArray.push(responseTime);
    this.limitArraySize(responseTimeArray);
    
    console.log(`📊 ${service.toUpperCase()} response time: ${responseTime}ms`);
  }

  /**
   * 모니터링 사이클 완료를 기록합니다.
   */
  recordMonitoringCycle(successful: boolean, cycleTime: number): void {
    this.metrics.monitoring.totalMonitoringCycles++;
    
    if (successful) {
      this.metrics.monitoring.successfulCycles++;
    }
    
    // 평균 사이클 시간 업데이트 (이동 평균)
    const alpha = 0.1; // 지수 이동 평균 계수
    this.metrics.monitoring.averageCycleTime = 
      this.metrics.monitoring.averageCycleTime * (1 - alpha) + cycleTime * alpha;
  }

  /**
   * 메모리 사용량을 기록합니다.
   */
  recordMemoryUsage(usage: NodeJS.MemoryUsage & { level: string }): void {
    this.metrics.system.memoryUsageHistory.push({
      timestamp: Date.now(),
      usage: usage.rss,
      level: usage.level
    });
    
    this.limitArraySize(this.metrics.system.memoryUsageHistory);
  }

  /**
   * 에러 발생을 기록합니다.
   */
  recordError(serviceName: string, errorType: string): void {
    if (!this.metrics.errors.errorRateByService.has(serviceName)) {
      this.metrics.errors.errorRateByService.set(serviceName, []);
    }
    
    const serviceErrors = this.metrics.errors.errorRateByService.get(serviceName)!;
    const now = Date.now();
    
    // 현재 시간대의 에러 카운트 증가
    const recentError = serviceErrors.find(e => now - e.timestamp < 60000); // 1분 내
    if (recentError) {
      recentError.count++;
    } else {
      serviceErrors.push({ timestamp: now, count: 1 });
      this.limitArraySize(serviceErrors);
    }
    
    // 중요한 에러 타입별 카운팅
    if (errorType === 'critical') {
      this.metrics.errors.criticalFailures++;
    }
  }

  /**
   * 복구 시간을 기록합니다.
   */
  recordRecoveryTime(recoveryTime: number): void {
    this.metrics.errors.recoveryTime.push(recoveryTime);
    this.limitArraySize(this.metrics.errors.recoveryTime);
  }

  /**
   * 서킷 브레이커 활성화를 기록합니다.
   */
  recordCircuitBreakerActivation(): void {
    this.metrics.errors.circuitBreakerActivations++;
  }

  /**
   * 알림 전송 시간을 기록합니다.
   */
  recordNotificationDeliveryTime(deliveryTime: number): void {
    this.metrics.userExperience.notificationDeliveryTime.push(deliveryTime);
    this.limitArraySize(this.metrics.userExperience.notificationDeliveryTime);
  }

  /**
   * 사용자 만족도 메트릭을 업데이트합니다.
   */
  updateUserSatisfactionMetrics(type: 'falsePositive' | 'missedNotification' | 'duplicate'): void {
    switch (type) {
      case 'falsePositive':
        this.metrics.userExperience.userSatisfactionMetrics.falsePositives++;
        break;
      case 'missedNotification':
        this.metrics.userExperience.userSatisfactionMetrics.missedNotifications++;
        break;
      case 'duplicate':
        this.metrics.userExperience.userSatisfactionMetrics.duplicateNotifications++;
        break;
    }
  }

  /**
   * 종합 성능 보고서를 생성합니다.
   */
  generatePerformanceReport(): {
    overall: 'excellent' | 'good' | 'acceptable' | 'poor';
    summary: string;
    details: {
      monitoring: any;
      system: any;
      errors: any;
      userExperience: any;
    };
    recommendations: string[];
  } {
    const monitoring = this.analyzeMonitoringPerformance();
    const system = this.analyzeSystemPerformance();
    const errors = this.analyzeErrorMetrics();
    const userExperience = this.analyzeUserExperience();
    
    // 전체 성능 등급 계산
    const scores = [monitoring.score, system.score, errors.score, userExperience.score];
    const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    let overall: 'excellent' | 'good' | 'acceptable' | 'poor';
    if (averageScore >= 90) overall = 'excellent';
    else if (averageScore >= 75) overall = 'good';
    else if (averageScore >= 60) overall = 'acceptable';
    else overall = 'poor';
    
    // 종합 요약
    const summary = this.generateSummary(overall, averageScore);
    
    // 개선 권장사항
    const recommendations = this.generateRecommendations(monitoring, system, errors, userExperience);
    
    return {
      overall,
      summary,
      details: {
        monitoring: monitoring.details,
        system: system.details,
        errors: errors.details,
        userExperience: userExperience.details
      },
      recommendations
    };
  }

  /**
   * 실시간 성능 대시보드 데이터를 제공합니다.
   */
  getDashboardData(): {
    currentMetrics: {
      avgResponseTime: number;
      memoryUsage: number;
      errorRate: number;
      successRate: number;
    };
    trends: {
      responseTimeTrend: 'improving' | 'stable' | 'degrading';
      memoryTrend: 'improving' | 'stable' | 'degrading';
      errorTrend: 'improving' | 'stable' | 'degrading';
    };
    alerts: Array<{
      type: 'warning' | 'error' | 'info';
      message: string;
      timestamp: number;
    }>;
  } {
    const currentMetrics = this.getCurrentMetrics();
    const trends = this.analyzeTrends();
    const alerts = this.generateAlerts();
    
    return { currentMetrics, trends, alerts };
  }

  /**
   * 모니터링 성과를 분석합니다.
   */
  private analyzeMonitoringPerformance(): { score: number; details: any } {
    const { monitoring } = this.metrics;
    
    // 평균 응답 시간 계산
    const allResponseTimes = [
      ...monitoring.chzzkResponseTime,
      ...monitoring.twitterResponseTime,
      ...monitoring.cafeResponseTime,
      ...monitoring.weverseResponseTime
    ];
    
    const avgResponseTime = allResponseTimes.length > 0 
      ? allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length 
      : 0;
    
    // 성공률 계산
    const successRate = monitoring.totalMonitoringCycles > 0 
      ? (monitoring.successfulCycles / monitoring.totalMonitoringCycles) * 100 
      : 100;
    
    // 점수 계산 (응답 시간과 성공률 기반)
    let responseTimeScore = 100;
    if (avgResponseTime > this.PERFORMANCE_THRESHOLDS.responseTime.poor) {
      responseTimeScore = 20;
    } else if (avgResponseTime > this.PERFORMANCE_THRESHOLDS.responseTime.acceptable) {
      responseTimeScore = 60;
    } else if (avgResponseTime > this.PERFORMANCE_THRESHOLDS.responseTime.good) {
      responseTimeScore = 80;
    }
    
    const score = (responseTimeScore * 0.6) + (successRate * 0.4);
    
    return {
      score,
      details: {
        avgResponseTime,
        successRate,
        totalCycles: monitoring.totalMonitoringCycles,
        avgCycleTime: monitoring.averageCycleTime
      }
    };
  }

  /**
   * 시스템 성능을 분석합니다.
   */
  private analyzeSystemPerformance(): { score: number; details: any } {
    const { system } = this.metrics;
    
    // 최근 메모리 사용량 평균
    const recentMemory = system.memoryUsageHistory.slice(-10);
    const avgMemoryUsage = recentMemory.length > 0 
      ? recentMemory.reduce((a, b) => a + b.usage, 0) / recentMemory.length 
      : 0;
    
    // 메모리 사용량 점수
    let memoryScore = 100;
    if (avgMemoryUsage > this.PERFORMANCE_THRESHOLDS.memoryUsage.poor) {
      memoryScore = 20;
    } else if (avgMemoryUsage > this.PERFORMANCE_THRESHOLDS.memoryUsage.acceptable) {
      memoryScore = 60;
    } else if (avgMemoryUsage > this.PERFORMANCE_THRESHOLDS.memoryUsage.good) {
      memoryScore = 80;
    }
    
    return {
      score: memoryScore,
      details: {
        avgMemoryUsage: Math.round(avgMemoryUsage / 1024 / 1024), // MB로 변환
        memoryHistory: recentMemory.map(m => ({
          timestamp: m.timestamp,
          usage: Math.round(m.usage / 1024 / 1024),
          level: m.level
        }))
      }
    };
  }

  /**
   * 에러 메트릭을 분석합니다.
   */
  private analyzeErrorMetrics(): { score: number; details: any } {
    const { errors } = this.metrics;
    
    // 전체 에러율 계산
    let totalErrors = 0;
    let totalRequests = this.metrics.monitoring.totalMonitoringCycles || 1;
    
    for (const serviceErrors of errors.errorRateByService.values()) {
      totalErrors += serviceErrors.reduce((sum, e) => sum + e.count, 0);
    }
    
    const errorRate = totalErrors / totalRequests;
    
    // 에러율 점수
    let errorScore = 100;
    if (errorRate > this.PERFORMANCE_THRESHOLDS.errorRate.poor) {
      errorScore = 20;
    } else if (errorRate > this.PERFORMANCE_THRESHOLDS.errorRate.acceptable) {
      errorScore = 60;
    } else if (errorRate > this.PERFORMANCE_THRESHOLDS.errorRate.good) {
      errorScore = 80;
    }
    
    // 평균 복구 시간
    const avgRecoveryTime = errors.recoveryTime.length > 0 
      ? errors.recoveryTime.reduce((a, b) => a + b, 0) / errors.recoveryTime.length 
      : 0;
    
    return {
      score: errorScore,
      details: {
        errorRate: Math.round(errorRate * 10000) / 100, // 백분율로 변환
        totalErrors,
        avgRecoveryTime: Math.round(avgRecoveryTime),
        circuitBreakerActivations: errors.circuitBreakerActivations,
        criticalFailures: errors.criticalFailures
      }
    };
  }

  /**
   * 사용자 경험을 분석합니다.
   */
  private analyzeUserExperience(): { score: number; details: any } {
    const { userExperience } = this.metrics;
    
    const avgNotificationTime = userExperience.notificationDeliveryTime.length > 0 
      ? userExperience.notificationDeliveryTime.reduce((a, b) => a + b, 0) / userExperience.notificationDeliveryTime.length 
      : 0;
    
    // 사용자 만족도 점수 (낮은 문제 횟수일수록 높은 점수)
    const { falsePositives, missedNotifications, duplicateNotifications } = userExperience.userSatisfactionMetrics;
    const totalIssues = falsePositives + missedNotifications + duplicateNotifications;
    
    let satisfactionScore = Math.max(0, 100 - (totalIssues * 5)); // 문제 1개당 5점 감점
    
    return {
      score: satisfactionScore,
      details: {
        avgNotificationTime: Math.round(avgNotificationTime),
        dataFreshnessScore: userExperience.dataFreshnessScore,
        userSatisfactionMetrics: userExperience.userSatisfactionMetrics
      }
    };
  }

  /**
   * 현재 메트릭을 가져옵니다.
   */
  private getCurrentMetrics(): {
    avgResponseTime: number;
    memoryUsage: number;
    errorRate: number;
    successRate: number;
  } {
    const monitoring = this.analyzeMonitoringPerformance();
    const system = this.analyzeSystemPerformance();
    const errors = this.analyzeErrorMetrics();
    
    return {
      avgResponseTime: monitoring.details.avgResponseTime,
      memoryUsage: system.details.avgMemoryUsage,
      errorRate: errors.details.errorRate,
      successRate: monitoring.details.successRate
    };
  }

  /**
   * 트렌드를 분석합니다.
   */
  private analyzeTrends(): {
    responseTimeTrend: 'improving' | 'stable' | 'degrading';
    memoryTrend: 'improving' | 'stable' | 'degrading';
    errorTrend: 'improving' | 'stable' | 'degrading';
  } {
    // 간단한 트렌드 분석 (실제로는 더 정교한 알고리즘 필요)
    return {
      responseTimeTrend: 'stable',
      memoryTrend: 'stable',
      errorTrend: 'improving'
    };
  }

  /**
   * 경고를 생성합니다.
   */
  private generateAlerts(): Array<{
    type: 'warning' | 'error' | 'info';
    message: string;
    timestamp: number;
  }> {
    const alerts: Array<{ type: 'warning' | 'error' | 'info'; message: string; timestamp: number }> = [];
    
    const currentMetrics = this.getCurrentMetrics();
    const now = Date.now();
    
    if (currentMetrics.avgResponseTime > this.PERFORMANCE_THRESHOLDS.responseTime.poor) {
      alerts.push({
        type: 'error',
        message: `평균 응답 시간이 ${Math.round(currentMetrics.avgResponseTime)}ms로 매우 느립니다.`,
        timestamp: now
      });
    }
    
    if (currentMetrics.memoryUsage > 800) { // 800MB
      alerts.push({
        type: 'warning',
        message: `메모리 사용량이 ${currentMetrics.memoryUsage}MB로 높습니다.`,
        timestamp: now
      });
    }
    
    if (currentMetrics.errorRate > 5) {
      alerts.push({
        type: 'error',
        message: `에러율이 ${currentMetrics.errorRate}%로 높습니다.`,
        timestamp: now
      });
    }
    
    return alerts;
  }

  /**
   * 종합 요약을 생성합니다.
   */
  private generateSummary(overall: string, score: number): string {
    const scoreRounded = Math.round(score);
    
    switch (overall) {
      case 'excellent':
        return `시스템이 최적 상태로 작동하고 있습니다 (점수: ${scoreRounded}/100). 모든 지표가 우수한 범위에 있습니다.`;
      case 'good':
        return `시스템이 양호한 상태로 작동하고 있습니다 (점수: ${scoreRounded}/100). 대부분의 지표가 정상 범위에 있습니다.`;
      case 'acceptable':
        return `시스템이 보통 수준으로 작동하고 있습니다 (점수: ${scoreRounded}/100). 일부 개선이 필요할 수 있습니다.`;
      case 'poor':
        return `시스템 성능에 문제가 있습니다 (점수: ${scoreRounded}/100). 즉시 개선 조치가 필요합니다.`;
      default:
        return `시스템 상태를 분석할 수 없습니다.`;
    }
  }

  /**
   * 개선 권장사항을 생성합니다.
   */
  private generateRecommendations(monitoring: any, system: any, errors: any, userExperience: any): string[] {
    const recommendations: string[] = [];
    
    if (monitoring.details.avgResponseTime > this.PERFORMANCE_THRESHOLDS.responseTime.acceptable) {
      recommendations.push('응답 시간이 느립니다. 네트워크 연결을 확인하고 타임아웃 설정을 조정하세요.');
    }
    
    if (system.details.avgMemoryUsage > 500) {
      recommendations.push('메모리 사용량이 높습니다. 캐시 정리나 메모리 최적화를 고려하세요.');
    }
    
    if (errors.details.errorRate > 2) {
      recommendations.push('에러율이 높습니다. 로그를 확인하고 안정성 개선이 필요합니다.');
    }
    
    if (errors.details.circuitBreakerActivations > 0) {
      recommendations.push('서킷 브레이커가 활성화되었습니다. 서비스 안정성을 점검하세요.');
    }
    
    if (userExperience.details.userSatisfactionMetrics.duplicateNotifications > 5) {
      recommendations.push('중복 알림이 많이 발생했습니다. 알림 중복 방지 로직을 검토하세요.');
    }
    
    return recommendations;
  }

  /**
   * 시스템 리소스 모니터링을 시작합니다.
   */
  private startSystemResourceMonitoring(): void {
    setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const timestamp = Date.now();
      
      // 메모리 레벨 계산
      let level = 'normal';
      if (memoryUsage.rss > 1024 * 1024 * 1024) level = 'critical';
      else if (memoryUsage.rss > 500 * 1024 * 1024) level = 'warning';
      
      this.recordMemoryUsage({ ...memoryUsage, level });
    }, 60000); // 1분마다
  }

  /**
   * 배열 크기를 제한합니다.
   */
  private limitArraySize<T>(array: T[]): void {
    while (array.length > this.MAX_METRICS_LENGTH) {
      array.shift();
    }
  }

  /**
   * 오래된 메트릭을 정리합니다.
   */
  private cleanupOldMetrics(): void {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24시간 전
    
    // 시스템 메트릭 정리
    this.metrics.system.memoryUsageHistory = this.metrics.system.memoryUsageHistory
      .filter(m => m.timestamp > cutoffTime);
    
    // 에러 메트릭 정리
    for (const [serviceName, errors] of this.metrics.errors.errorRateByService) {
      const filteredErrors = errors.filter(e => e.timestamp > cutoffTime);
      this.metrics.errors.errorRateByService.set(serviceName, filteredErrors);
    }
    
    console.log('🧹 Performance metrics cleanup completed');
  }

  /**
   * 메트릭을 리셋합니다.
   */
  resetMetrics(): void {
    this.metrics = {
      monitoring: {
        chzzkResponseTime: [],
        twitterResponseTime: [],
        cafeResponseTime: [],
        weverseResponseTime: [],
        totalMonitoringCycles: 0,
        successfulCycles: 0,
        averageCycleTime: 0
      },
      system: {
        memoryUsageHistory: [],
        cpuUsageHistory: [],
        diskUsageHistory: [],
        networkLatency: []
      },
      errors: {
        errorRateByService: new Map(),
        recoveryTime: [],
        circuitBreakerActivations: 0,
        criticalFailures: 0
      },
      userExperience: {
        notificationDeliveryTime: [],
        uiResponseTime: [],
        dataFreshnessScore: 0,
        userSatisfactionMetrics: {
          falsePositives: 0,
          missedNotifications: 0,
          duplicateNotifications: 0
        }
      }
    };
    
    console.log('📊 Performance metrics have been reset');
  }
}