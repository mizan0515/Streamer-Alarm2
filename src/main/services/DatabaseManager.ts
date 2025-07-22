import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';
import { databaseLogger } from './CategoryLogger';
import { 
  StreamerData, 
  NotificationSettings, 
  NotificationRecord, 
  AppSettings, 
  MonitoringStatus,
  WeverseArtist
} from '@shared/types';

export class DatabaseManager {
  private db!: Database.Database;
  private dbPath: string;
  private readonly CURRENT_SCHEMA_VERSION = 4; // 현재 스키마 버전

  constructor() {
    // 데이터베이스 경로 설정 (userData 디렉토리)
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'streamer_alarm.db');
  }

  // 로그 헬퍼 메서드들
  private logInfo(message: string, data?: any): void {
    databaseLogger.info(message, data);
  }

  private logError(message: string, error?: any): void {
    databaseLogger.error(message, error);
  }

  private logSchema(message: string, data?: any): void {
    databaseLogger.info(`[SCHEMA] ${message}`, data);
  }

  private logQuery(message: string, query?: string): void {
    databaseLogger.debug(`[QUERY] ${message}`, query ? { query } : undefined);
  }

  private logSuccess(message: string, data?: any): void {
    databaseLogger.info(`[SUCCESS] ${message}`, data);
  }

  // 프로필 이미지 URL 컬럼 생성 헬퍼
  private buildProfileImageUrlColumn(notificationColumns: string[], weverseColumns: string[], weverseTableExists: boolean): string {
    const parts: string[] = [];
    
    if (notificationColumns.includes('profile_image_url')) {
      parts.push('n.profile_image_url');
    }
    
    parts.push('s.profile_image_url');
    
    if (weverseTableExists && weverseColumns.includes('profile_image_url')) {
      parts.push('wa.profile_image_url');
    }
    
    return parts.length > 1 ? `COALESCE(${parts.join(', ')})` : parts[0] || 'NULL';
  }

  // 위버스 아티스트 JOIN 조건 생성 헬퍼
  private buildWeverseJoin(notificationColumns: string[], weverseTableExists: boolean): string {
    if (!weverseTableExists) {
      return '';
    }
    
    // weverse_artist_id 컬럼이 존재하는 경우에만 JOIN
    if (notificationColumns.includes('weverse_artist_id')) {
      return 'LEFT JOIN weverse_artists wa ON n.weverse_artist_id = wa.id';
    }
    
    return '';
  }

  async initialize(): Promise<void> {
    try {
      this.logInfo('Starting database initialization...');
      this.logInfo(`Database path: ${this.dbPath}`);
      
      // 데이터베이스 파일 존재 확인
      const fs = require('fs');
      const dbExists = fs.existsSync(this.dbPath);
      this.logInfo(`Database file exists: ${dbExists}`);
      
      // 사용자 데이터 디렉토리 확인 및 생성
      await this.ensureUserDataDirectory();
      this.logSuccess('User data directory ensured');
      
      // 데이터베이스 연결
      this.db = new Database(this.dbPath);
      this.logSuccess('Database connection established');
      
      // WAL 모드 활성화 (성능 향상)
      this.db.pragma('journal_mode = WAL');
      this.logSuccess('WAL mode activated');
      
      // 외래 키 제약 활성화
      this.db.pragma('foreign_keys = ON');
      this.logSuccess('Foreign keys enabled');
      
      // 기본 테이블 생성
      this.createTables();
      this.logSuccess('Basic tables creation completed');
      
      // 스키마 버전 관리 시스템 초기화
      this.initializeSchemaVersion();
      this.logSuccess('Schema version system initialized');
      
      // 즉시 마이그레이션 실행 (기존 DB 업그레이드)
      this.performMigration();
      this.logSuccess('Database migration completed');
      
      // 기본 데이터 삽입
      this.insertDefaultData();
      this.logSuccess('Default data inserted');
      
      // 위버스 알림 마이그레이션 실행
      await this.migrateWeverseNotifications();
      this.logSuccess('Weverse notifications migration completed');
      
      this.logSuccess('Database initialization completed successfully');
    } catch (error) {
      this.logError('Database initialization failed', error);
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
        platform TEXT NOT NULL CHECK (platform IN ('chzzk', 'cafe', 'twitter', 'weverse')),
        enabled BOOLEAN DEFAULT 1,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
        UNIQUE(streamer_id, platform)
      )
    `);

    // 위버스 아티스트 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS weverse_artists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_name TEXT UNIQUE NOT NULL,
        profile_image_url TEXT,
        is_enabled BOOLEAN DEFAULT 1,
        last_notification_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 알림 기록 테이블 (기본 스키마 - 모든 필요 컬럼 포함)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        streamer_id INTEGER,
        weverse_artist_id INTEGER,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        content_html TEXT,
        url TEXT,
        unique_key TEXT UNIQUE,
        profile_image_url TEXT,
        is_read BOOLEAN DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
        FOREIGN KEY (weverse_artist_id) REFERENCES weverse_artists(id) ON DELETE CASCADE
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

    // 스키마 버전 관리 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
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
        platform TEXT NOT NULL CHECK (platform IN ('chzzk', 'cafe', 'twitter', 'weverse')),
        last_content_id TEXT,
        last_check_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_status TEXT,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
        UNIQUE(streamer_id, platform)
      )
    `);

    // 기본 인덱스 생성 (weverse_artist_id 컬럼이 없어도 작동하는 것들만)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
      CREATE INDEX IF NOT EXISTS idx_notifications_unique_key ON notifications(unique_key);
      CREATE INDEX IF NOT EXISTS idx_streamers_active ON streamers(is_active);
      CREATE INDEX IF NOT EXISTS idx_monitor_states_streamer_platform ON monitor_states(streamer_id, platform);
      CREATE INDEX IF NOT EXISTS idx_weverse_artists_enabled ON weverse_artists(is_enabled);
    `);

    // 조건부 인덱스 생성 (컬럼 존재 여부 확인 후 생성)
    this.createConditionalIndexes();

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

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_weverse_artists_timestamp 
      AFTER UPDATE ON weverse_artists
      BEGIN
        UPDATE weverse_artists SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `);
  }

  private createConditionalIndexes(): void {
    try {
      // notifications 테이블의 컬럼 목록 확인
      const notificationColumns = this.db.prepare("PRAGMA table_info(notifications)").all()
        .map((col: any) => col.name);
      
      // weverse_artist_id 컬럼이 존재하는 경우에만 인덱스 생성
      if (notificationColumns.includes('weverse_artist_id')) {
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_weverse_artist_id ON notifications(weverse_artist_id)`);
        console.log('✅ Created weverse_artist_id index');
      } else {
        console.log('⚠️ Skipping weverse_artist_id index - column does not exist');
      }
      
      // is_read 컬럼이 존재하는 경우에만 인덱스 생성
      if (notificationColumns.includes('is_read')) {
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read)`);
        console.log('✅ Created is_read index');
      } else {
        console.log('⚠️ Skipping is_read index - column does not exist');
      }
    } catch (error) {
      console.error('Failed to create conditional indexes:', error);
    }
  }

  private initializeSchemaVersion(): void {
    try {
      // 스키마 버전 테이블이 존재하는지 확인
      const versionResult = this.db.prepare("SELECT version FROM schema_version WHERE id = 1").get() as { version: number } | undefined;
      
      if (!versionResult) {
        // 스키마 버전이 없으면 현재 버전으로 초기화
        this.db.prepare("INSERT INTO schema_version (id, version) VALUES (1, ?)").run(this.CURRENT_SCHEMA_VERSION);
        console.log(`📋 Initialized schema version to ${this.CURRENT_SCHEMA_VERSION}`);
      } else {
        console.log(`📋 Current schema version: ${versionResult.version}`);
      }
    } catch (error) {
      console.error('Failed to initialize schema version:', error);
    }
  }

  private getCurrentSchemaVersion(): number {
    try {
      const result = this.db.prepare("SELECT version FROM schema_version WHERE id = 1").get() as { version: number } | undefined;
      return result?.version || 0;
    } catch (error) {
      console.error('Failed to get current schema version:', error);
      return 0;
    }
  }

  private updateSchemaVersion(version: number): void {
    try {
      this.db.prepare("INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, ?)").run(version);
      console.log(`📋 Updated schema version to ${version}`);
    } catch (error) {
      console.error('Failed to update schema version:', error);
    }
  }

  private performMigration(): void {
    const currentVersion = this.getCurrentSchemaVersion();
    
    // 강제 마이그레이션 - 항상 필요한 컬럼들을 확인하고 추가
    console.log('🔧 Performing forced migration check...');
    this.forceAddMissingColumns();
    
    if (currentVersion >= this.CURRENT_SCHEMA_VERSION) {
      console.log(`✅ Database is up to date (version ${currentVersion})`);
      // 검증만 수행
      this.validateMigration();
      return;
    }
    
    console.log(`🔄 Migrating database from version ${currentVersion} to ${this.CURRENT_SCHEMA_VERSION}`);
    
    try {
      // 각 버전별 마이그레이션 실행
      for (let version = currentVersion + 1; version <= this.CURRENT_SCHEMA_VERSION; version++) {
        this.executeMigration(version);
      }
      
      // 마이그레이션 완료 후 버전 업데이트
      this.updateSchemaVersion(this.CURRENT_SCHEMA_VERSION);
      
      // 마이그레이션 검증
      this.validateMigration();
      
      console.log('✅ Database migration completed successfully');
    } catch (error) {
      console.error('❌ Database migration failed:', error);
      this.attemptMigrationRecovery();
    }
  }

  private executeMigration(version: number): void {
    console.log(`🔄 Executing migration for version ${version}`);
    
    const migration = this.db.transaction(() => {
      switch (version) {
        case 1:
          this.migrateToVersion1();
          break;
        case 2:
          this.migrateToVersion2();
          break;
        case 3:
          this.migrateToVersion3();
          break;
        case 4:
          this.migrateToVersion4();
          break;
        default:
          throw new Error(`Unknown migration version: ${version}`);
      }
    });
    
    migration();
    console.log(`✅ Migration to version ${version} completed`);
  }

  private migrateToVersion1(): void {
    // 버전 1: 기본 스키마 (이미 createTables에서 처리됨)
    console.log('📝 Migration v1: Basic schema already created');
  }

  private migrateToVersion2(): void {
    // 버전 2: is_read, content_html 컬럼 추가
    console.log('📝 Migration v2: Adding is_read and content_html columns');
    
    const tableInfo = this.db.prepare("PRAGMA table_info(notifications)").all();
    const existingColumns = tableInfo.map((col: any) => col.name);
    
    if (!existingColumns.includes('is_read')) {
      this.db.exec(`ALTER TABLE notifications ADD COLUMN is_read BOOLEAN DEFAULT 0`);
      console.log('✅ Added is_read column');
    }
    
    if (!existingColumns.includes('content_html')) {
      this.db.exec(`ALTER TABLE notifications ADD COLUMN content_html TEXT`);
      console.log('✅ Added content_html column');
    }
  }

  private migrateToVersion3(): void {
    const migration = this.db.transaction(() => {
      try {
        // 버전 3: 위버스 관련 기능 추가
        console.log('📝 Migration v3: Adding Weverse support');
        
        // 1. weverse_artists 테이블 확인 및 생성
        const tablesList = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const existingTables = tablesList.map((table: any) => table.name);
        
        if (!existingTables.includes('weverse_artists')) {
          this.db.exec(`
            CREATE TABLE weverse_artists (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              artist_name TEXT UNIQUE NOT NULL,
              profile_image_url TEXT,
              is_enabled BOOLEAN DEFAULT 1,
              last_notification_id TEXT,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `);
          console.log('✅ Created weverse_artists table');
        }
        
        // 2. notifications 테이블에 필수 컬럼 추가
        const notificationTableInfo = this.db.prepare("PRAGMA table_info(notifications)").all();
        const notificationColumns = notificationTableInfo.map((col: any) => col.name);
        
        const requiredColumns = [
          { name: 'weverse_artist_id', type: 'INTEGER' },
          { name: 'profile_image_url', type: 'TEXT' },
          { name: 'is_read', type: 'BOOLEAN DEFAULT 0' },
          { name: 'content_html', type: 'TEXT' }
        ];
        
        for (const column of requiredColumns) {
          if (!notificationColumns.includes(column.name)) {
            this.db.exec(`ALTER TABLE notifications ADD COLUMN ${column.name} ${column.type}`);
            console.log(`✅ Added ${column.name} column to notifications`);
          }
        }
        
        // 3. weverse_artists 테이블에 profile_image_url 컬럼 확인 및 추가
        const weverseTableInfo = this.db.prepare("PRAGMA table_info(weverse_artists)").all();
        const weverseColumns = weverseTableInfo.map((col: any) => col.name);
        
        if (!weverseColumns.includes('profile_image_url')) {
          this.db.exec(`ALTER TABLE weverse_artists ADD COLUMN profile_image_url TEXT`);
          console.log('✅ Added profile_image_url column to weverse_artists');
        }
        
        // 4. 조건부 인덱스 생성
        this.createConditionalIndexes();
        console.log('✅ Created Weverse-related indexes');
        
        // 5. 트리거 생성
        this.db.exec(`
          CREATE TRIGGER IF NOT EXISTS update_weverse_artists_timestamp 
          AFTER UPDATE ON weverse_artists
          BEGIN
            UPDATE weverse_artists SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
          END
        `);
        console.log('✅ Created weverse_artists update trigger');
        
        // 6. 마이그레이션 검증
        this.validateVersion3Migration();
        
      } catch (error) {
        console.error('❌ Migration v3 failed:', error);
        throw error;
      }
    });
    
    migration();
  }

  private migrateToVersion4(): void {
    console.log('📝 Migration v4: Updating CHECK constraint to support weverse type');
    
    const migration = this.db.transaction(() => {
      try {
        // SQLite는 ALTER TABLE로 CHECK 제약조건을 직접 수정할 수 없으므로 
        // 테이블을 재생성하는 방식을 사용합니다
        this.recreateNotificationsTableWithUpdatedConstraints();
        
        // 실패한 Weverse 알림들을 재마이그레이션
        this.retryFailedWeverseNotifications();
        
        this.logSuccess('Migration v4: CHECK constraint updated and Weverse notifications migrated');
        
      } catch (error) {
        this.logError('Migration v4 failed', error);
        throw error;
      }
    });
    
    migration();
  }

  private validateVersion3Migration(): void {
    try {
      console.log('🔍 Validating v3 migration...');
      
      // 필수 테이블 존재 확인
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
        .map((table: any) => table.name);
      
      if (!tables.includes('weverse_artists')) {
        throw new Error('weverse_artists table was not created');
      }
      
      if (!tables.includes('notifications')) {
        throw new Error('notifications table does not exist');
      }
      
      // 필수 컬럼 존재 확인
      const notificationColumns = this.db.prepare("PRAGMA table_info(notifications)").all()
        .map((col: any) => col.name);
      
      const requiredColumns = ['weverse_artist_id', 'profile_image_url', 'is_read', 'content_html'];
      const missingColumns = requiredColumns.filter(col => !notificationColumns.includes(col));
      
      if (missingColumns.length > 0) {
        throw new Error(`Missing required columns in notifications table: ${missingColumns.join(', ')}`);
      }
      
      // 테스트 쿼리 실행
      const testQuery = this.db.prepare(`
        SELECT n.id, n.weverse_artist_id, n.profile_image_url, n.is_read
        FROM notifications n
        LEFT JOIN weverse_artists wa ON n.weverse_artist_id = wa.id
        LIMIT 1
      `);
      testQuery.get();
      
      console.log('✅ v3 migration validation passed');
      
    } catch (error) {
      console.error('❌ v3 migration validation failed:', error);
      throw error;
    }
  }


  private validateMigration(): void {
    try {
      this.logInfo('Starting migration validation...');
      
      // 1. 최종 스키마 확인
      const finalTableInfo = this.db.prepare("PRAGMA table_info(notifications)").all();
      const notificationSchema = finalTableInfo.map((col: any) => ({ name: col.name, type: col.type }));
      this.logSchema('Final notifications table schema:', notificationSchema);
      
      const weverseTableInfo = this.db.prepare("PRAGMA table_info(weverse_artists)").all();
      const weverseSchema = weverseTableInfo.map((col: any) => ({ name: col.name, type: col.type }));
      this.logSchema('Weverse artists table schema:', weverseSchema);
      
      // 2. 필수 컬럼 존재 확인
      const requiredNotificationColumns = ['weverse_artist_id', 'profile_image_url', 'is_read', 'content_html'];
      const notificationColumns = finalTableInfo.map((col: any) => col.name);
      
      this.logInfo(`Checking ${requiredNotificationColumns.length} required columns...`);
      
      const missingColumns = requiredNotificationColumns.filter(col => !notificationColumns.includes(col));
      if (missingColumns.length > 0) {
        this.logError(`Missing required columns in notifications table: ${missingColumns.join(', ')}`);
        throw new Error(`Missing required columns in notifications table: ${missingColumns.join(', ')}`);
      }
      
      this.logSuccess('All required columns are present');
      
      // 3. 테스트 쿼리 실행
      const testQuery = `
        SELECT n.id, n.streamer_id, n.weverse_artist_id, n.profile_image_url, n.type, n.title, n.is_read
        FROM notifications n
        LEFT JOIN streamers s ON n.streamer_id = s.id
        LEFT JOIN weverse_artists wa ON n.weverse_artist_id = wa.id
        LIMIT 1
      `;
      
      this.logQuery('Testing complex query', testQuery);
      const testQueryStmt = this.db.prepare(testQuery);
      const testResult = testQueryStmt.get();
      this.logSuccess('Test query executed successfully', testResult);
      
      // 4. 샘플 데이터 확인
      const sampleData = this.db.prepare("SELECT * FROM notifications LIMIT 2").all();
      this.logInfo(`Sample notification data: ${sampleData?.length || 0} records`);
      
      const weverseData = this.db.prepare("SELECT * FROM weverse_artists LIMIT 2").all();
      this.logInfo(`Sample weverse artists data: ${weverseData?.length || 0} records`);
      
      // 5. 인덱스 확인
      const indexes = this.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all();
      this.logSchema(`Found ${indexes.length} custom indexes:`, indexes.map((idx: any) => idx.name));
      
      this.logSuccess('Migration validation completed successfully');
      
    } catch (error) {
      this.logError('Migration validation failed', error);
      throw error;
    }
  }

  private attemptMigrationRecovery(): void {
    try {
      console.log('🔧 Attempting migration recovery...');
      
      // 1. 데이터베이스 무결성 확인
      const integrityCheck = this.db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      console.log('🔍 Database integrity check:', integrityCheck);
      
      if (integrityCheck.integrity_check !== 'ok') {
        console.error('❌ Database integrity check failed:', integrityCheck.integrity_check);
        throw new Error('Database corruption detected');
      }
      
      // 2. 강제 마이그레이션 시도 (개별 컬럼 추가)
      console.log('🔄 Attempting forced migration...');
      
      this.forceAddMissingColumns();
      
      // 3. 마이그레이션 재검증
      this.validateMigration();
      
      console.log('✅ Migration recovery completed');
      
    } catch (recoveryError) {
      console.error('❌ Migration recovery failed:', recoveryError);
      console.error('❌ Database path:', this.dbPath);
      console.error('❌ Attempting to recreate database...');
      
      try {
        // 강제 데이터베이스 재생성 시도
        this.forceRecreateDatabase();
        console.log('✅ Database recreated successfully');
      } catch (recreateError) {
        console.error('❌ Failed to recreate database:', recreateError);
        this.logRecoveryInstructions();
        throw new Error('Database migration failed. Please restart the application to create a new database.');
      }
    }
  }

  private forceAddMissingColumns(): void {
    const transaction = this.db.transaction(() => {
      try {
        this.logInfo('Starting force migration of missing columns...');
        
        // 1. notifications 테이블 존재 확인
        const tablesList = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'").all();
        this.logSchema(`Found ${tablesList.length} notifications table(s)`);
        
        if (tablesList.length === 0) {
          this.logInfo('notifications table does not exist, creating it...');
          // notifications 테이블 생성 (모든 필수 컬럼 포함)
          const createQuery = `
            CREATE TABLE notifications (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              streamer_id INTEGER,
              weverse_artist_id INTEGER,
              type TEXT NOT NULL,
              title TEXT NOT NULL,
              content TEXT,
              content_html TEXT,
              url TEXT,
              unique_key TEXT UNIQUE,
              profile_image_url TEXT,
              is_read BOOLEAN DEFAULT 0,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
              FOREIGN KEY (weverse_artist_id) REFERENCES weverse_artists(id) ON DELETE CASCADE
            )
          `;
          this.logQuery('Creating notifications table', createQuery);
          this.db.exec(createQuery);
          this.logSuccess('Created notifications table with all columns');
        } else {
          // 기존 테이블에 컬럼 추가
          const existingNotificationColumns = this.db.prepare("PRAGMA table_info(notifications)").all()
            .map((col: any) => col.name);
          
          this.logSchema('Current notifications table columns:', existingNotificationColumns);
          
          const requiredColumns = [
            { name: 'weverse_artist_id', type: 'INTEGER' },
            { name: 'profile_image_url', type: 'TEXT' },
            { name: 'is_read', type: 'BOOLEAN DEFAULT 0' },
            { name: 'content_html', type: 'TEXT' }
          ];
          
          this.logInfo(`Checking ${requiredColumns.length} required columns...`);
          
          for (const column of requiredColumns) {
            if (!existingNotificationColumns.includes(column.name)) {
              const alterQuery = `ALTER TABLE notifications ADD COLUMN ${column.name} ${column.type}`;
              this.logQuery(`Adding column ${column.name}`, alterQuery);
              this.db.exec(alterQuery);
              this.logSuccess(`Successfully added ${column.name} column`);
            } else {
              this.logInfo(`Column ${column.name} already exists`);
            }
          }
        }
        
        // 2. weverse_artists 테이블 생성 및 컬럼 추가
        const weverseTableQuery = `
          CREATE TABLE IF NOT EXISTS weverse_artists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_name TEXT UNIQUE NOT NULL,
            profile_image_url TEXT,
            is_enabled BOOLEAN DEFAULT 1,
            last_notification_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
        this.logQuery('Creating weverse_artists table', weverseTableQuery);
        this.db.exec(weverseTableQuery);
        this.logSuccess('weverse_artists table created/verified');
        
        // 기존 weverse_artists 테이블에 누락된 컬럼 추가
        const existingWeverseColumns = this.db.prepare("PRAGMA table_info(weverse_artists)").all()
          .map((col: any) => col.name);
        
        this.logSchema('Current weverse_artists table columns:', existingWeverseColumns);
        
        const requiredWeverseColumns = [
          { name: 'profile_image_url', type: 'TEXT' }
        ];
        
        this.logInfo(`Checking ${requiredWeverseColumns.length} required weverse_artists columns...`);
        
        for (const column of requiredWeverseColumns) {
          if (!existingWeverseColumns.includes(column.name)) {
            const alterQuery = `ALTER TABLE weverse_artists ADD COLUMN ${column.name} ${column.type}`;
            this.logQuery(`Adding column ${column.name} to weverse_artists`, alterQuery);
            this.db.exec(alterQuery);
            this.logSuccess(`Successfully added ${column.name} column to weverse_artists`);
          } else {
            this.logInfo(`Column ${column.name} already exists in weverse_artists`);
          }
        }
        
        // 3. 조건부 인덱스 생성
        this.createConditionalIndexes();
        
        // 4. 마이그레이션 후 검증
        this.validateForceMigration();
        
        this.logSuccess('Force column migration completed successfully');
        
      } catch (error: any) {
        this.logError('Force column migration failed', error);
        throw error;
      }
    });
    
    transaction();
  }

  private validateForceMigration(): void {
    try {
      this.logInfo('Validating force migration...');
      
      // notifications 테이블 컬럼 확인
      const notificationColumns = this.db.prepare("PRAGMA table_info(notifications)").all()
        .map((col: any) => col.name);
      
      const requiredColumns = ['weverse_artist_id', 'profile_image_url', 'is_read', 'content_html'];
      const missingColumns = requiredColumns.filter(col => !notificationColumns.includes(col));
      
      if (missingColumns.length > 0) {
        throw new Error(`Still missing required columns: ${missingColumns.join(', ')}`);
      }
      
      // 테스트 쿼리 실행
      const testQuery = this.db.prepare(`
        SELECT COUNT(*) as count FROM notifications 
        WHERE weverse_artist_id IS NULL OR weverse_artist_id IS NOT NULL
      `);
      testQuery.get();
      
      this.logSuccess('Force migration validation passed');
      
    } catch (error) {
      this.logError('Force migration validation failed', error);
      throw error;
    }
  }

  // 강제 데이터베이스 재생성 메서드
  private forceRecreateDatabase(): void {
    try {
      console.log('🔧 Force recreating database...');
      
      // 기존 연결 종료
      if (this.db) {
        this.db.close();
      }
      
      // 데이터베이스 파일 삭제 시도
      const fs = require('fs');
      if (fs.existsSync(this.dbPath)) {
        fs.unlinkSync(this.dbPath);
        console.log('✅ Old database file deleted');
      }
      
      // 새 데이터베이스 생성
      this.db = new Database(this.dbPath);
      
      // WAL 모드 활성화
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      
      // 새 스키마 생성
      this.createTables();
      
      // 스키마 버전 설정
      this.initializeSchemaVersion();
      this.updateSchemaVersion(this.CURRENT_SCHEMA_VERSION);
      
      // 기본 데이터 삽입
      this.insertDefaultData();
      
      console.log('✅ Database successfully recreated');
      
    } catch (error) {
      console.error('❌ Failed to recreate database:', error);
      throw error;
    }
  }

  private logRecoveryInstructions(): void {
    console.log('');
    console.log('============================================');
    console.log('💡 데이터베이스 복구 가이드');
    console.log('============================================');
    console.log('1. 애플리케이션을 완전히 종료하세요');
    console.log('2. 다음 경로의 데이터베이스 파일을 삭제하세요:');
    console.log(`   ${this.dbPath}`);
    console.log('3. 애플리케이션을 다시 시작하세요');
    console.log('4. 새로운 데이터베이스가 자동으로 생성됩니다');
    console.log('============================================');
    console.log('');
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
      { key: 'needNaverLogin', value: 'true' },
      { key: 'needWeverseLogin', value: 'true' }
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
    try {
      this.logInfo('Starting getNotifications query...');
      databaseLogger.info('알림 기록 조회 시작', { options });
      
      // 1. 컬럼 존재 확인
      const notificationColumns = this.db.prepare("PRAGMA table_info(notifications)").all()
        .map((col: any) => col.name);
      
      this.logSchema('Available notification columns:', notificationColumns);
      databaseLogger.debug('알림 테이블 컬럼 확인', { columns: notificationColumns });
      
      // 2. weverse_artists 테이블 컬럼 확인
      let weverseColumns: string[] = [];
      let weverseTableExists = false;
      
      try {
        const weverseTableCheck = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='weverse_artists'").get();
        if (weverseTableCheck) {
          weverseTableExists = true;
          weverseColumns = this.db.prepare("PRAGMA table_info(weverse_artists)").all()
            .map((col: any) => col.name);
          this.logSchema('Available weverse_artists columns:', weverseColumns);
          databaseLogger.debug('위버스 아티스트 테이블 확인', { 
            exists: true, 
            columns: weverseColumns 
          });
        } else {
          databaseLogger.warn('위버스 아티스트 테이블이 존재하지 않음');
        }
      } catch (error) {
        this.logError('Failed to check weverse_artists table', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        databaseLogger.error('위버스 아티스트 테이블 확인 실패', { error: errorMessage });
      }
      
      // 3. 안전한 쿼리 생성
      const safeColumns = {
        id: 'n.id',
        streamerId: notificationColumns.includes('streamer_id') ? 'n.streamer_id' : 'NULL',
        weverseArtistId: notificationColumns.includes('weverse_artist_id') ? 'n.weverse_artist_id' : 'NULL',
        type: 'n.type',
        title: 'n.title',
        content: 'n.content',
        contentHtml: notificationColumns.includes('content_html') ? 'n.content_html' : 'NULL',
        url: 'n.url',
        uniqueKey: 'n.unique_key',
        profileImageUrl: this.buildProfileImageUrlColumn(notificationColumns, weverseColumns, weverseTableExists),
        isRead: notificationColumns.includes('is_read') ? 'COALESCE(n.is_read, 0)' : '0',
        createdAt: 'n.created_at',
        streamerName: weverseTableExists && notificationColumns.includes('weverse_artist_id') ? 'COALESCE(s.name, wa.artist_name)' : 'COALESCE(s.name, \'Unknown\')'
      };
      
      let query = `
        SELECT ${safeColumns.id} as id,
               ${safeColumns.streamerId} as streamerId,
               ${safeColumns.weverseArtistId} as weverseArtistId,
               ${safeColumns.type} as type,
               ${safeColumns.title} as title,
               ${safeColumns.content} as content,
               ${safeColumns.contentHtml} as contentHtml,
               ${safeColumns.url} as url,
               ${safeColumns.uniqueKey} as uniqueKey,
               ${safeColumns.profileImageUrl} as profileImageUrl,
               ${safeColumns.isRead} as isRead,
               ${safeColumns.createdAt} as createdAt,
               ${safeColumns.streamerName} as streamer_name
        FROM notifications n
        LEFT JOIN streamers s ON n.streamer_id = s.id AND n.streamer_id != -1
        ${this.buildWeverseJoin(notificationColumns, weverseTableExists)}
      `;

      const params: any[] = [];

      if (options.type && options.type !== 'all') {
        if (options.type === 'weverse') {
          // 위버스 알림은 특별한 조건으로 식별
          query += ` WHERE (
            n.weverse_artist_id IS NOT NULL OR 
            n.type = 'weverse' OR 
            n.url LIKE '%weverse.io%' OR 
            n.content LIKE '%[위버스]%' OR 
            n.title LIKE '%위버스%'
          )`;
          
          databaseLogger.debug('위버스 알림 조회', {
            query: query.replace(/\s+/g, ' ').trim()
          });
        } else if (options.type === 'live') {
          // 라이브 필터의 경우 위버스 제외
          query += ` WHERE n.type = ? AND (
            n.weverse_artist_id IS NULL AND 
            (n.url IS NULL OR n.url NOT LIKE '%weverse.io%') AND 
            (n.content IS NULL OR n.content NOT LIKE '%[위버스]%') AND 
            (n.title IS NULL OR n.title NOT LIKE '%위버스%')
          )`;
          params.push(options.type);
          
          databaseLogger.debug('라이브 알림 조회 (위버스 제외)', {
            query: query.replace(/\s+/g, ' ').trim(),
            params
          });
        } else {
          query += ' WHERE n.type = ?';
          params.push(options.type);
        }
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

      this.logQuery('Executing getNotifications query', query);
      databaseLogger.debug('쿼리 실행', { 
        query: query.replace(/\s+/g, ' ').trim(), 
        params,
        weverseTableExists,
        hasWeverseColumns: weverseColumns.length > 0
      });
      
      const stmt = this.db.prepare(query);
      const results = stmt.all(...params) as any[];
      
      this.logSuccess(`getNotifications query completed: ${results.length} records`);
      databaseLogger.info('알림 기록 조회 완료', { 
        resultCount: results.length,
        requestedType: options.type,
        limit: options.limit,
        offset: options.offset
      });
      
      // 디버그 로깅
      this.logInfo('getNotifications results sample:', 
        results.slice(0, 2).map(r => ({
          id: r.id,
          streamerId: r.streamerId,
          weverseArtistId: r.weverseArtistId,
          profileImageUrl: r.profileImageUrl,
          isRead: r.isRead,
          createdAt: r.createdAt,
          type: r.type
        }))
      );
      
      // 위버스 관련 결과 분석 강화
      if (options.type === 'weverse' || !options.type) {
        const weverseResults = results.filter(r => 
          r.weverseArtistId != null || 
          r.type === 'weverse' ||
          (r.url && r.url.includes('weverse.io')) ||
          (r.content && r.content.includes('[위버스]')) ||
          (r.title && r.title.includes('위버스'))
        );
        
        databaseLogger.debug('위버스 관련 결과 분석 강화', {
          totalResults: results.length,
          weverseResults: weverseResults.length,
          weverseTypes: weverseResults.map(r => ({ 
            id: r.id, 
            type: r.type, 
            weverseArtistId: r.weverseArtistId,
            hasWeverseUrl: !!(r.url && r.url.includes('weverse.io')),
            hasWeverseContent: !!(r.content && r.content.includes('[위버스]')),
            hasWeverseTitle: !!(r.title && r.title.includes('위버스'))
          })),
          typeBreakdown: {
            byType: results.reduce((acc, r) => {
              acc[r.type] = (acc[r.type] || 0) + 1;
              return acc;
            }, {} as Record<string, number>),
            withWeverseArtistId: results.filter(r => r.weverseArtistId != null).length,
            withWeverseUrl: results.filter(r => r.url && r.url.includes('weverse.io')).length,
            withWeverseContent: results.filter(r => r.content && r.content.includes('[위버스]')).length
          }
        });
      }
      
      return results.map(row => ({
        id: row.id,
        streamerId: row.streamerId,
        weverseArtistId: row.weverseArtistId,
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
      
    } catch (error) {
      this.logError('getNotifications query failed', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      databaseLogger.error('알림 기록 조회 실패', { error: errorMessage, options });
      return [];
    }
  }

  async addNotification(notification: Omit<NotificationRecord, 'id' | 'createdAt'>, originalTimestamp?: Date): Promise<void> {
    try {
      this.logInfo('Adding new notification...', {
        type: notification.type,
        title: notification.title,
        streamerId: notification.streamerId,
        weverseArtistId: notification.weverseArtistId
      });

      // 1. 컬럼 존재 확인
      const notificationColumns = this.db.prepare("PRAGMA table_info(notifications)").all()
        .map((col: any) => col.name);

      // 2. 원본 시간이 제공되면 사용, 아니면 현재 시간 사용
      const timestamp = originalTimestamp ? originalTimestamp.toISOString() : new Date().toISOString();
      
      // 3. 안전한 INSERT 쿼리 생성
      const availableColumns = [
        'streamer_id',
        'type',
        'title',
        'content',
        'url',
        'unique_key',
        'created_at'
      ];
      
      const optionalColumns = [
        { name: 'weverse_artist_id', value: notification.weverseArtistId },
        { name: 'content_html', value: notification.contentHtml },
        { name: 'profile_image_url', value: notification.profileImageUrl },
        { name: 'is_read', value: notification.isRead ? 1 : 0 }
      ];

      // 존재하는 컬럼만 추가
      const columnsToInsert = [...availableColumns];
      const valuesToInsert = [
        notification.streamerId || null,
        notification.type,
        notification.title,
        notification.content || null,
        notification.url,
        notification.uniqueKey,
        timestamp
      ];

      optionalColumns.forEach(col => {
        if (notificationColumns.includes(col.name)) {
          columnsToInsert.push(col.name);
          valuesToInsert.push(col.value || null);
        }
      });

      const insertQuery = `
        INSERT OR IGNORE INTO notifications (${columnsToInsert.join(', ')})
        VALUES (${columnsToInsert.map(() => '?').join(', ')})
      `;

      this.logQuery('Adding notification', insertQuery);
      const insertNotification = this.db.prepare(insertQuery);
      const result = insertNotification.run(...valuesToInsert);

      if (result.changes > 0) {
        this.logSuccess(`Notification added successfully (ID: ${result.lastInsertRowid})`);
      } else {
        this.logInfo('Notification already exists (duplicate ignored)');
      }

      // 4. 오래된 알림 삭제 (최대 1000개 유지)
      const cleanupQuery = `
        DELETE FROM notifications 
        WHERE id NOT IN (
          SELECT id FROM notifications 
          ORDER BY created_at DESC 
          LIMIT 1000
        )
      `;
      
      this.logQuery('Cleaning up old notifications', cleanupQuery);
      const cleanupResult = this.db.prepare(cleanupQuery).run();
      
      if (cleanupResult.changes > 0) {
        this.logInfo(`Cleaned up ${cleanupResult.changes} old notifications`);
      }

    } catch (error) {
      this.logError('Failed to add notification', error);
      throw error;
    }
  }

  async deleteAllNotifications(): Promise<void> {
    try {
      this.logInfo('Deleting all notifications...');
      const result = this.db.prepare('DELETE FROM notifications').run();
      this.logSuccess(`Deleted ${result.changes} notifications`);
    } catch (error) {
      this.logError('Failed to delete all notifications', error);
      throw error;
    }
  }

  // 알림 읽음 처리
  async markNotificationAsRead(notificationId: number): Promise<void> {
    try {
      this.logInfo(`Marking notification ${notificationId} as read...`);
      
      // 컬럼 존재 확인
      const notificationColumns = this.db.prepare("PRAGMA table_info(notifications)").all()
        .map((col: any) => col.name);
      
      if (!notificationColumns.includes('is_read')) {
        this.logError('is_read column does not exist in notifications table');
        return;
      }

      const stmt = this.db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?');
      const result = stmt.run(notificationId);
      
      if (result.changes > 0) {
        this.logSuccess(`Notification ${notificationId} marked as read`);
      } else {
        this.logInfo(`Notification ${notificationId} not found or already read`);
      }
    } catch (error) {
      this.logError(`Failed to mark notification ${notificationId} as read`, error);
      throw error;
    }
  }

  async markAllNotificationsAsRead(): Promise<void> {
    try {
      this.logInfo('Marking all notifications as read...');
      
      // 컬럼 존재 확인
      const notificationColumns = this.db.prepare("PRAGMA table_info(notifications)").all()
        .map((col: any) => col.name);
      
      if (!notificationColumns.includes('is_read')) {
        this.logError('is_read column does not exist in notifications table');
        return;
      }

      const stmt = this.db.prepare('UPDATE notifications SET is_read = 1');
      const result = stmt.run();
      
      this.logSuccess(`Marked ${result.changes} notifications as read`);
    } catch (error) {
      this.logError('Failed to mark all notifications as read', error);
      throw error;
    }
  }

  // 읽지않은 알림 수 조회
  async getUnreadNotificationCount(): Promise<number> {
    try {
      this.logInfo('Getting unread notification count...');
      
      // 컬럼 존재 확인
      const notificationColumns = this.db.prepare("PRAGMA table_info(notifications)").all()
        .map((col: any) => col.name);
      
      let query = 'SELECT COUNT(*) as count FROM notifications';
      
      if (notificationColumns.includes('is_read')) {
        query += ' WHERE is_read = 0';
      } else {
        this.logInfo('is_read column does not exist, returning total count');
      }
      
      const stmt = this.db.prepare(query);
      const result = stmt.get() as { count: number };
      
      this.logSuccess(`Unread notification count: ${result.count}`);
      return result.count;
    } catch (error) {
      this.logError('Failed to get unread notification count', error);
      return 0;
    }
  }

  // 총 알림 수 조회 (페이지네이션용)
  async getTotalNotificationCount(options: { type?: string } = {}): Promise<number> {
    try {
      this.logInfo('Getting total notification count...', options);
      
      let query = 'SELECT COUNT(*) as count FROM notifications n';
      const params: any[] = [];

      if (options.type && options.type !== 'all') {
        if (options.type === 'weverse') {
          // 위버스 알림은 특별한 조건으로 식별
          query += ` WHERE (
            n.weverse_artist_id IS NOT NULL OR 
            n.type = 'weverse' OR 
            n.url LIKE '%weverse.io%' OR 
            n.content LIKE '%[위버스]%' OR 
            n.title LIKE '%위버스%'
          )`;
          
          databaseLogger.debug('위버스 알림 개수 조회', {
            query: query.replace(/\s+/g, ' ').trim()
          });
        } else if (options.type === 'live') {
          // 라이브 필터의 경우 위버스 제외
          query += ` WHERE n.type = ? AND (
            n.weverse_artist_id IS NULL AND 
            (n.url IS NULL OR n.url NOT LIKE '%weverse.io%') AND 
            (n.content IS NULL OR n.content NOT LIKE '%[위버스]%') AND 
            (n.title IS NULL OR n.title NOT LIKE '%위버스%')
          )`;
          params.push(options.type);
          
          databaseLogger.debug('라이브 알림 개수 조회 (위버스 제외)', {
            query: query.replace(/\s+/g, ' ').trim(),
            params
          });
        } else {
          query += ' WHERE n.type = ?';
          params.push(options.type);
        }
      }

      this.logQuery('Getting total notification count', query);
      const stmt = this.db.prepare(query);
      const result = stmt.get(...params) as { count: number };
      
      databaseLogger.info('총 알림 개수 조회 완료', {
        type: options.type || 'all',
        count: result.count,
        query: query.replace(/\s+/g, ' ').trim()
      });
      
      this.logSuccess(`Total notification count: ${result.count}`);
      return result.count;
    } catch (error) {
      this.logError('Failed to get total notification count', error);
      return 0;
    }
  }

  // 설정 관련 메서드
  async getSetting(key: string): Promise<string | null> {
    try {
      this.logInfo(`Getting setting: ${key}`);
      const stmt = this.db.prepare('SELECT value FROM app_settings WHERE key = ?');
      const result = stmt.get(key) as { value: string } | undefined;
      
      if (result) {
        this.logSuccess(`Setting '${key}' found: ${result.value}`);
        return result.value;
      } else {
        this.logInfo(`Setting '${key}' not found`);
        return null;
      }
    } catch (error) {
      this.logError(`Failed to get setting '${key}'`, error);
      return null;
    }
  }

  async setSetting(key: string, value: string): Promise<void> {
    try {
      this.logInfo(`Setting '${key}' to '${value}'`);
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)
      `);
      const result = stmt.run(key, value);
      
      if (result.changes > 0) {
        this.logSuccess(`Setting '${key}' updated successfully`);
      } else {
        this.logInfo(`Setting '${key}' was not changed`);
      }
    } catch (error) {
      this.logError(`Failed to set setting '${key}'`, error);
      throw error;
    }
  }

  async getAllSettings(): Promise<Record<string, string>> {
    try {
      this.logInfo('Getting all settings...');
      const stmt = this.db.prepare('SELECT key, value FROM app_settings');
      const rows = stmt.all() as { key: string; value: string }[];
      
      const settings: Record<string, string> = {};
      rows.forEach(row => {
        settings[row.key] = row.value;
      });
      
      this.logSuccess(`Retrieved ${rows.length} settings`);
      return settings;
    } catch (error) {
      this.logError('Failed to get all settings', error);
      return {};
    }
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
              streamer_id, weverse_artist_id, type, title, content, content_html, url, unique_key, profile_image_url, is_read, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            streamerResult.id,
            null,
            notification.type,
            notification.title,
            notification.content || null,
            notification.content_html || null,
            notification.url,
            notification.unique_key,
            notification.profile_image_url || null,
            notification.is_read ? 1 : 0,
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

  // Weverse 아티스트용 baseline 설정 로직
  async establishWeverseBaseline(artistId: number, lastNotificationId: string): Promise<void> {
    try {
      const updateStmt = this.db.prepare(`
        UPDATE weverse_artists 
        SET last_notification_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      
      const result = updateStmt.run(lastNotificationId, artistId);
      
      if (result.changes > 0) {
        console.log(`🎯 [위버스 기준선] 아티스트 ${artistId} 기준선 설정 완료: ${lastNotificationId}`);
      } else {
        console.warn(`⚠️ [위버스 기준선] 아티스트 ${artistId} 기준선 설정 실패`);
      }
    } catch (error) {
      console.error(`❌ [위버스 기준선] 아티스트 ${artistId} 기준선 설정 오류:`, error);
    }
  }

  // 새로운 위버스 아티스트 확인 (last_notification_id가 null인 경우)
  async getWeverseArtistsNeedingBaseline(): Promise<{ id: number, artistName: string }[]> {
    try {
      const query = this.db.prepare(`
        SELECT id, artist_name as artistName
        FROM weverse_artists 
        WHERE is_enabled = 1 AND last_notification_id IS NULL
      `);
      
      const result = query.all() as { id: number, artistName: string }[];
      
      if (result.length > 0) {
        console.log(`🎯 [위버스 기준선] 기준선 설정이 필요한 아티스트 ${result.length}명 발견`);
      }
      
      return result;
    } catch (error) {
      console.error(`❌ [위버스 기준선] 기준선 설정 필요 아티스트 조회 오류:`, error);
      return [];
    }
  }

  // 위버스 아티스트 프로필 이미지 업데이트
  async updateWeverseArtistProfileImage(artistName: string, profileImageUrl: string): Promise<void> {
    try {
      this.logInfo(`Updating Weverse artist profile image: ${artistName}`, { profileImageUrl });
      
      // 1. weverse_artists 테이블 존재 확인
      const tableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='weverse_artists'").get();
      
      if (!tableExists) {
        this.logError('weverse_artists table does not exist');
        throw new Error('weverse_artists table does not exist');
      }
      
      // 2. profile_image_url 컬럼 존재 확인
      const weverseColumns = this.db.prepare("PRAGMA table_info(weverse_artists)").all()
        .map((col: any) => col.name);
      
      if (!weverseColumns.includes('profile_image_url')) {
        this.logError('profile_image_url column does not exist');
        return; // 컬럼이 없으면 조용히 무시
      }
      
      // 3. 아티스트 존재 확인
      const existingArtist = this.db.prepare("SELECT id FROM weverse_artists WHERE artist_name = ?").get(artistName);
      
      if (!existingArtist) {
        this.logInfo(`Weverse artist '${artistName}' not found, skipping profile image update`);
        return;
      }
      
      // 4. 프로필 이미지 업데이트
      const updateStmt = this.db.prepare(`
        UPDATE weverse_artists 
        SET profile_image_url = ?, updated_at = CURRENT_TIMESTAMP
        WHERE artist_name = ?
      `);
      
      const result = updateStmt.run(profileImageUrl, artistName);
      
      if (result.changes > 0) {
        this.logSuccess(`Profile image updated for Weverse artist '${artistName}': ${profileImageUrl}`);
      } else {
        this.logInfo(`No changes made to profile image for Weverse artist '${artistName}'`);
      }
      
    } catch (error) {
      this.logError(`Failed to update profile image for Weverse artist '${artistName}'`, error);
    }
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

  // 위버스 아티스트 관련 메서드
  async getWeverseArtists(): Promise<{
    id: number;
    artistName: string;
    profileImageUrl?: string;
    isEnabled: boolean;
    lastNotificationId?: string;
    createdAt: string;
    updatedAt: string;
  }[]> {
    try {
      this.logInfo('Getting all Weverse artists...');
      
      // 1. weverse_artists 테이블 존재 확인
      const tableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='weverse_artists'").get();
      
      if (!tableExists) {
        this.logError('weverse_artists table does not exist');
        return [];
      }
      
      // 2. 컬럼 존재 확인
      const weverseColumns = this.db.prepare("PRAGMA table_info(weverse_artists)").all()
        .map((col: any) => col.name);
      
      this.logSchema('Available weverse_artists columns:', weverseColumns);
      
      // 3. 안전한 쿼리 생성
      const safeColumns = {
        id: 'id',
        artistName: 'artist_name',
        profileImageUrl: weverseColumns.includes('profile_image_url') ? 'profile_image_url' : 'NULL',
        isEnabled: 'is_enabled',
        lastNotificationId: weverseColumns.includes('last_notification_id') ? 'last_notification_id' : 'NULL',
        createdAt: 'created_at',
        updatedAt: 'updated_at'
      };
      
      const query = `
        SELECT ${safeColumns.id} as id, 
               ${safeColumns.artistName} as artist_name, 
               ${safeColumns.profileImageUrl} as profile_image_url, 
               ${safeColumns.isEnabled} as is_enabled,
               ${safeColumns.lastNotificationId} as last_notification_id,
               ${safeColumns.createdAt} as created_at,
               ${safeColumns.updatedAt} as updated_at
        FROM weverse_artists 
        ORDER BY artist_name
      `;
      
      this.logQuery('Getting all Weverse artists', query);
      const stmt = this.db.prepare(query);
      const rows = stmt.all() as any[];
      
      this.logSuccess(`Retrieved ${rows.length} Weverse artists`);
      
      return rows.map(row => ({
        id: row.id,
        artistName: row.artist_name,
        profileImageUrl: row.profile_image_url,
        isEnabled: Boolean(row.is_enabled),
        lastNotificationId: row.last_notification_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
      
    } catch (error) {
      this.logError('Failed to get Weverse artists', error);
      return [];
    }
  }

  async getActiveWeverseArtists(): Promise<WeverseArtist[]> {
    try {
      this.logInfo('Starting getActiveWeverseArtists query...');
      
      // 1. weverse_artists 테이블 존재 확인
      const tableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='weverse_artists'").get();
      
      if (!tableExists) {
        this.logError('weverse_artists table does not exist');
        return [];
      }
      
      // 2. 컬럼 존재 확인
      const weverseColumns = this.db.prepare("PRAGMA table_info(weverse_artists)").all()
        .map((col: any) => col.name);
      
      this.logSchema('Available weverse_artists columns:', weverseColumns);
      
      // 3. 안전한 쿼리 생성
      const safeColumns = {
        id: 'id',
        artistName: 'artist_name',
        profileImageUrl: weverseColumns.includes('profile_image_url') ? 'profile_image_url' : 'NULL',
        isEnabled: weverseColumns.includes('is_enabled') ? 'is_enabled' : '1',
        lastNotificationId: weverseColumns.includes('last_notification_id') ? 'last_notification_id' : 'NULL',
        createdAt: weverseColumns.includes('created_at') ? 'created_at' : 'datetime("now")',
        updatedAt: weverseColumns.includes('updated_at') ? 'updated_at' : 'datetime("now")'
      };
      
      const query = `
        SELECT ${safeColumns.id} as id, 
               ${safeColumns.artistName} as artist_name, 
               ${safeColumns.profileImageUrl} as profile_image_url, 
               ${safeColumns.isEnabled} as is_enabled,
               ${safeColumns.lastNotificationId} as last_notification_id,
               ${safeColumns.createdAt} as created_at,
               ${safeColumns.updatedAt} as updated_at
        FROM weverse_artists 
        WHERE is_enabled = 1 
        ORDER BY artist_name
      `;
      
      this.logQuery('Executing getActiveWeverseArtists query', query);
      const stmt = this.db.prepare(query);
      const rows = stmt.all() as any[];
      
      this.logSuccess(`getActiveWeverseArtists query completed: ${rows.length} records`);
      
      return rows.map(row => ({
        id: row.id,
        artistName: row.artist_name,
        profileImageUrl: row.profile_image_url,
        isEnabled: Boolean(row.is_enabled),
        lastNotificationId: row.last_notification_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        // 라이브 상태 필드들은 기본값으로 설정
        isLive: false,
        liveTitle: undefined,
        liveUrl: undefined,
        liveStartTime: undefined
      }));
      
    } catch (error) {
      this.logError('getActiveWeverseArtists query failed', error);
      return [];
    }
  }

  async addWeverseArtist(artistName: string, profileImageUrl?: string): Promise<void> {
    try {
      this.logInfo(`Adding Weverse artist: ${artistName}`, { profileImageUrl });
      
      // 1. weverse_artists 테이블 존재 확인
      const tableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='weverse_artists'").get();
      
      if (!tableExists) {
        this.logError('weverse_artists table does not exist');
        throw new Error('weverse_artists table does not exist');
      }
      
      // 2. 컬럼 존재 확인
      const weverseColumns = this.db.prepare("PRAGMA table_info(weverse_artists)").all()
        .map((col: any) => col.name);
      
      console.log(`[DB_WEVERSE_ARTIST] 📊 Available columns:`, weverseColumns);
      
      // 3. 먼저 기존 아티스트가 있는지 확인
      const existingArtist = this.db.prepare("SELECT * FROM weverse_artists WHERE artist_name = ?").get(artistName);
      console.log(`[DB_WEVERSE_ARTIST] 🔍 Existing artist check:`, existingArtist);
      
      if (existingArtist) {
        this.logInfo(`Weverse artist '${artistName}' already exists with ID: ${(existingArtist as any).id}`);
        return; // 이미 존재하면 성공으로 간주
      }
      
      // 4. 안전한 INSERT 쿼리 생성
      const columnsToInsert = ['artist_name', 'is_enabled'];
      const valuesToInsert: any[] = [artistName, 1];
      
      if (weverseColumns.includes('profile_image_url')) {
        columnsToInsert.push('profile_image_url');
        valuesToInsert.push(profileImageUrl || null);
      }
      
      const query = `
        INSERT INTO weverse_artists (${columnsToInsert.join(', ')}) 
        VALUES (${columnsToInsert.map(() => '?').join(', ')})
      `;
      
      console.log(`[DB_WEVERSE_ARTIST] 📝 Insert query:`, query);
      console.log(`[DB_WEVERSE_ARTIST] 📝 Insert values:`, valuesToInsert);
      
      this.logQuery('Adding Weverse artist', query);
      const stmt = this.db.prepare(query);
      const result = stmt.run(...valuesToInsert);
      
      console.log(`[DB_WEVERSE_ARTIST] 📊 Insert result:`, {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid
      });
      
      if (result.changes > 0) {
        this.logSuccess(`Weverse artist '${artistName}' added successfully with ID: ${result.lastInsertRowid}`);
        
        // 실제로 생성되었는지 다시 확인
        const verifyArtist = this.db.prepare("SELECT * FROM weverse_artists WHERE id = ?").get(result.lastInsertRowid);
        console.log(`[DB_WEVERSE_ARTIST] ✅ Verification:`, verifyArtist);
        
        if (!verifyArtist) {
          throw new Error(`Artist creation verification failed for: ${artistName}`);
        }
      } else {
        throw new Error(`Failed to insert Weverse artist '${artistName}' - no changes made`);
      }
      
    } catch (error) {
      console.error(`[DB_WEVERSE_ARTIST] 💥 Error adding artist '${artistName}':`, error);
      this.logError(`Failed to add Weverse artist '${artistName}'`, error);
      throw error;
    }
  }

  async updateWeverseArtist(id: number, data: {
    artistName?: string;
    profileImageUrl?: string;
    isEnabled?: boolean;
    lastNotificationId?: string;
  }): Promise<void> {
    try {
      this.logInfo(`Updating Weverse artist ${id}`, data);
      
      // 1. weverse_artists 테이블 존재 확인
      const tableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='weverse_artists'").get();
      
      if (!tableExists) {
        this.logError('weverse_artists table does not exist');
        throw new Error('weverse_artists table does not exist');
      }
      
      // 2. 컬럼 존재 확인
      const weverseColumns = this.db.prepare("PRAGMA table_info(weverse_artists)").all()
        .map((col: any) => col.name);
      
      // 3. 안전한 UPDATE 쿼리 생성
      const fields = [];
      const values = [];
      
      if (data.artistName !== undefined) {
        fields.push('artist_name = ?');
        values.push(data.artistName);
      }
      
      if (data.profileImageUrl !== undefined && weverseColumns.includes('profile_image_url')) {
        fields.push('profile_image_url = ?');
        values.push(data.profileImageUrl);
      }
      
      if (data.isEnabled !== undefined) {
        fields.push('is_enabled = ?');
        values.push(data.isEnabled ? 1 : 0);
      }
      
      if (data.lastNotificationId !== undefined && weverseColumns.includes('last_notification_id')) {
        fields.push('last_notification_id = ?');
        values.push(data.lastNotificationId);
      }
      
      if (fields.length === 0) {
        this.logInfo('No fields to update');
        return;
      }
      
      const query = `UPDATE weverse_artists SET ${fields.join(', ')} WHERE id = ?`;
      values.push(id);
      
      this.logQuery('Updating Weverse artist', query);
      const stmt = this.db.prepare(query);
      const result = stmt.run(...values);
      
      if (result.changes > 0) {
        this.logSuccess(`Weverse artist ${id} updated successfully`);
      } else {
        this.logInfo(`Weverse artist ${id} not found or no changes made`);
      }
      
    } catch (error) {
      this.logError(`Failed to update Weverse artist ${id}`, error);
      throw error;
    }
  }

  async deleteWeverseArtist(id: number): Promise<void> {
    try {
      this.logInfo(`Deleting Weverse artist ${id}...`);
      
      const stmt = this.db.prepare('DELETE FROM weverse_artists WHERE id = ?');
      const result = stmt.run(id);
      
      if (result.changes > 0) {
        this.logSuccess(`Weverse artist ${id} deleted successfully`);
      } else {
        this.logInfo(`Weverse artist ${id} not found`);
      }
      
    } catch (error) {
      this.logError(`Failed to delete Weverse artist ${id}`, error);
      throw error;
    }
  }

  async refreshWeverseArtists(artistNames: string[], profileImages: Record<string, string>): Promise<void> {
    const transaction = this.db.transaction(() => {
      // 기존 아티스트 목록을 가져와서 현재 활성 상태를 유지
      const existingArtists = this.db.prepare(`
        SELECT artist_name, is_enabled FROM weverse_artists
      `).all() as { artist_name: string; is_enabled: number }[];
      
      const existingArtistStates = new Map<string, boolean>();
      existingArtists.forEach(artist => {
        existingArtistStates.set(artist.artist_name, Boolean(artist.is_enabled));
      });
      
      // 새로운 아티스트 목록으로 테이블 업데이트
      for (const artistName of artistNames) {
        const profileImageUrl = profileImages[artistName];
        const isEnabled = existingArtistStates.get(artistName) ?? true; // 기존 상태 유지, 새 아티스트는 기본 활성화
        
        this.db.prepare(`
          INSERT OR REPLACE INTO weverse_artists (artist_name, profile_image_url, is_enabled) 
          VALUES (?, ?, ?)
        `).run(artistName, profileImageUrl || null, isEnabled ? 1 : 0);
      }
      
      // 더 이상 존재하지 않는 아티스트 제거
      const placeholders = artistNames.map(() => '?').join(',');
      if (artistNames.length > 0) {
        this.db.prepare(`
          DELETE FROM weverse_artists WHERE artist_name NOT IN (${placeholders})
        `).run(...artistNames);
      } else {
        this.db.prepare('DELETE FROM weverse_artists').run();
      }
    });
    
    transaction();
  }

  async updateWeverseArtistLastNotification(artistName: string, notificationId: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE weverse_artists SET last_notification_id = ? WHERE artist_name = ?
    `);
    
    stmt.run(notificationId, artistName);
  }

  async addWeverseNotification(notification: {
    artistName: string;
    type: 'weverse';
    title: string;
    content: string;
    url: string;
    uniqueKey: string;
    profileImageUrl?: string;
    isRead?: boolean;
  }, originalTimestamp?: Date): Promise<void> {
    try {
      this.logInfo(`Adding Weverse notification for ${notification.artistName}...`);
      
      // 중복 확인 먼저 수행
      const existingCheck = this.db.prepare('SELECT COUNT(*) as count FROM notifications WHERE unique_key = ?').get(notification.uniqueKey) as { count: number };
      if (existingCheck && existingCheck.count > 0) {
        this.logInfo(`⚠️ Weverse notification already exists (duplicate ignored): ${notification.uniqueKey}`);
        return;
      }
      
      // 외래 키 제약 조건 임시 해제
      this.db.pragma('foreign_keys = OFF');
      console.log(`[DB_WEVERSE] 🔧 Foreign key constraints disabled for Weverse notification insertion`);
      
      // 아티스트 ID 찾기 및 생성
      const artistStmt = this.db.prepare(`
        SELECT id FROM weverse_artists WHERE artist_name = ?
      `);
      
      let artistResult = artistStmt.get(notification.artistName) as { id: number } | undefined;
      
      // 아티스트가 없으면 자동으로 생성 (강화된 로직)
      if (!artistResult) {
        this.logInfo(`Weverse artist '${notification.artistName}' not found, creating automatically...`);
        
        try {
          // 트랜잭션으로 아티스트 생성과 조회 보장
          this.db.transaction(() => {
            // 직접 INSERT로 아티스트 생성 (더 확실한 방법)
            const insertArtistStmt = this.db.prepare(`
              INSERT OR IGNORE INTO weverse_artists (artist_name, is_enabled, profile_image_url, created_at)
              VALUES (?, ?, ?, ?)
            `);
            
            const insertResult = insertArtistStmt.run(
              notification.artistName,
              1, // 기본적으로 활성화
              notification.profileImageUrl || null,
              new Date().toISOString()
            );
            
            console.log(`[DB_WEVERSE] 🎯 Direct artist INSERT result:`, {
              changes: insertResult.changes,
              lastInsertRowid: insertResult.lastInsertRowid
            });
            
            // 즉시 다시 조회
            artistResult = artistStmt.get(notification.artistName) as { id: number } | undefined;
            console.log(`[DB_WEVERSE] 🔍 Artist lookup after direct creation:`, artistResult);
          })();
          
          // 여전히 없으면 더 강력한 재시도
          if (!artistResult) {
            console.log(`[DB_WEVERSE] 🔄 Artist still not found, trying fallback creation...`);
            
            // 최대 3번 재시도
            for (let retry = 0; retry < 3; retry++) {
              try {
                const fallbackStmt = this.db.prepare(`
                  INSERT INTO weverse_artists (artist_name, is_enabled, profile_image_url, created_at)
                  SELECT ?, ?, ?, ?
                  WHERE NOT EXISTS (SELECT 1 FROM weverse_artists WHERE artist_name = ?)
                `);
                
                fallbackStmt.run(
                  notification.artistName,
                  1,
                  notification.profileImageUrl || null,
                  new Date().toISOString(),
                  notification.artistName
                );
                
                // 재조회
                artistResult = artistStmt.get(notification.artistName) as { id: number } | undefined;
                
                if (artistResult) {
                  console.log(`[DB_WEVERSE] ✅ Artist created successfully on retry ${retry + 1}:`, artistResult);
                  break;
                }
              } catch (retryError) {
                console.warn(`[DB_WEVERSE] Retry ${retry + 1} failed:`, retryError);
              }
            }
          }
          
          if (artistResult) {
            this.logSuccess(`Weverse artist '${notification.artistName}' created successfully with ID: ${artistResult.id}`);
          } else {
            // 최종 검증: 모든 위버스 아티스트 조회
            const allArtists = this.db.prepare("SELECT * FROM weverse_artists").all();
            console.log(`[DB_WEVERSE] 📊 All weverse_artists after creation attempts:`, allArtists);
            
            this.logError(`Failed to create or retrieve Weverse artist after all attempts: ${notification.artistName}`);
          }
          
        } catch (createError) {
          console.error(`[DB_WEVERSE] 💥 Artist creation failed:`, createError);
          
          // 데이터베이스 상태 확인
          try {
            const tableInfo = this.db.prepare("PRAGMA table_info(weverse_artists)").all();
            console.log(`[DB_WEVERSE] 🔍 weverse_artists table info:`, tableInfo);
            
            const integrityCheck = this.db.prepare("PRAGMA integrity_check").get();
            console.log(`[DB_WEVERSE] 🔍 Database integrity:`, integrityCheck);
          } catch (pragmaError) {
            console.error(`[DB_WEVERSE] Failed to check database state:`, pragmaError);
          }
          
          this.logError(`Failed to create Weverse artist '${notification.artistName}'`, createError);
        }
      } else {
        this.logInfo(`Found existing Weverse artist '${notification.artistName}' with ID: ${artistResult.id}`);
      }
      
      // 원본 시간이 제공되면 사용, 아니면 현재 시간 사용
      const timestamp = originalTimestamp ? originalTimestamp.toISOString() : new Date().toISOString();
      
      // 위버스 알림의 경우 streamer_id를 -1로 설정하고 올바른 type으로 저장
      const weverseTitle = notification.title.includes('위버스') ? notification.title : `${notification.title}`;
      const weverseContent = `[위버스] ${notification.content}`;
      
      // 🔒 트랜잭션으로 안전한 INSERT 실행
      const insertNotification = this.db.prepare(`
        INSERT INTO notifications (
          streamer_id, weverse_artist_id, type, title, content, content_html, url, unique_key, profile_image_url, is_read, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      this.logQuery('Inserting Weverse notification', `uniqueKey: ${notification.uniqueKey}, artistId: ${artistResult ? artistResult.id : 'NULL'}`);
      
      console.log(`[DB_WEVERSE] 📝 About to INSERT notification:`, {
        artistName: notification.artistName,
        uniqueKey: notification.uniqueKey,
        title: notification.title.substring(0, 50),
        url: notification.url,
        timestamp: timestamp,
        artistId: artistResult ? artistResult.id : null,
        hasArtist: !!artistResult
      });

      // 아티스트가 없으면 에러 발생 (더 이상 NULL 허용하지 않음)
      if (!artistResult) {
        const errorMsg = `Cannot insert Weverse notification: Artist '${notification.artistName}' not found and creation failed`;
        console.error(`[DB_WEVERSE] ❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      const bindingValues = [
        -1,                                      // streamer_id (위버스 전용 특별값)
        artistResult.id,                         // weverse_artist_id (반드시 유효한 아티스트 ID)
        'weverse',                               // type (올바른 위버스 타입으로 저장)
        weverseTitle,                            // title 
        weverseContent,                          // content 
        weverseContent || null,                  // content_html
        notification.url,                        // url
        notification.uniqueKey,                  // unique_key
        notification.profileImageUrl || null,    // profile_image_url
        notification.isRead ? 1 : 0,            // is_read
        timestamp                                // created_at
      ];
      
      console.log(`[DB_WEVERSE] 📊 PreparedStatement binding values:`, bindingValues);
      console.log(`[DB_WEVERSE] 📊 Binding value types:`, bindingValues.map(v => typeof v));
      console.log(`[DB_WEVERSE] 📊 Binding value lengths:`, bindingValues.map(v => v ? String(v).length : 0));

      let result: any;
      
      try {
        console.log(`[DB_WEVERSE] 🎯 Executing INSERT with valid artist ID: ${artistResult.id}`);
        
        // 트랜잭션으로 안전하게 실행
        result = this.db.transaction(() => {
          return insertNotification.run(...bindingValues);
        })();
        
        console.log(`[DB_WEVERSE] 📊 INSERT result:`, {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid
        });
        
        if (result.changes > 0) {
          console.log(`[DB_WEVERSE] ✅ SQLite operation completed successfully - Weverse notification saved with ID: ${result.lastInsertRowid}`);
          
          // 저장 성공 즉시 확인
          const verifyStmt = this.db.prepare('SELECT * FROM notifications WHERE rowid = ?');
          const savedNotification = verifyStmt.get(result.lastInsertRowid);
          console.log(`[DB_WEVERSE] 🔍 Verification - saved notification:`, savedNotification);
        } else {
          console.warn(`[DB_WEVERSE] ⚠️ INSERT returned 0 changes - notification may not have been saved`);
        }
        
      } catch (sqliteError: any) {
        console.error(`[DB_WEVERSE] 💥 SQLite INSERT error:`, sqliteError);
        console.error(`[DB_WEVERSE] 💥 Error message:`, sqliteError instanceof Error ? sqliteError.message : String(sqliteError));
        console.error(`[DB_WEVERSE] 💥 Error name:`, sqliteError instanceof Error ? sqliteError.name : 'Unknown');
        console.error(`[DB_WEVERSE] 💥 Error code:`, sqliteError.code);
        
        // 오류 발생 시 제약 조건 확인
        const pragmaCheck = this.db.prepare(`PRAGMA integrity_check`).get();
        console.log(`[DB_WEVERSE] 🔍 Database integrity check:`, pragmaCheck);
        
        // 테이블 스키마 확인 (CHECK 제약 조건 진단)
        try {
          const tableInfo = this.db.prepare(`PRAGMA table_info(notifications)`).all();
          console.log(`[DB_WEVERSE] 📋 Table schema:`, tableInfo);
          
          const sqlSchema = this.db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='notifications'`).get();
          console.log(`[DB_WEVERSE] 📜 Table CREATE statement:`, sqlSchema);
        } catch (schemaError) {
          console.error(`[DB_WEVERSE] ⚠️ Schema check failed:`, schemaError);
        }
        
        throw sqliteError;
      } finally {
        // 외래 키 제약 조건 다시 활성화
        this.db.pragma('foreign_keys = ON');
        console.log(`[DB_WEVERSE] 🔧 Foreign key constraints re-enabled`);
      }

      if (result.changes > 0) {
        this.logSuccess(`✅ Weverse notification inserted successfully (ID: ${result.lastInsertRowid})`);
        console.log(`[DB_WEVERSE] ✅ NEW NOTIFICATION SAVED:`, {
          id: result.lastInsertRowid,
          artistName: notification.artistName,
          uniqueKey: notification.uniqueKey,
          title: notification.title.substring(0, 50),
          url: notification.url,
          timestamp: timestamp
        });
        
        // 저장 후 즉시 위버스 알림 개수 확인 (now stored as 'live' type)
        const updatedWeverseCount = this.db.prepare(`
          SELECT COUNT(*) as count FROM notifications WHERE streamer_id = -1 AND weverse_artist_id IS NOT NULL
        `).get() as { count: number };
        
        console.log(`[DB_WEVERSE] 📊 Updated weverse notifications count (stored as 'live' type): ${updatedWeverseCount.count}`);
      } else {
        this.logInfo(`⚠️ Weverse notification was not inserted (may be duplicate): ${notification.uniqueKey}`);
        console.log(`[DB_WEVERSE] ⚠️ NOTIFICATION NOT INSERTED:`, {
          artistName: notification.artistName,
          uniqueKey: notification.uniqueKey,
          title: notification.title.substring(0, 50),
          url: notification.url,
          reason: 'No changes detected - may be duplicate'
        });
        
        // 중복 상황에서 실제로 해당 레코드가 존재하는지 확인
        const duplicateCheck = this.db.prepare('SELECT * FROM notifications WHERE unique_key = ? LIMIT 1').get(notification.uniqueKey) as any;
        console.log(`[DB_WEVERSE] 🔍 Duplicate record check:`, duplicateCheck ? 'Record exists' : 'No record found');
        if (duplicateCheck) {
          console.log(`[DB_WEVERSE] 🔍 Existing record details:`, {
            id: duplicateCheck.id,
            type: duplicateCheck.type,
            streamer_id: duplicateCheck.streamer_id,
            weverse_artist_id: duplicateCheck.weverse_artist_id,
            created_at: duplicateCheck.created_at
          });
        }
        
        // 중복 확인을 위한 기존 알림 조회
        const existingNotification = this.db.prepare(`
          SELECT id, unique_key, title, url, created_at FROM notifications WHERE unique_key = ?
        `).get(notification.uniqueKey);
        
        console.log(`[DB_WEVERSE] 🔍 Existing notification found:`, existingNotification);
        
        // 위버스 타입 알림 전체 개수도 확인
        const weverseCount = this.db.prepare(`
          SELECT COUNT(*) as count FROM notifications WHERE type = 'weverse'
        `).get() as { count: number };
        
        console.log(`[DB_WEVERSE] 📊 Total weverse notifications in DB: ${weverseCount.count}`);
        
        // 🔍 중복 상황에서 상세 진단 실행
        await this.diagnoseWeverseInsertIssue(notification);
      }

      // 오래된 알림 삭제 (최대 1000개 유지)
      const cleanupResult = this.db.prepare(`
        DELETE FROM notifications 
        WHERE id NOT IN (
          SELECT id FROM notifications 
          ORDER BY created_at DESC 
          LIMIT 1000
        )
      `).run();
      
      if (cleanupResult.changes > 0) {
        this.logInfo(`Cleaned up ${cleanupResult.changes} old notifications`);
      }
      
    } catch (error) {
      this.logError('Failed to add Weverse notification', error);
      throw error;
    }
  }

  // 위버스 아티스트 토글
  async toggleWeverseArtist(artistName: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE weverse_artists SET is_enabled = NOT is_enabled WHERE artist_name = ?
    `);
    
    stmt.run(artistName);
  }

  // 데이터베이스 정리
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }

  // 🔍 위버스 알림 삽입 문제 진단 메서드
  async diagnoseWeverseInsertIssue(notification: {
    artistName: string;
    uniqueKey: string;
    title: string;
    content: string;
    url: string;
    type: 'weverse';
    profileImageUrl?: string;
    isRead?: boolean;
  }): Promise<void> {
    try {
      console.log(`[DB_DIAGNOSIS] 🔍 Starting database diagnosis for uniqueKey: ${notification.uniqueKey}`);
      
      // 1. notifications 테이블 스키마 검사
      const tableInfo = this.db.prepare(`PRAGMA table_info(notifications)`).all();
      console.log(`[DB_DIAGNOSIS] 📊 notifications table schema:`, tableInfo);
      
      // 2. notifications 테이블 제약 조건 검사
      const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list(notifications)`).all();
      console.log(`[DB_DIAGNOSIS] 🔗 Foreign key constraints:`, foreignKeys);
      
      // 3. 인덱스 정보 확인
      const indexes = this.db.prepare(`PRAGMA index_list(notifications)`).all();
      console.log(`[DB_DIAGNOSIS] 📇 Table indexes:`, indexes);
      
      // 4. weverse_artists 테이블에서 BTS 아티스트 정보 확인
      const artistInfo = this.db.prepare(`
        SELECT * FROM weverse_artists WHERE artist_name = ?
      `).get('BTS');
      console.log(`[DB_DIAGNOSIS] 🎤 BTS artist info:`, artistInfo);
      
      // 5. notifications 테이블의 weverse 타입 알림 직접 조회
      const weverseNotifications = this.db.prepare(`
        SELECT * FROM notifications WHERE type = 'weverse' LIMIT 5
      `).all();
      console.log(`[DB_DIAGNOSIS] 📋 Existing weverse notifications:`, weverseNotifications);
      
      // 6. 현재 uniqueKey로 기존 알림 존재 여부 확인
      const existingByUniqueKey = this.db.prepare(`
        SELECT * FROM notifications WHERE unique_key = ?
      `).get(notification.uniqueKey);
      console.log(`[DB_DIAGNOSIS] 🔍 Existing notification with same uniqueKey:`, existingByUniqueKey);
      
      // 7. 수동 INSERT 테스트 (진단용)
      await this.testManualWeverseInsert(notification);
      
    } catch (error) {
      console.error(`[DB_DIAGNOSIS] ❌ Diagnosis failed:`, error);
    }
  }
  
  // 🧹 위버스 데이터 클리어 메서드들 (개발자 콘솔용)
  async clearWeverseNotifications(): Promise<void> {
    try {
      console.log('🧹 [DB_CLEAR] Clearing weverse notifications...');
      
      // 위버스 URL 패턴을 가진 알림 삭제
      const deleteResult = this.db.prepare(`
        DELETE FROM notifications WHERE url LIKE '%weverse.io%'
      `).run();
      
      console.log(`🧹 [DB_CLEAR] Deleted ${deleteResult.changes} weverse notifications`);
      
      // 위버스 타입 알림도 삭제 (혹시 있다면)
      const deleteWeverseType = this.db.prepare(`
        DELETE FROM notifications WHERE type = 'weverse'
      `).run();
      
      console.log(`🧹 [DB_CLEAR] Deleted ${deleteWeverseType.changes} weverse type notifications`);
      
      this.logSuccess('Weverse notification data cleared successfully');
    } catch (error) {
      this.logError('Failed to clear weverse notifications', error);
      throw error;
    }
  }

  async clearWeverseArtists(): Promise<void> {
    try {
      console.log('🧹 [DB_CLEAR] Clearing weverse artists...');
      
      const deleteResult = this.db.prepare(`
        DELETE FROM weverse_artists
      `).run();
      
      console.log(`🧹 [DB_CLEAR] Deleted ${deleteResult.changes} weverse artists`);
      
      this.logSuccess('Weverse artists data cleared successfully');
    } catch (error) {
      this.logError('Failed to clear weverse artists', error);
      throw error;
    }
  }

  async diagnosticWeverseDatabase(): Promise<{
    weverseArtistsTable: any[];
    notificationsWithWeverseArtist: any[];
    foreignKeyStatus: any;
    integrityCheck: any;
  }> {
    try {
      console.log('🔍 [DB_DIAGNOSTIC] Starting Weverse database diagnostic...');
      
      // 1. weverse_artists 테이블 전체 조회
      const weverseArtistsTable = this.db.prepare("SELECT * FROM weverse_artists ORDER BY id").all();
      console.log('📊 [DB_DIAGNOSTIC] weverse_artists table:', weverseArtistsTable);
      
      // 2. weverse_artist_id가 있는 알림 조회
      const notificationsWithWeverseArtist = this.db.prepare(`
        SELECT id, weverse_artist_id, type, title, created_at 
        FROM notifications 
        WHERE weverse_artist_id IS NOT NULL 
        ORDER BY created_at DESC 
        LIMIT 10
      `).all();
      console.log('📊 [DB_DIAGNOSTIC] notifications with weverse_artist_id:', notificationsWithWeverseArtist);
      
      // 3. FOREIGN KEY 설정 상태 확인
      const foreignKeyStatus = this.db.prepare("PRAGMA foreign_keys").get();
      console.log('📊 [DB_DIAGNOSTIC] FOREIGN KEY status:', foreignKeyStatus);
      
      // 4. 데이터베이스 무결성 검사
      const integrityCheck = this.db.prepare("PRAGMA integrity_check").get();
      console.log('📊 [DB_DIAGNOSTIC] Database integrity:', integrityCheck);
      
      // 5. 테이블 스키마 정보
      const weverseArtistsSchema = this.db.prepare("PRAGMA table_info(weverse_artists)").all();
      const notificationsSchema = this.db.prepare("PRAGMA table_info(notifications)").all();
      
      console.log('📊 [DB_DIAGNOSTIC] weverse_artists schema:', weverseArtistsSchema);
      console.log('📊 [DB_DIAGNOSTIC] notifications schema (weverse_artist_id):', 
        notificationsSchema.find((col: any) => col.name === 'weverse_artist_id'));
      
      return {
        weverseArtistsTable,
        notificationsWithWeverseArtist,
        foreignKeyStatus,
        integrityCheck
      };
      
    } catch (error) {
      console.error('❌ [DB_DIAGNOSTIC] Database diagnostic failed:', error);
      throw error;
    }
  }

  async resetWeverseNotificationsToLive(): Promise<void> {
    try {
      console.log('🔄 [DB_RESET] Resetting weverse notifications to live type...');
      
      // 위버스 URL을 가진 알림을 live 타입으로 변경
      const updateResult = this.db.prepare(`
        UPDATE notifications 
        SET type = 'live', 
            content = '[위버스] ' || content,
            title = CASE 
              WHEN title NOT LIKE '%위버스%' THEN title || ' (위버스)'
              ELSE title
            END
        WHERE url LIKE '%weverse.io%'
      `).run();
      
      console.log(`🔄 [DB_RESET] Updated ${updateResult.changes} weverse notifications to live type`);
      
      // 위버스 타입 알림도 live로 변경
      const updateWeverseType = this.db.prepare(`
        UPDATE notifications 
        SET type = 'live',
            content = '[위버스] ' || content,
            title = CASE 
              WHEN title NOT LIKE '%위버스%' THEN title || ' (위버스)'
              ELSE title
            END
        WHERE type = 'weverse'
      `).run();
      
      console.log(`🔄 [DB_RESET] Updated ${updateWeverseType.changes} weverse type notifications to live type`);
      
      this.logSuccess('Weverse notifications reset to live type successfully');
    } catch (error) {
      this.logError('Failed to reset weverse notifications', error);
      throw error;
    }
  }

  // 🧪 수동 INSERT 테스트 메서드
  async testManualWeverseInsert(notification: {
    artistName: string;
    uniqueKey: string;
    title: string;
    content: string;
    url: string;
    type: 'weverse';
    profileImageUrl?: string;
    isRead?: boolean;
  }): Promise<void> {
    try {
      console.log(`[DB_TEST] 🧪 Testing manual INSERT for uniqueKey: ${notification.uniqueKey}`);
      
      // 아티스트 ID 조회
      const artistResult = this.db.prepare(`
        SELECT id FROM weverse_artists WHERE artist_name = ?
      `).get(notification.artistName) as { id: number } | undefined;
      
      if (!artistResult) {
        console.error(`[DB_TEST] ❌ Artist not found: ${notification.artistName}`);
        return;
      }
      
      console.log(`[DB_TEST] 🎤 Found artist ID: ${artistResult.id}`);
      
      // 테스트용 고유 키 생성 (진단용)
      const testUniqueKey = `test_${notification.uniqueKey}_${Date.now()}`;
      const timestamp = new Date().toISOString();
      
      const weverseTitle = notification.title.includes('위버스') ? notification.title : `${notification.title} (위버스)`;
      const weverseContent = `[위버스] ${notification.content}`;
      
      console.log(`[DB_TEST] 📝 Test insert parameters:`, {
        streamer_id: -1,
        weverse_artist_id: artistResult.id,
        type: 'live',
        title: weverseTitle,
        content: weverseContent,
        content_html: weverseContent,
        url: notification.url,
        unique_key: testUniqueKey,
        profile_image_url: notification.profileImageUrl || null,
        is_read: notification.isRead ? 1 : 0,
        created_at: timestamp
      });
      
      // 수동 INSERT 시도
      const insertResult = this.db.prepare(`
        INSERT INTO notifications (
          streamer_id, weverse_artist_id, type, title, content, content_html, url, unique_key, profile_image_url, is_read, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        -1,
        artistResult.id,
        'live',
        weverseTitle,
        weverseContent,
        weverseContent,
        notification.url,
        testUniqueKey,
        notification.profileImageUrl || null,
        notification.isRead ? 1 : 0,
        timestamp
      );
      
      console.log(`[DB_TEST] 📊 Manual INSERT result:`, insertResult);
      
      if (insertResult.changes > 0) {
        console.log(`[DB_TEST] ✅ Manual INSERT successful - ID: ${insertResult.lastInsertRowid}`);
        
        // 삽입된 데이터 조회
        const insertedData = this.db.prepare(`
          SELECT * FROM notifications WHERE id = ?
        `).get(insertResult.lastInsertRowid);
        
        console.log(`[DB_TEST] 📋 Inserted data:`, insertedData);
        
        // 테스트 데이터 정리
        this.db.prepare(`DELETE FROM notifications WHERE id = ?`).run(insertResult.lastInsertRowid);
        console.log(`[DB_TEST] 🧹 Test data cleaned up`);
      } else {
        console.error(`[DB_TEST] ❌ Manual INSERT failed - no changes made`);
      }
      
    } catch (error) {
      console.error(`[DB_TEST] ❌ Manual INSERT test failed:`, error);
    }
  }

  /**
   * 기존 알림들의 uniqueKey 목록을 조회합니다.
   * @param daysBack 조회할 일수 (기본값: 7일)
   * @returns uniqueKey 배열
   */
  async getExistingUniqueKeys(daysBack: number = 7): Promise<string[]> {
    try {
      this.logInfo(`Getting existing unique keys for last ${daysBack} days...`);
      
      const query = `
        SELECT unique_key 
        FROM notifications 
        WHERE created_at > datetime('now', '-${daysBack} days')
        AND unique_key IS NOT NULL
        ORDER BY created_at DESC
      `;
      
      const result = this.db.prepare(query).all() as { unique_key: string }[];
      const uniqueKeys = result.map(row => row.unique_key);
      
      this.logSuccess(`Retrieved ${uniqueKeys.length} existing unique keys`);
      return uniqueKeys;
      
    } catch (error) {
      this.logError('Failed to get existing unique keys', error);
      return [];
    }
  }

  /**
   * 기존의 위버스 알림들을 'live' 타입에서 'weverse' 타입으로 마이그레이션
   */
  async migrateWeverseNotifications(): Promise<void> {
    try {
      this.logInfo('Starting Weverse notifications migration...');
      
      // 위버스 알림으로 추정되는 기존 'live' 타입 알림들을 찾기
      const candidateNotifications = this.db.prepare(`
        SELECT id, title, content, url, weverse_artist_id 
        FROM notifications 
        WHERE type = 'live' 
        AND streamer_id = -1 
        AND weverse_artist_id IS NOT NULL
        AND (
          title LIKE '%위버스%' OR 
          content LIKE '%[위버스]%' OR 
          url LIKE '%weverse.io%'
        )
      `).all() as Array<{
        id: number;
        title: string;
        content: string;
        url: string;
        weverse_artist_id: number;
      }>;

      if (candidateNotifications.length === 0) {
        this.logInfo('No Weverse notifications found to migrate');
        return;
      }

      this.logInfo(`Found ${candidateNotifications.length} Weverse notifications to migrate`);

      // 위버스 알림들을 'weverse' 타입으로 업데이트
      const updateStmt = this.db.prepare(`
        UPDATE notifications 
        SET type = 'weverse' 
        WHERE id = ?
      `);

      let migratedCount = 0;
      
      const transaction = this.db.transaction(() => {
        for (const notification of candidateNotifications) {
          const result = updateStmt.run(notification.id);
          if (result.changes > 0) {
            migratedCount++;
          }
        }
      });

      transaction();

      this.logSuccess(`Successfully migrated ${migratedCount} Weverse notifications from 'live' to 'weverse' type`);
      
    } catch (error) {
      this.logError('Failed to migrate Weverse notifications', error);
      throw error;
    }
  }

  /**
   * notifications 테이블을 재생성하여 CHECK 제약조건을 업데이트
   * SQLite는 ALTER TABLE로 CHECK 제약조건을 수정할 수 없으므로 테이블 재생성 방식 사용
   */
  private recreateNotificationsTableWithUpdatedConstraints(): void {
    this.logInfo('Starting notifications table recreation with updated constraints...');
    
    try {
      // 1. 기존 데이터 백업
      const backupData = this.db.prepare(`
        SELECT * FROM notifications ORDER BY id
      `).all();
      
      this.logInfo(`Backing up ${backupData.length} existing notifications`);
      
      // 2. 기존 인덱스 목록 저장
      const existingIndexes = this.db.prepare(`
        SELECT name, sql FROM sqlite_master 
        WHERE type = 'index' AND tbl_name = 'notifications' AND sql IS NOT NULL
      `).all();
      
      // 3. 기존 테이블 삭제
      this.db.exec(`DROP TABLE IF EXISTS notifications`);
      this.logInfo('Dropped old notifications table');
      
      // 4. 새 테이블 생성 (CHECK 제약조건 포함)
      this.db.exec(`
        CREATE TABLE notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          streamer_id INTEGER,
          weverse_artist_id INTEGER,
          type TEXT NOT NULL CHECK (type IN ('live', 'cafe', 'twitter', 'weverse', 'system')),
          title TEXT NOT NULL,
          content TEXT,
          content_html TEXT,
          url TEXT,
          unique_key TEXT UNIQUE,
          profile_image_url TEXT,
          is_read BOOLEAN DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
          FOREIGN KEY (weverse_artist_id) REFERENCES weverse_artists(id) ON DELETE CASCADE
        )
      `);
      this.logSuccess('Created new notifications table with updated CHECK constraint');
      
      // 5. 데이터 복원
      if (backupData.length > 0) {
        const insertStmt = this.db.prepare(`
          INSERT INTO notifications (
            id, streamer_id, weverse_artist_id, type, title, content, content_html, 
            url, unique_key, profile_image_url, is_read, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        let restoredCount = 0;
        for (const row of backupData) {
          try {
            const rowData = row as any;
            insertStmt.run(
              rowData.id, rowData.streamer_id, rowData.weverse_artist_id, rowData.type, rowData.title,
              rowData.content, rowData.content_html, rowData.url, rowData.unique_key,
              rowData.profile_image_url, rowData.is_read, rowData.created_at
            );
            restoredCount++;
          } catch (rowError) {
            this.logError(`Failed to restore notification ${(row as any).id}:`, rowError);
          }
        }
        
        this.logSuccess(`Restored ${restoredCount}/${backupData.length} notifications`);
      }
      
      // 6. 인덱스 재생성
      for (const index of existingIndexes) {
        try {
          const indexData = index as any;
          this.db.exec(indexData.sql);
          this.logInfo(`Recreated index: ${indexData.name}`);
        } catch (indexError) {
          this.logError(`Failed to recreate index ${(index as any).name}:`, indexError);
        }
      }
      
      this.logSuccess('Notifications table recreation completed');
      
    } catch (error) {
      this.logError('Failed to recreate notifications table:', error);
      throw error;
    }
  }

  /**
   * 실패한 Weverse 알림들을 재시도하여 저장
   */
  private retryFailedWeverseNotifications(): void {
    this.logInfo('Retrying failed Weverse notifications...');
    
    try {
      // CHECK 제약조건이 수정되었으므로 기존 migrateWeverseNotifications 로직을 재실행
      // 하지만 이미 'live' 타입의 Weverse 알림들이 있을 수 있으므로 다시 시도
      const candidateNotifications = this.db.prepare(`
        SELECT id, title, content, url, weverse_artist_id 
        FROM notifications 
        WHERE type = 'live' 
        AND streamer_id = -1 
        AND weverse_artist_id IS NOT NULL
        AND (
          title LIKE '%위버스%' OR 
          content LIKE '%[위버스]%' OR 
          url LIKE '%weverse.io%'
        )
      `).all() as Array<{
        id: number;
        title: string;
        content: string;
        url: string;
        weverse_artist_id: number;
      }>;

      if (candidateNotifications.length === 0) {
        this.logInfo('No failed Weverse notifications found to retry');
        return;
      }

      this.logInfo(`Found ${candidateNotifications.length} Weverse notifications to migrate from 'live' to 'weverse' type`);

      // 위버스 알림들을 'weverse' 타입으로 업데이트
      const updateStmt = this.db.prepare(`
        UPDATE notifications 
        SET type = 'weverse' 
        WHERE id = ?
      `);

      let migratedCount = 0;
      
      for (const notification of candidateNotifications) {
        try {
          const result = updateStmt.run(notification.id);
          if (result.changes > 0) {
            migratedCount++;
          }
        } catch (updateError) {
          this.logError(`Failed to update notification ${notification.id}:`, updateError);
        }
      }

      this.logSuccess(`Successfully migrated ${migratedCount}/${candidateNotifications.length} Weverse notifications to 'weverse' type`);
      
    } catch (error) {
      this.logError('Failed to retry Weverse notifications:', error);
      throw error;
    }
  }
}