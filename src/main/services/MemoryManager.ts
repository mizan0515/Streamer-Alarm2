/**
 * 메모리 관리 유틸리티 클래스
 * LRU 캐시와 자동 정리 기능을 제공합니다.
 */
export class LRUCache<K, V> {
  private cache = new Map<K, { value: V; lastAccessed: number }>();
  private maxSize: number;
  private maxAge: number; // 밀리초

  constructor(maxSize: number = 1000, maxAge: number = 30 * 60 * 1000) { // 기본 30분
    this.maxSize = maxSize;
    this.maxAge = maxAge;
  }

  set(key: K, value: V): void {
    const now = Date.now();
    
    // 기존 항목이 있다면 제거
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    
    // 새 항목 추가
    this.cache.set(key, { value, lastAccessed: now });
    
    // 크기 제한 확인
    if (this.cache.size > this.maxSize) {
      this.evictOldest();
    }
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    const now = Date.now();
    
    // 만료 확인
    if (now - entry.lastAccessed > this.maxAge) {
      this.cache.delete(key);
      return undefined;
    }

    // 접근 시간 업데이트 (LRU)
    entry.lastAccessed = now;
    
    // Map에서 제거 후 다시 추가 (순서 업데이트)
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  /**
   * 만료된 항목들을 정리합니다.
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.lastAccessed > this.maxAge) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    console.log(`🧹 LRU Cache cleaned: ${cleaned} expired entries removed`);
    return cleaned;
  }

  /**
   * 가장 오래된 항목을 제거합니다.
   */
  private evictOldest(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
    }
  }

  /**
   * 캐시 통계를 반환합니다.
   */
  getStats(): { size: number; maxSize: number; maxAge: number; oldestEntryAge: number } {
    const now = Date.now();
    let oldestAge = 0;

    for (const entry of this.cache.values()) {
      const age = now - entry.lastAccessed;
      if (age > oldestAge) {
        oldestAge = age;
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      maxAge: this.maxAge,
      oldestEntryAge: oldestAge
    };
  }
}

/**
 * 메모리 사용량 모니터링 클래스
 */
export class MemoryMonitor {
  private static instance: MemoryMonitor;
  private memoryThresholds = {
    warning: 512 * 1024 * 1024,  // 512MB
    critical: 1024 * 1024 * 1024, // 1GB
    emergency: 1536 * 1024 * 1024 // 1.5GB
  };
  
  private monitoringInterval: NodeJS.Timeout | null = null;
  private callbacks: Array<(usage: NodeJS.MemoryUsage, level: 'normal' | 'warning' | 'critical' | 'emergency') => void> = [];

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  startMonitoring(intervalMs: number = 30000): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, intervalMs);

    console.log(`🔍 Memory monitoring started (interval: ${intervalMs}ms)`);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  onMemoryAlert(callback: (usage: NodeJS.MemoryUsage, level: 'normal' | 'warning' | 'critical' | 'emergency') => void): void {
    this.callbacks.push(callback);
  }

  private checkMemoryUsage(): void {
    const usage = process.memoryUsage();
    const rss = usage.rss;

    let level: 'normal' | 'warning' | 'critical' | 'emergency' = 'normal';

    if (rss > this.memoryThresholds.emergency) {
      level = 'emergency';
    } else if (rss > this.memoryThresholds.critical) {
      level = 'critical';
    } else if (rss > this.memoryThresholds.warning) {
      level = 'warning';
    }

    if (level !== 'normal') {
      console.warn(`⚠️ Memory usage ${level}: ${Math.round(rss / 1024 / 1024)}MB`);
      
      // 콜백 실행
      this.callbacks.forEach(callback => {
        try {
          callback(usage, level);
        } catch (error) {
          console.error('Memory alert callback failed:', error);
        }
      });
    }
  }

  /**
   * 강제 가비지 컬렉션을 시도합니다.
   */
  forceGarbageCollection(): void {
    if (global.gc) {
      console.log('🗑️ Forcing garbage collection...');
      global.gc();
      
      const afterGC = process.memoryUsage();
      console.log(`🗑️ GC completed. Memory usage: ${Math.round(afterGC.rss / 1024 / 1024)}MB`);
    } else {
      console.warn('⚠️ Garbage collection not available (run with --expose-gc)');
    }
  }

  getCurrentUsage(): NodeJS.MemoryUsage & { level: string } {
    const usage = process.memoryUsage();
    const rss = usage.rss;

    let level = 'normal';
    if (rss > this.memoryThresholds.emergency) {
      level = 'emergency';
    } else if (rss > this.memoryThresholds.critical) {
      level = 'critical';
    } else if (rss > this.memoryThresholds.warning) {
      level = 'warning';
    }

    return { ...usage, level };
  }
}

/**
 * 자동 정리 스케줄러
 */
export class CleanupScheduler {
  private static instance: CleanupScheduler;
  private cleanupTasks: Array<{ name: string; task: () => Promise<void> | void; interval: number; lastRun: number }> = [];
  private schedulerInterval: NodeJS.Timeout | null = null;

  static getInstance(): CleanupScheduler {
    if (!CleanupScheduler.instance) {
      CleanupScheduler.instance = new CleanupScheduler();
    }
    return CleanupScheduler.instance;
  }

  addTask(name: string, task: () => Promise<void> | void, intervalMs: number): void {
    this.cleanupTasks.push({
      name,
      task,
      interval: intervalMs,
      lastRun: 0
    });

    console.log(`🔧 Cleanup task registered: ${name} (interval: ${intervalMs}ms)`);
  }

  start(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
    }

    this.schedulerInterval = setInterval(() => {
      this.runDueTasks();
    }, 60000); // 1분마다 체크

    console.log('🔧 Cleanup scheduler started');
  }

  stop(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  private async runDueTasks(): Promise<void> {
    const now = Date.now();

    for (const taskInfo of this.cleanupTasks) {
      if (now - taskInfo.lastRun >= taskInfo.interval) {
        try {
          console.log(`🧹 Running cleanup task: ${taskInfo.name}`);
          await taskInfo.task();
          taskInfo.lastRun = now;
        } catch (error) {
          console.error(`❌ Cleanup task failed: ${taskInfo.name}`, error);
        }
      }
    }
  }

  /**
   * 모든 정리 작업을 즉시 실행합니다.
   */
  async runAllTasks(): Promise<void> {
    const now = Date.now();
    console.log('🧹 Running all cleanup tasks immediately...');

    for (const taskInfo of this.cleanupTasks) {
      try {
        console.log(`🧹 Running cleanup task: ${taskInfo.name}`);
        await taskInfo.task();
        taskInfo.lastRun = now;
      } catch (error) {
        console.error(`❌ Cleanup task failed: ${taskInfo.name}`, error);
      }
    }

    console.log('✅ All cleanup tasks completed');
  }
}