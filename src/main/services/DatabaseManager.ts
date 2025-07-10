import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';
import { 
  StreamerData, 
  NotificationSettings, 
  NotificationRecord, 
  AppSettings, 
  MonitoringStatus 
} from '@shared/types';

export class DatabaseManager {
  private db!: Database.Database;
  private dbPath: string;

  constructor() {
    // 데이터베이스 경로 설정 (userData 디렉토리)
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'streamer_alarm.db');
  }

  async initialize(): Promise<void> {
    try {
      // 사용자 데이터 디렉토리 확인 및 생성
      await this.ensureUserDataDirectory();
      
      // 데이터베이스 연결
      this.db = new Database(this.dbPath);
      
      // WAL 모드 활성화 (성능 향상)
      this.db.pragma('journal_mode = WAL');
      
      // 외래 키 제약 활성화
      this.db.pragma('foreign_keys = ON');
      
      // 테이블 생성
      this.createTables();
      
      // 데이터베이스 마이그레이션 (기존 DB 업그레이드)
      this.migrateDatabase();
      
      // 기본 데이터 삽입
      this.insertDefaultData();
      
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  private createTables(): void {
    // 스트리머 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streamers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        chzzk_id TEXT,
        twitter_username TEXT,
        naver_cafe_user_id TEXT,
        cafe_club_id TEXT DEFAULT '30919539',
        profile_image_url TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 알림 설정 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notification_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        streamer_id INTEGER NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('chzzk', 'cafe', 'twitter')),
        enabled BOOLEAN DEFAULT 1,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
        UNIQUE(streamer_id, platform)
      )
    `);

    // 알림 기록 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        streamer_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('live', 'cafe', 'twitter')),
        title TEXT NOT NULL,
        content TEXT,
        content_html TEXT,
        url TEXT,
        unique_key TEXT UNIQUE,
        profile_image_url TEXT,
        is_read BOOLEAN DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE
      )
    `);

    // 애플리케이션 설정 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 모니터링 상태 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS monitoring_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_check_time TIMESTAMP,
        is_monitoring BOOLEAN DEFAULT 1,
        last_recovery_time TIMESTAMP
      )
    `);

    // 모니터링 상태 세부 테이블 (스트리머별 마지막 상태 저장)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS monitor_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        streamer_id INTEGER NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('chzzk', 'cafe', 'twitter')),
        last_content_id TEXT,
        last_check_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_status TEXT,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
        UNIQUE(streamer_id, platform)
      )
    `);

    // 인덱스 생성
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
      CREATE INDEX IF NOT EXISTS idx_notifications_unique_key ON notifications(unique_key);
      CREATE INDEX IF NOT EXISTS idx_streamers_active ON streamers(is_active);
      CREATE INDEX IF NOT EXISTS idx_monitor_states_streamer_platform ON monitor_states(streamer_id, platform);
    `);

    // 업데이트 트리거 생성 (updated_at 자동 갱신)
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_streamers_timestamp 
      AFTER UPDATE ON streamers
      BEGIN
        UPDATE streamers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_settings_timestamp 
      AFTER UPDATE ON app_settings
      BEGIN
        UPDATE app_settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
      END;
    `);
  }

  private migrateDatabase(): void {
    try {
      console.log('🔄 Starting database migration...');
      
      // 테이블 스키마 확인
      const tableInfo = this.db.prepare("PRAGMA table_info(notifications)").all();
      console.log('📊 Current notifications table schema:', tableInfo);
      
      // 알림 테이블에 profile_image_url 컬럼 추가 (없는 경우)
      try {
        this.db.exec(`ALTER TABLE notifications ADD COLUMN profile_image_url TEXT`);
        console.log('✅ Added profile_image_url column to notifications table');
      } catch (error: any) {
        if (error.code === 'SQLITE_ERROR' && error.message.includes('duplicate column name')) {
          console.log('✅ profile_image_url column already exists');
        } else {
          console.warn('⚠️ Could not add profile_image_url column:', error.message);
        }
      }

      // 알림 테이블에 is_read 컬럼 추가 (없는 경우)
      try {
        this.db.exec(`ALTER TABLE notifications ADD COLUMN is_read BOOLEAN DEFAULT 0`);
        console.log('✅ Added is_read column to notifications table');
      } catch (error: any) {
        if (error.code === 'SQLITE_ERROR' && error.message.includes('duplicate column name')) {
          console.log('✅ is_read column already exists');
        } else {
          console.warn('⚠️ Could not add is_read column:', error.message);
        }
      }

      // 알림 테이블에 content_html 컬럼 추가 (없는 경우)
      try {
        this.db.exec(`ALTER TABLE notifications ADD COLUMN content_html TEXT`);
        console.log('✅ Added content_html column to notifications table');
      } catch (error: any) {
        if (error.code === 'SQLITE_ERROR' && error.message.includes('duplicate column name')) {
          console.log('✅ content_html column already exists');
        } else {
          console.warn('⚠️ Could not add content_html column:', error.message);
        }
      }
      
      // 마이그레이션 후 스키마 확인
      const finalTableInfo = this.db.prepare("PRAGMA table_info(notifications)").all();
      console.log('📊 Final notifications table schema:', finalTableInfo);
      
      // 샘플 데이터 확인
      const sampleData = this.db.prepare("SELECT * FROM notifications LIMIT 2").all();
      console.log('📋 Sample notification data:', sampleData);
      
    } catch (error) {
      console.error('❌ Database migration failed:', error);
    }
  }

  private insertDefaultData(): void {
    // 기본 설정 삽입
    const defaultSettings = [
      { key: 'checkInterval', value: '30' },
      { key: 'autoStart', value: 'false' },
      { key: 'minimizeToTray', value: 'true' },
      { key: 'showDesktopNotifications', value: 'true' },
      { key: 'cacheCleanupInterval', value: '3600' },
      { key: 'theme', value: 'dark' },
      { key: 'needNaverLogin', value: 'true' }
    ];

    const insertSetting = this.db.prepare(`
      INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)
    `);

    defaultSettings.forEach(setting => {
      insertSetting.run(setting.key, setting.value);
    });

    // 모니터링 상태 초기화
    this.db.prepare(`
      INSERT OR IGNORE INTO monitoring_status (id, is_monitoring) VALUES (1, 1)
    `).run();
  }

  // 스트리머 관련 메서드
  async getStreamers(): Promise<StreamerData[]> {
    const stmt = this.db.prepare(`
      SELECT s.*, 
             GROUP_CONCAT(ns.platform || ':' || ns.enabled) as notification_settings
      FROM streamers s
      LEFT JOIN notification_settings ns ON s.id = ns.streamer_id
      GROUP BY s.id
      ORDER BY s.name
    `);

    const rows = stmt.all() as any[];
    
    return rows.map(row => {
      const notifications: any = { chzzk: true, cafe: true, twitter: true };
      
      if (row.notification_settings) {
        row.notification_settings.split(',').forEach((setting: string) => {
          const [platform, enabled] = setting.split(':');
          notifications[platform] = enabled === '1';
        });
      }

      return {
        id: row.id,
        name: row.name,
        chzzkId: row.chzzk_id,
        twitterUsername: row.twitter_username,
        naverCafeUserId: row.naver_cafe_user_id,
        cafeClubId: row.cafe_club_id,
        profileImageUrl: row.profile_image_url,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        notifications
      };
    });
  }

  async addStreamer(streamerData: Omit<StreamerData, 'id' | 'createdAt' | 'updatedAt'>): Promise<StreamerData> {
    const insertStreamer = this.db.prepare(`
      INSERT INTO streamers (
        name, chzzk_id, twitter_username, naver_cafe_user_id, 
        cafe_club_id, profile_image_url, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertStreamer.run(
      streamerData.name,
      streamerData.chzzkId || null,
      streamerData.twitterUsername || null,
      streamerData.naverCafeUserId || null,
      streamerData.cafeClubId,
      streamerData.profileImageUrl || null,
      streamerData.isActive ? 1 : 0
    );

    const streamerId = result.lastInsertRowid as number;

    // 알림 설정 추가
    const insertNotificationSetting = this.db.prepare(`
      INSERT INTO notification_settings (streamer_id, platform, enabled) VALUES (?, ?, ?)
    `);

    if (streamerData.notifications) {
      Object.entries(streamerData.notifications).forEach(([platform, enabled]) => {
        insertNotificationSetting.run(streamerId, platform, enabled ? 1 : 0);
      });
    } else {
      // 기본값으로 모든 알림 활성화
      ['chzzk', 'cafe', 'twitter'].forEach(platform => {
        insertNotificationSetting.run(streamerId, platform, 1);
      });
    }

    // 추가된 스트리머 반환
    const streamers = await this.getStreamers();
    return streamers.find(s => s.id === streamerId)!;
  }

  async updateStreamer(streamerData: StreamerData): Promise<StreamerData> {
    const updateStreamer = this.db.prepare(`
      UPDATE streamers SET
        name = ?, chzzk_id = ?, twitter_username = ?, naver_cafe_user_id = ?,
        cafe_club_id = ?, profile_image_url = ?, is_active = ?
      WHERE id = ?
    `);

    updateStreamer.run(
      streamerData.name,
      streamerData.chzzkId || null,
      streamerData.twitterUsername || null,
      streamerData.naverCafeUserId || null,
      streamerData.cafeClubId,
      streamerData.profileImageUrl || null,
      streamerData.isActive ? 1 : 0,
      streamerData.id
    );

    // 알림 설정 업데이트
    if (streamerData.notifications) {
      const updateNotificationSetting = this.db.prepare(`
        INSERT OR REPLACE INTO notification_settings (streamer_id, platform, enabled) VALUES (?, ?, ?)
      `);

      Object.entries(streamerData.notifications).forEach(([platform, enabled]) => {
        updateNotificationSetting.run(streamerData.id, platform, enabled ? 1 : 0);
      });
    }

    // 업데이트된 스트리머 반환
    const streamers = await this.getStreamers();
    return streamers.find(s => s.id === streamerData.id)!;
  }

  async deleteStreamer(streamerId: number): Promise<boolean> {
    const deleteStreamer = this.db.prepare('DELETE FROM streamers WHERE id = ?');
    const result = deleteStreamer.run(streamerId);
    return result.changes > 0;
  }

  // 알림 관련 메서드
  async getNotifications(options: { limit?: number; type?: string; offset?: number } = {}): Promise<NotificationRecord[]> {
    let query = `
      SELECT n.id,
             n.streamer_id as streamerId,
             n.type,
             n.title,
             n.content,
             n.content_html as contentHtml,
             n.url,
             n.unique_key as uniqueKey,
             COALESCE(n.profile_image_url, s.profile_image_url) as profileImageUrl,
             COALESCE(n.is_read, 0) as isRead,
             n.created_at as createdAt,
             s.name as streamer_name
      FROM notifications n
      JOIN streamers s ON n.streamer_id = s.id
    `;

    const params: any[] = [];

    if (options.type && options.type !== 'all') {
      query += ' WHERE n.type = ?';
      params.push(options.type);
    }

    query += ' ORDER BY n.created_at DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
      
      if (options.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    const stmt = this.db.prepare(query);
    const results = stmt.all(...params) as any[];
    
    // 디버그 로깅
    console.log('📊 DatabaseManager.getNotifications results sample:', 
      results.slice(0, 2).map(r => ({
        id: r.id,
        profileImageUrl: r.profileImageUrl,
        isRead: r.isRead,
        createdAt: r.createdAt,
        type: r.type
      }))
    );
    
    return results.map(row => ({
      id: row.id,
      streamerId: row.streamerId,
      type: row.type,
      title: row.title,
      content: row.content,
      contentHtml: row.contentHtml,
      url: row.url,
      uniqueKey: row.uniqueKey,
      profileImageUrl: row.profileImageUrl,
      isRead: Boolean(row.isRead),
      createdAt: row.createdAt
    }));
  }

  async addNotification(notification: Omit<NotificationRecord, 'id' | 'createdAt'>, originalTimestamp?: Date): Promise<void> {
    // 원본 시간이 제공되면 사용, 아니면 현재 시간 사용
    const timestamp = originalTimestamp ? originalTimestamp.toISOString() : new Date().toISOString();
    
    const insertNotification = this.db.prepare(`
      INSERT OR IGNORE INTO notifications (
        streamer_id, type, title, content, content_html, url, unique_key, profile_image_url, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertNotification.run(
      notification.streamerId,
      notification.type,
      notification.title,
      notification.content || null,
      notification.contentHtml || null,
      notification.url,
      notification.uniqueKey,
      notification.profileImageUrl || null,
      notification.isRead ? 1 : 0,
      timestamp
    );

    // 오래된 알림 삭제 (최대 1000개 유지)
    this.db.prepare(`
      DELETE FROM notifications 
      WHERE id NOT IN (
        SELECT id FROM notifications 
        ORDER BY created_at DESC 
        LIMIT 1000
      )
    `).run();
  }

  async deleteAllNotifications(): Promise<void> {
    this.db.prepare('DELETE FROM notifications').run();
  }

  // 알림 읽음 처리
  async markNotificationAsRead(notificationId: number): Promise<void> {
    const stmt = this.db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?');
    stmt.run(notificationId);
  }

  async markAllNotificationsAsRead(): Promise<void> {
    const stmt = this.db.prepare('UPDATE notifications SET is_read = 1');
    stmt.run();
  }

  // 읽지않은 알림 수 조회
  async getUnreadNotificationCount(): Promise<number> {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  // 총 알림 수 조회 (페이지네이션용)
  async getTotalNotificationCount(options: { type?: string } = {}): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM notifications n';
    const params: any[] = [];

    if (options.type && options.type !== 'all') {
      query += ' WHERE n.type = ?';
      params.push(options.type);
    }

    const stmt = this.db.prepare(query);
    const result = stmt.get(...params) as { count: number };
    return result.count;
  }

  // 설정 관련 메서드
  async getSetting(key: string): Promise<string | null> {
    const stmt = this.db.prepare('SELECT value FROM app_settings WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value || null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)
    `);
    stmt.run(key, value);
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const stmt = this.db.prepare('SELECT key, value FROM app_settings');
    const rows = stmt.all() as { key: string; value: string }[];
    
    const settings: Record<string, string> = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    
    return settings;
  }

  // 마이그레이션 메서드
  async migrateStreamers(streamersData: Record<string, any>): Promise<void> {
    // 기존 스트리머가 있는지 확인
    const existingCount = this.db.prepare('SELECT COUNT(*) as count FROM streamers').get() as { count: number };
    
    if (existingCount.count > 0) {
      console.log('Streamers already exist, skipping migration');
      return;
    }

    const transaction = this.db.transaction(() => {
      Object.entries(streamersData).forEach(([name, data]: [string, any]) => {
        const insertStreamer = this.db.prepare(`
          INSERT INTO streamers (
            name, chzzk_id, twitter_username, naver_cafe_user_id, 
            cafe_club_id, profile_image_url, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const result = insertStreamer.run(
          name,
          data.chzzk_id || null,
          data.twitter_username || null,
          data.cafe_user_id || null,
          data.cafe_club_id || '30919539',
          data.profile_image || null,
          data.enabled !== false ? 1 : 0
        );

        const streamerId = result.lastInsertRowid as number;

        // 알림 설정 마이그레이션
        const notifications = data.notifications || { chzzk: true, cafe: true, twitter: true };
        Object.entries(notifications).forEach(([platform, enabled]: [string, any]) => {
          this.db.prepare(`
            INSERT INTO notification_settings (streamer_id, platform, enabled) VALUES (?, ?, ?)
          `).run(streamerId, platform, enabled ? 1 : 0);
        });
      });
    });

    transaction();
    console.log('Streamers migration completed');
  }

  async migrateNotifications(notificationsData: any[]): Promise<void> {
    if (!Array.isArray(notificationsData) || notificationsData.length === 0) {
      return;
    }

    const transaction = this.db.transaction(() => {
      notificationsData.forEach(notification => {
        // 스트리머 ID 찾기
        const streamerResult = this.db.prepare('SELECT id FROM streamers WHERE name = ?')
          .get(notification.streamer) as { id: number } | undefined;

        if (streamerResult) {
          this.db.prepare(`
            INSERT OR IGNORE INTO notifications (
              streamer_id, type, title, content, content_html, url, unique_key, profile_image_url, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            streamerResult.id,
            notification.type,
            notification.title,
            notification.content || null,
            notification.content_html || null,
            notification.url,
            notification.unique_key,
            notification.profile_image_url || null,
            notification.timestamp || new Date().toISOString()
          );
        }
      });
    });

    transaction();
    console.log('Notifications migration completed');
  }

  // 모니터링 상태 관리 메서드
  async getMonitorState(streamerId: number, platform: string): Promise<{
    lastContentId?: string;
    lastCheckTime?: string;
    lastStatus?: string;
  } | null> {
    const stmt = this.db.prepare(`
      SELECT last_content_id, last_check_time, last_status 
      FROM monitor_states 
      WHERE streamer_id = ? AND platform = ?
    `);
    
    const result = stmt.get(streamerId, platform) as any;
    
    if (!result) return null;
    
    return {
      lastContentId: result.last_content_id,
      lastCheckTime: result.last_check_time,
      lastStatus: result.last_status
    };
  }

  async setMonitorState(
    streamerId: number, 
    platform: string, 
    contentId?: string, 
    status?: string
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO monitor_states 
      (streamer_id, platform, last_content_id, last_check_time, last_status) 
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
    `);
    
    stmt.run(streamerId, platform, contentId || null, status || null);
  }

  async clearMonitorStates(): Promise<void> {
    this.db.prepare('DELETE FROM monitor_states').run();
    console.log('All monitor states cleared - fresh start for monitoring');
  }

  // 카페 모니터링 상태만 초기화
  async clearCafeMonitorStates(): Promise<void> {
    const result = this.db.prepare('DELETE FROM monitor_states WHERE platform = ?').run('cafe');
    console.log(`카페 모니터링 상태 ${result.changes}개 삭제 완료`);
  }

  async initializeMonitorStates(): Promise<void> {
    const streamers = await this.getStreamers();
    const platforms = ['chzzk', 'cafe', 'twitter'];
    
    const insertState = this.db.prepare(`
      INSERT OR IGNORE INTO monitor_states 
      (streamer_id, platform, last_check_time) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    
    streamers.forEach(streamer => {
      platforms.forEach(platform => {
        insertState.run(streamer.id, platform);
      });
    });
    
    console.log(`Initialized monitor states for ${streamers.length} streamers across ${platforms.length} platforms`);
  }

  // Silent baseline establishment for new streamers to prevent mass notifications
  async establishBaselineForStreamer(streamerId: number, platform: string, contentId: string): Promise<void> {
    const updateState = this.db.prepare(`
      UPDATE monitor_states 
      SET last_content_id = ?, last_check_time = CURRENT_TIMESTAMP, last_status = 'baseline'
      WHERE streamer_id = ? AND platform = ?
    `);
    
    updateState.run(contentId, streamerId, platform);
    console.log(`Established baseline for streamer ${streamerId} on ${platform}: ${contentId}`);
  }

  // Check if a streamer needs baseline establishment (has null last_content_id)
  async needsBaselineEstablishment(streamerId: number, platform: string): Promise<boolean> {
    const checkState = this.db.prepare(`
      SELECT last_content_id FROM monitor_states 
      WHERE streamer_id = ? AND platform = ?
    `);
    
    const result = checkState.get(streamerId, platform) as { last_content_id: string | null } | undefined;
    return !result || result.last_content_id === null;
  }

  // Get all streamers that need baseline establishment
  async getStreamersNeedingBaseline(): Promise<{ streamerId: number, platform: string, streamerName: string }[]> {
    const query = this.db.prepare(`
      SELECT s.id as streamerId, ms.platform, s.name as streamerName
      FROM streamers s
      JOIN monitor_states ms ON s.id = ms.streamer_id
      WHERE s.is_active = 1 AND ms.last_content_id IS NULL
    `);
    
    return query.all() as { streamerId: number, platform: string, streamerName: string }[];
  }

  // 사용자 데이터 디렉토리 확인 및 생성
  private async ensureUserDataDirectory(): Promise<void> {
    const fs = require('fs').promises;
    const userDataPath = app.getPath('userData');
    
    try {
      // 디렉토리 존재 여부 및 쓰기 권한 확인
      await fs.access(userDataPath, fs.constants.W_OK);
    } catch (error) {
      try {
        // 디렉토리가 없거나 권한이 없는 경우 생성
        await fs.mkdir(userDataPath, { recursive: true, mode: 0o755 });
        console.log(`✅ Created user data directory: ${userDataPath}`);
      } catch (mkdirError: any) {
        console.error(`❌ Failed to create user data directory: ${mkdirError.message}`);
        throw new Error(`Cannot create user data directory: ${mkdirError.message}`);
      }
    }
    
    // 데이터베이스 파일 권한 확인 (존재하는 경우)
    const fs_sync = require('fs');
    if (fs_sync.existsSync(this.dbPath)) {
      try {
        await fs.access(this.dbPath, fs.constants.R_OK | fs.constants.W_OK);
      } catch (error) {
        console.error(`❌ Database file permission error: ${this.dbPath}`);
        throw new Error(`Database file is not accessible: ${this.dbPath}`);
      }
    }
  }

  // 데이터베이스 정리
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}