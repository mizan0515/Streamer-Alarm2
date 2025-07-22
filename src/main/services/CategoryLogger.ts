import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

export enum LogCategory {
  WEVERSE = 'weverse',
  DATABASE = 'database',
  NOTIFICATION = 'notification',
  SESSION = 'session',
  GENERAL = 'general',
  MONITORING = 'monitoring',
  CHZZK = 'chzzk',
  CAFE = 'cafe',
  TWITTER = 'twitter'
}

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn', 
  INFO = 'info',
  DEBUG = 'debug'
}

/**
 * 카테고리별 로깅 시스템
 */
export class CategoryLogger {
  private static instance: CategoryLogger;
  private loggers = new Map<LogCategory, winston.Logger>();
  private logDir: string;
  private isInitialized: boolean = false;

  private constructor() {
    const userDataPath = app.getPath('userData');
    this.logDir = path.join(userDataPath, 'logs');
    this.initializeLogDirectory();
  }

  public static getInstance(): CategoryLogger {
    if (!CategoryLogger.instance) {
      CategoryLogger.instance = new CategoryLogger();
    }
    return CategoryLogger.instance;
  }

  /**
   * 로그 디렉토리 초기화
   */
  private initializeLogDirectory(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      this.isInitialized = true;
    } catch (error) {
      console.error('❌ Failed to create log directory:', error);
    }
  }

  /**
   * 카테고리별 로거 생성
   */
  private createLogger(category: LogCategory): winston.Logger {
    const logFile = path.join(this.logDir, `${category}.log`);
    
    const logger = winston.createLogger({
      level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss.SSS'
        }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }: any) => {
          const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          const stackString = stack ? `\n${stack}` : '';
          return `${timestamp} [${level.toUpperCase()}] [${category.toUpperCase()}] ${message}${metaString}${stackString}`;
        })
      ),
      transports: [
        // 파일 로그 (회전식)
        new winston.transports.File({
          filename: logFile,
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
          tailable: true,
          zippedArchive: true
        }),
        // 콘솔 로그 (개발 모드에서만)
        ...(process.env.NODE_ENV === 'development' ? [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.printf(({ timestamp, level, message, ...meta }: any) => {
                const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                return `${timestamp} [${level}] [${category.toUpperCase()}] ${message}${metaString}`;
              })
            )
          })
        ] : [])
      ]
    });

    return logger;
  }

  /**
   * 카테고리별 로거 가져오기
   */
  public getLogger(category: LogCategory): winston.Logger {
    if (!this.isInitialized) {
      console.warn('⚠️ CategoryLogger not properly initialized, falling back to console');
      return this.createFallbackLogger(category);
    }

    if (!this.loggers.has(category)) {
      this.loggers.set(category, this.createLogger(category));
    }
    
    return this.loggers.get(category)!;
  }

  /**
   * 폴백 로거 생성 (초기화 실패 시)
   */
  private createFallbackLogger(category: LogCategory): winston.Logger {
    return winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }: any) => {
          return `${timestamp} [${level.toUpperCase()}] [${category.toUpperCase()}] ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console()
      ]
    });
  }

  /**
   * 편의 메서드들
   */
  public error(category: LogCategory, message: string, meta?: any): void {
    this.getLogger(category).error(message, meta);
  }

  public warn(category: LogCategory, message: string, meta?: any): void {
    this.getLogger(category).warn(message, meta);
  }

  public info(category: LogCategory, message: string, meta?: any): void {
    this.getLogger(category).info(message, meta);
  }

  public debug(category: LogCategory, message: string, meta?: any): void {
    this.getLogger(category).debug(message, meta);
  }

  /**
   * 로그 파일 정리 (오래된 로그 삭제)
   */
  public async cleanupLogs(daysToKeep: number = 30): Promise<void> {
    try {
      if (!fs.existsSync(this.logDir)) return;

      const files = fs.readdirSync(this.logDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      for (const file of files) {
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Removed old log file: ${file}`);
        }
      }
    } catch (error) {
      console.error('❌ Failed to cleanup logs:', error);
    }
  }

  /**
   * 로그 통계 조회
   */
  public getLogStats(): { [key in LogCategory]?: { size: number; lastModified: Date } } {
    const stats: { [key in LogCategory]?: { size: number; lastModified: Date } } = {};

    try {
      if (!fs.existsSync(this.logDir)) return stats;

      for (const category of Object.values(LogCategory)) {
        const logFile = path.join(this.logDir, `${category}.log`);
        
        if (fs.existsSync(logFile)) {
          const fileStat = fs.statSync(logFile);
          stats[category] = {
            size: fileStat.size,
            lastModified: fileStat.mtime
          };
        }
      }
    } catch (error) {
      console.error('❌ Failed to get log stats:', error);
    }

    return stats;
  }

  /**
   * 로그 레벨 동적 변경
   */
  public setLogLevel(category: LogCategory, level: LogLevel): void {
    const logger = this.getLogger(category);
    logger.level = level;
    console.log(`📝 Log level for ${category} set to ${level}`);
  }

  /**
   * 모든 로거 종료
   */
  public async close(): Promise<void> {
    for (const logger of this.loggers.values()) {
      await new Promise<void>((resolve) => {
        logger.on('finish', resolve);
        logger.end();
      });
    }
    this.loggers.clear();
  }
}

/**
 * 전역 로거 인스턴스
 */
export const logger = CategoryLogger.getInstance();

/**
 * 카테고리별 로거 편의 함수들
 */
export const weverseLogger = {
  error: (message: string, meta?: any) => logger.error(LogCategory.WEVERSE, message, meta),
  warn: (message: string, meta?: any) => logger.warn(LogCategory.WEVERSE, message, meta),
  info: (message: string, meta?: any) => logger.info(LogCategory.WEVERSE, message, meta),
  debug: (message: string, meta?: any) => logger.debug(LogCategory.WEVERSE, message, meta)
};

export const databaseLogger = {
  error: (message: string, meta?: any) => logger.error(LogCategory.DATABASE, message, meta),
  warn: (message: string, meta?: any) => logger.warn(LogCategory.DATABASE, message, meta),
  info: (message: string, meta?: any) => logger.info(LogCategory.DATABASE, message, meta),
  debug: (message: string, meta?: any) => logger.debug(LogCategory.DATABASE, message, meta)
};

export const sessionLogger = {
  error: (message: string, meta?: any) => logger.error(LogCategory.SESSION, message, meta),
  warn: (message: string, meta?: any) => logger.warn(LogCategory.SESSION, message, meta),
  info: (message: string, meta?: any) => logger.info(LogCategory.SESSION, message, meta),
  debug: (message: string, meta?: any) => logger.debug(LogCategory.SESSION, message, meta)
};

export const notificationLogger = {
  error: (message: string, meta?: any) => logger.error(LogCategory.NOTIFICATION, message, meta),
  warn: (message: string, meta?: any) => logger.warn(LogCategory.NOTIFICATION, message, meta),
  info: (message: string, meta?: any) => logger.info(LogCategory.NOTIFICATION, message, meta),
  debug: (message: string, meta?: any) => logger.debug(LogCategory.NOTIFICATION, message, meta)
};

export const monitoringLogger = {
  error: (message: string, meta?: any) => logger.error(LogCategory.MONITORING, message, meta),
  warn: (message: string, meta?: any) => logger.warn(LogCategory.MONITORING, message, meta),
  info: (message: string, meta?: any) => logger.info(LogCategory.MONITORING, message, meta),
  debug: (message: string, meta?: any) => logger.debug(LogCategory.MONITORING, message, meta)
};