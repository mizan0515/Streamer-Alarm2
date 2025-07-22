import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { Cookie } from 'playwright';
import { sessionLogger } from './CategoryLogger';

export interface SessionData {
  cookies: Cookie[];
  timestamp: number;
  expiresAt: number;
  userAgent?: string;
  sessionId: string;
}

export interface SessionValidationResult {
  isValid: boolean;
  reason?: string;
  cookieCount: number;
  criticalCookies: number;
}

/**
 * 세션 관리 클래스 - 브라우저 쿠키의 암호화된 영속성 저장을 담당
 */
export class SessionManager {
  private readonly sessionDir: string;
  private readonly encryptionKey: string;
  private readonly algorithm = 'aes-256-gcm';
  
  // 중요한 쿠키 패턴들
  private readonly criticalCookiePatterns = [
    /^we2?_access_token$/i,
    /^we2?_refresh_token$/i,
    /^access_token$/i,
    /^refresh_token$/i,
    /^weverse_session$/i,
    /^session_id$/i,
    /^auth_token$/i,
    /^JSESSIONID$/i
  ];

  constructor(serviceName: string) {
    const userDataPath = app.getPath('userData');
    this.sessionDir = path.join(userDataPath, 'sessions');
    this.encryptionKey = this.generateEncryptionKey(serviceName);
    
    this.ensureSessionDirectory();
  }

  /**
   * 세션 디렉토리 생성
   */
  private async ensureSessionDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
    } catch (error) {
      console.error('❌ [SessionManager] Failed to create session directory:', error);
    }
  }

  /**
   * 서비스별 암호화 키 생성
   */
  private generateEncryptionKey(serviceName: string): string {
    const machineId = process.env.COMPUTERNAME || process.env.HOSTNAME || 'default-machine';
    const baseKey = `${serviceName}-${machineId}-${app.getVersion()}`;
    return crypto.createHash('sha256').update(baseKey).digest('hex').substring(0, 32);
  }

  /**
   * 데이터 암호화
   */
  private encrypt(data: string): { encrypted: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.encryptionKey);
    cipher.setAAD(Buffer.from('weverse-session'));
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag().toString('hex');
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      tag
    };
  }

  /**
   * 데이터 복호화
   */
  private decrypt(encryptedData: { encrypted: string; iv: string; tag: string }): string {
    try {
      const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey);
      decipher.setAAD(Buffer.from('weverse-session'));
      decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error('Failed to decrypt session data');
    }
  }

  /**
   * 쿠키를 파일에 저장
   */
  async saveCookiesToFile(serviceName: string, cookies: Cookie[], userAgent?: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      sessionLogger.info('세션 저장 시작', { 
        serviceName, 
        cookieCount: cookies.length,
        userAgent 
      });
      console.log(`💾 [SessionManager] Saving ${cookies.length} cookies for ${serviceName}`);
      
      // 쿠키 상세 분석
      const cookieAnalysis = {
        total: cookies.length,
        byDomain: {} as Record<string, number>,
        critical: 0,
        withExpiry: 0,
        sessionCookies: 0,
        sizes: cookies.map(c => JSON.stringify(c).length)
      };
      
      cookies.forEach(cookie => {
        // 도메인별 개수
        cookieAnalysis.byDomain[cookie.domain] = (cookieAnalysis.byDomain[cookie.domain] || 0) + 1;
        
        // 중요 쿠키 개수
        if (this.criticalCookiePatterns.some(pattern => pattern.test(cookie.name))) {
          cookieAnalysis.critical++;
        }
        
        // 만료 시간 정보
        if (cookie.expires && cookie.expires > 0) {
          cookieAnalysis.withExpiry++;
        } else {
          cookieAnalysis.sessionCookies++;
        }
      });
      
      sessionLogger.debug('쿠키 분석 결과', {
        serviceName,
        analysis: cookieAnalysis,
        avgSize: Math.round(cookieAnalysis.sizes.reduce((a, b) => a + b, 0) / cookieAnalysis.sizes.length),
        maxSize: Math.max(...cookieAnalysis.sizes)
      });
      
      const sessionData: SessionData = {
        cookies,
        timestamp: Date.now(),
        expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7일 후 만료
        userAgent,
        sessionId: crypto.randomUUID()
      };

      // JSON 직렬화
      const jsonData = JSON.stringify(sessionData);
      const jsonSize = Buffer.byteLength(jsonData, 'utf8');
      sessionLogger.debug('JSON 직렬화 완료', { 
        serviceName, 
        jsonSize: `${(jsonSize / 1024).toFixed(2)}KB` 
      });
      
      // 암호화 처리
      const encryptionStart = Date.now();
      const encrypted = this.encrypt(jsonData);
      const encryptionDuration = Date.now() - encryptionStart;
      
      sessionLogger.debug('암호화 완료', { 
        serviceName, 
        encryptionDuration: `${encryptionDuration}ms`,
        encryptedSize: `${(Buffer.byteLength(JSON.stringify(encrypted), 'utf8') / 1024).toFixed(2)}KB`
      });
      
      // 파일 저장
      const sessionFile = path.join(this.sessionDir, `${serviceName}_session.enc`);
      const writeStart = Date.now();
      await fs.writeFile(sessionFile, JSON.stringify(encrypted), 'utf8');
      const writeDuration = Date.now() - writeStart;
      
      const totalDuration = Date.now() - startTime;
      
      sessionLogger.info('세션 저장 완료', {
        serviceName,
        sessionFile,
        cookieCount: cookies.length,
        criticalCookies: cookieAnalysis.critical,
        totalDuration: `${totalDuration}ms`,
        writeDuration: `${writeDuration}ms`,
        finalFileSize: `${((await fs.stat(sessionFile)).size / 1024).toFixed(2)}KB`
      });
      
      console.log(`✅ [SessionManager] Session saved successfully: ${sessionFile}`);
      
      // 통계 로그
      const criticalCount = this.getCriticalCookieCount(cookies);
      console.log(`📊 [SessionManager] Cookie stats: ${cookies.length} total, ${criticalCount} critical`);
      
    } catch (error) {
      console.error('❌ [SessionManager] Failed to save cookies:', error);
      throw error;
    }
  }

  /**
   * 파일에서 쿠키 로드
   */
  async loadCookiesFromFile(serviceName: string): Promise<Cookie[]> {
    const startTime = Date.now();
    
    try {
      sessionLogger.info('세션 복원 시도 시작', { serviceName });
      const sessionFile = path.join(this.sessionDir, `${serviceName}_session.enc`);
      
      // 파일 존재 여부 확인
      try {
        const fileStats = await fs.stat(sessionFile);
        sessionLogger.debug('세션 파일 발견', {
          serviceName,
          sessionFile,
          fileSize: `${(fileStats.size / 1024).toFixed(2)}KB`,
          lastModified: fileStats.mtime.toISOString()
        });
      } catch (accessError) {
        sessionLogger.warn('세션 파일 없음', { serviceName, sessionFile });
        console.log(`📭 [SessionManager] No saved session found for ${serviceName}`);
        return [];
      }

      // 파일 읽기
      const readStart = Date.now();
      const encryptedContent = await fs.readFile(sessionFile, 'utf8');
      const readDuration = Date.now() - readStart;
      
      sessionLogger.debug('세션 파일 읽기 완료', {
        serviceName,
        readDuration: `${readDuration}ms`,
        contentSize: `${(Buffer.byteLength(encryptedContent, 'utf8') / 1024).toFixed(2)}KB`
      });

      // JSON 파싱
      const parseStart = Date.now();
      const encryptedData = JSON.parse(encryptedContent);
      const parseDuration = Date.now() - parseStart;
      
      // 복호화
      const decryptStart = Date.now();
      const decryptedJson = this.decrypt(encryptedData);
      const decryptDuration = Date.now() - decryptStart;
      
      sessionLogger.debug('복호화 완료', {
        serviceName,
        parseDuration: `${parseDuration}ms`,
        decryptDuration: `${decryptDuration}ms`
      });
      
      const sessionData: SessionData = JSON.parse(decryptedJson);
      
      // 세션 메타데이터 분석
      const sessionAge = Date.now() - sessionData.timestamp;
      const timeToExpiry = sessionData.expiresAt - Date.now();
      
      sessionLogger.debug('세션 메타데이터', {
        serviceName,
        sessionId: sessionData.sessionId,
        sessionAge: `${Math.round(sessionAge / (1000 * 60))}분`,
        timeToExpiry: `${Math.round(timeToExpiry / (1000 * 60))}분`,
        userAgent: sessionData.userAgent
      });

      // 만료 시간 체크
      if (Date.now() > sessionData.expiresAt) {
        sessionLogger.warn('세션 만료됨, 파일 제거', {
          serviceName,
          expiredSince: `${Math.round(-timeToExpiry / (1000 * 60))}분 전`
        });
        console.log(`⏰ [SessionManager] Session expired for ${serviceName}, removing file`);
        await this.clearSessionFile(serviceName);
        return [];
      }

      // 쿠키 유효성 검사 전 로깅
      const filterStart = Date.now();
      sessionLogger.debug('쿠키 유효성 검사 시작', {
        serviceName,
        totalCookies: sessionData.cookies.length,
        cookiesByDomain: sessionData.cookies.reduce((acc, cookie) => {
          acc[cookie.domain] = (acc[cookie.domain] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      });
      
      const validCookies = this.filterValidCookies(sessionData.cookies);
      const filterDuration = Date.now() - filterStart;
      
      // 제거된 쿠키 분석
      const removedCookies = sessionData.cookies.length - validCookies.length;
      const removedDetails = sessionData.cookies.filter(cookie => {
        // 제거된 쿠키들의 제거 이유 분석
        if (cookie.expires && cookie.expires > 0) {
          const expiryDate = new Date(cookie.expires * 1000);
          if (expiryDate <= new Date()) {
            return true; // 만료된 쿠키
          }
        }
        return !cookie.name || !cookie.value || !cookie.domain; // 필수 필드 누락
      }).map(cookie => ({
        name: cookie.name,
        domain: cookie.domain,
        expired: cookie.expires && cookie.expires > 0 ? new Date(cookie.expires * 1000) <= new Date() : false,
        missingFields: !cookie.name || !cookie.value || !cookie.domain
      }));
      
      // 중요 쿠키 분석
      const criticalCookiesFound = validCookies.filter(cookie => 
        this.criticalCookiePatterns.some(pattern => pattern.test(cookie.name))
      );
      
      sessionLogger.info('쿠키 유효성 검사 완료', {
        serviceName,
        validCookies: validCookies.length,
        removedCookies,
        criticalCookies: criticalCookiesFound.length,
        criticalCookieNames: criticalCookiesFound.map(c => c.name),
        filterDuration: `${filterDuration}ms`,
        removedDetails: removedDetails.length > 0 ? removedDetails : undefined
      });
      
      const totalDuration = Date.now() - startTime;
      
      sessionLogger.info('세션 복원 완료', {
        serviceName,
        validCookies: validCookies.length,
        totalCookies: sessionData.cookies.length,
        criticalCookies: criticalCookiesFound.length,
        sessionAge: Math.round((Date.now() - sessionData.timestamp) / (1000 * 60 * 60)),
        totalDuration: `${totalDuration}ms`,
        success: true
      });
      
      console.log(`🔄 [SessionManager] Loaded ${validCookies.length}/${sessionData.cookies.length} valid cookies for ${serviceName}`);
      console.log(`📊 [SessionManager] Session age: ${Math.round((Date.now() - sessionData.timestamp) / (1000 * 60 * 60))} hours`);
      
      return validCookies;
      
    } catch (error) {
      const errorDuration = Date.now() - startTime;
      
      sessionLogger.error('세션 복원 실패', {
        serviceName,
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : String(error),
        duration: `${errorDuration}ms`,
        step: 'loadCookiesFromFile'
      });
      
      console.error(`❌ [SessionManager] Failed to load cookies for ${serviceName}:`, error);
      
      // 손상된 세션 파일 제거
      sessionLogger.info('손상된 세션 파일 제거 시작', { serviceName });
      await this.clearSessionFile(serviceName);
      sessionLogger.info('손상된 세션 파일 제거 완료', { serviceName });
      
      return [];
    }
  }

  /**
   * 세션 유효성 검증
   */
  async validateSession(serviceName: string): Promise<SessionValidationResult> {
    try {
      const cookies = await this.loadCookiesFromFile(serviceName);
      const criticalCookies = this.getCriticalCookieCount(cookies);
      
      const isValid = cookies.length > 0 && criticalCookies >= 1;
      
      return {
        isValid,
        reason: isValid ? undefined : 'No critical cookies found',
        cookieCount: cookies.length,
        criticalCookies
      };
      
    } catch (error: any) {
      return {
        isValid: false,
        reason: `Validation error: ${error?.message || 'Unknown error'}`,
        cookieCount: 0,
        criticalCookies: 0
      };
    }
  }

  /**
   * 세션 파일 삭제
   */
  async clearSessionFile(serviceName: string): Promise<void> {
    try {
      const sessionFile = path.join(this.sessionDir, `${serviceName}_session.enc`);
      await fs.unlink(sessionFile);
      console.log(`🗑️ [SessionManager] Cleared session file for ${serviceName}`);
    } catch (error: any) {
      // 파일이 없는 경우는 정상적인 상황
      if (error?.code !== 'ENOENT') {
        console.error(`❌ [SessionManager] Failed to clear session file:`, error);
      }
    }
  }

  /**
   * 유효한 쿠키만 필터링
   */
  private filterValidCookies(cookies: Cookie[]): Cookie[] {
    const now = new Date();
    
    return cookies.filter(cookie => {
      // 만료 시간 체크 (세션 쿠키는 만료 시간이 없으므로 유효한 것으로 처리)
      if (cookie.expires && cookie.expires > 0) {
        const expiryDate = new Date(cookie.expires * 1000);
        if (expiryDate <= now) {
          return false; // 만료된 쿠키
        }
      }
      
      // 필수 필드 체크
      return cookie.name && cookie.value && cookie.domain;
    });
  }

  /**
   * 중요한 쿠키 개수 계산
   */
  private getCriticalCookieCount(cookies: Cookie[]): number {
    return cookies.filter(cookie => 
      this.criticalCookiePatterns.some(pattern => pattern.test(cookie.name))
    ).length;
  }

  /**
   * 세션 통계 조회
   */
  async getSessionStats(serviceName: string): Promise<{
    hasSession: boolean;
    cookieCount: number;
    criticalCookies: number;
    sessionAge?: number;
    expiresIn?: number;
  }> {
    try {
      const sessionFile = path.join(this.sessionDir, `${serviceName}_session.enc`);
      
      try {
        await fs.access(sessionFile);
      } catch {
        return { hasSession: false, cookieCount: 0, criticalCookies: 0 };
      }

      const cookies = await this.loadCookiesFromFile(serviceName);
      const criticalCookies = this.getCriticalCookieCount(cookies);
      
      // 세션 파일의 메타데이터 읽기
      const encryptedContent = await fs.readFile(sessionFile, 'utf8');
      const encryptedData = JSON.parse(encryptedContent);
      const decryptedJson = this.decrypt(encryptedData);
      const sessionData: SessionData = JSON.parse(decryptedJson);
      
      return {
        hasSession: true,
        cookieCount: cookies.length,
        criticalCookies,
        sessionAge: Math.round((Date.now() - sessionData.timestamp) / (1000 * 60)),
        expiresIn: Math.round((sessionData.expiresAt - Date.now()) / (1000 * 60))
      };
      
    } catch (error) {
      return { hasSession: false, cookieCount: 0, criticalCookies: 0 };
    }
  }

  /**
   * 모든 세션 정리 (개발/디버깅용)
   */
  async clearAllSessions(): Promise<void> {
    try {
      const files = await fs.readdir(this.sessionDir);
      const sessionFiles = files.filter(file => file.endsWith('_session.enc'));
      
      for (const file of sessionFiles) {
        await fs.unlink(path.join(this.sessionDir, file));
      }
      
      console.log(`🗑️ [SessionManager] Cleared ${sessionFiles.length} session files`);
      
    } catch (error) {
      console.error('❌ [SessionManager] Failed to clear all sessions:', error);
    }
  }
}