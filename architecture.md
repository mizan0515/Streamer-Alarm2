# Streamer Alarm System 아키텍처 문서

## 📋 프로젝트 개요

### 프로젝트 정보
- **이름**: Streamer Alarm System
- **버전**: 2.1.0
- **설명**: 한국 VTuber 스트리머 모니터링 및 알림 시스템
- **라이선스**: MIT
- **개발 환경**: WSL2 (Windows Subsystem for Linux)
- **아키텍처 패턴**: Event-Driven Architecture, Singleton Pattern, Observer Pattern

### 핵심 비즈니스 로직
1. **실시간 모니터링**: 30초 간격으로 다중 플랫폼 동시 감시
2. **지능형 알림**: 중복 방지 및 컨텍스트 인식 알림 시스템
3. **자동 복구**: 네트워크 오류 및 시스템 장애 자동 복구
4. **메모리 최적화**: 동적 메모리 관리 및 자동 정리
5. **세션 관리**: 브라우저 세션 유지 및 자동 재인증

### 주요 기능
- **다중 플랫폼 모니터링**: Chzzk, Twitter, 네이버 카페, Weverse 통합 지원
- **실시간 방송 상태 알림**: 라이브 시작/종료 즉시 알림
- **소셜 미디어 활동 추적**: 트윗, 카페 게시물, 위버스 포스트 모니터링
- **데스크톱 알림 시스템**: 시스템 네이티브 알림 with 프로필 이미지
- **시스템 트레이 통합**: 백그라운드 실행 및 상태 표시
- **자동 시작 및 백그라운드 실행**: 시스템 부팅 시 자동 시작
- **지능형 중복 방지**: uniqueKey 기반 중복 알림 차단
- **컨텍스트 인식 알림**: 스트리머별, 플랫폼별 맞춤 알림
- **성능 모니터링**: 실시간 메모리, CPU, 네트워크 사용량 추적
- **에러 복구**: 서킷 브레이커 패턴 기반 자동 장애 복구

### 기술 스택 상세
#### 프론트엔드
- **React 18.2.0**: 함수형 컴포넌트 + Hooks 패턴
- **TypeScript 5.3.3**: 정적 타입 검사 및 타입 안전성
- **Tailwind CSS 3.3.6**: 유틸리티 퍼스트 CSS 프레임워크
- **React Router DOM 6.20.1**: 클라이언트 사이드 라우팅

#### 백엔드 & 시스템
- **Electron 28.1.0**: 크로스 플랫폼 데스크톱 앱 프레임워크
- **Node.js**: JavaScript 런타임 (Main Process)
- **Better-SQLite3 9.6.0**: 고성능 임베디드 데이터베이스
- **Playwright 1.40.1**: 브라우저 자동화 및 웹 스크래핑
- **Winston 3.17.0**: 구조화된 로깅 시스템

#### 네트워킹 & 데이터
- **Axios 1.6.2**: HTTP 클라이언트 (API 호출)
- **RSS Parser 3.13.0**: RSS 피드 파싱 (Twitter)
- **Node Notifier 10.0.1**: 크로스 플랫폼 데스크톱 알림

#### 빌드 시스템
- **Webpack 5.89.0**: 모듈 번들러 및 개발 서버
- **Electron Builder 24.9.1**: 크로스 플랫폼 패키징
- **TypeScript Compiler**: 정적 타입 검사 및 컴파일
- **ESLint**: 코드 품질 및 일관성 검사

## 🏗️ 전체 아키텍처

### Electron 멀티 프로세스 아키텍처
```
┌───────────────────────────────────────────────────────────────┐
│                         Main Process                         │
│                    (Node.js 환경 - 시스템 접근 권한)                │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ MonitoringService│  │ DatabaseManager │  │NotificationService│ │
│  │   (중앙 관리자)    │  │   (SQLite3)     │  │   (알림 엔진)     │ │
│  │ ・스케줄링         │  │ ・트랜잭션 관리   │  │ ・중복 방지       │ │
│  │ ・상태 동기화      │  │ ・스키마 마이그레이션│ │ ・프로필 이미지    │ │
│  │ ・에러 복구       │  │ ・인덱스 최적화   │  │ ・사용자 상호작용  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   TrayService   │  │  ErrorManager   │  │ MemoryManager   │ │
│  │  (시스템 트레이)   │  │  (에러 처리)     │  │  (메모리 최적화)  │ │
│  │ ・컨텍스트 메뉴    │  │ ・서킷 브레이커   │  │ ・LRU 캐시       │ │
│  │ ・상태 표시       │  │ ・백오프 전략     │  │ ・가비지 컬렉션   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ PlatformMonitors│  │PerformanceMonitor│ │ TimeoutConfig   │ │
│  │ ・ChzzkMonitor  │  │ ・메트릭 수집     │  │ ・동적 타임아웃   │ │
│  │ ・TwitterMonitor │  │ ・응답 시간 추적  │  │ ・메모리 기반 조정│ │
│  │ ・CafeMonitor   │  │ ・리소스 모니터링 │  │ ・재시도 로직     │ │
│  │ ・WeiverseMonitor│  │ ・임계값 관리     │  │ ・백오프 알고리즘 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└───────────────────────────────────────────────────────────────┘
                               ↕ IPC (안전한 메시지 채널)
┌───────────────────────────────────────────────────────────────┐
│                       Renderer Process                       │
│                   (Chrome 환경 - UI 렌더링)                     │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   React App     │  │  React Router   │  │  State Manager  │ │
│  │ ・컴포넌트 트리    │  │ ・클라이언트 라우팅│ │ ・전역 상태 관리  │ │
│  │ ・Hooks 패턴     │  │ ・네비게이션 관리  │ │ ・IPC 이벤트 동기화│ │
│  │ ・이벤트 핸들링   │  │ ・히스토리 관리    │  │ ・실시간 업데이트  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ UI Components   │  │   Pages Layer   │  │  Styles Layer   │ │
│  │ ・StreamerCard  │  │ ・스트리머 관리    │  │ ・Tailwind CSS  │ │
│  │ ・Sidebar       │  │ ・알림 기록       │  │ ・반응형 디자인   │ │
│  │ ・AddStreamerForm││ ・설정 관리       │  │ ・다크/라이트 테마│ │
│  │ ・NotificationCard│ │ ・위버스 관리     │  │ ・CSS 모듈       │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### 보안 아키텍처
#### Context Isolation (컨텍스트 격리)
- **활성화**: 렌더러 프로세스와 Node.js 환경 완전 분리
- **효과**: XSS 공격 방지, 메모리 오염 차단
- **구현**: `contextIsolation: true`

#### Node Integration 비활성화
- **설정**: `nodeIntegration: false`
- **목적**: 렌더러에서 직접 Node.js API 접근 차단
- **대안**: Preload Script를 통한 안전한 API 노출

#### Preload Script 브리지
- **역할**: Main-Renderer 간 안전한 통신 브리지
- **검증**: 모든 IPC 메시지 타입 검증 및 새니타이징
- **API 노출**: 필요한 기능만 선별적으로 노출

#### 추가 보안 조치
- **Single Instance Lock**: 애플리케이션 중복 실행 방지
- **URL 검증**: 외부 링크 열기 전 안전성 검증
- **파일 시스템 접근 제한**: 사용자 데이터 디렉토리만 접근 허용
- **민감 정보 보호**: 로그인 토큰 암호화 저장

## 📁 디렉토리 구조

```
src/
├── main/                    # 메인 프로세스 (Node.js)
│   ├── main.ts             # 애플리케이션 진입점
│   ├── preload.ts          # 프리로드 스크립트
│   ├── services/           # 핵심 서비스들
│   │   ├── MonitoringService.ts      # 중앙 모니터링 관리자
│   │   ├── DatabaseManager.ts       # 데이터베이스 관리
│   │   ├── NotificationService.ts   # 알림 시스템
│   │   ├── ChzzkMonitor.ts         # 치지직 모니터링
│   │   ├── TwitterMonitor.ts       # 트위터 모니터링
│   │   ├── CafeMonitor.ts          # 네이버 카페 모니터링
│   │   ├── WeiverseMonitor.ts      # 위버스 모니터링
│   │   ├── TrayService.ts          # 시스템 트레이 서비스
│   │   ├── SettingsService.ts      # 설정 관리
│   │   ├── StreamerSearchService.ts # 스트리머 검색
│   │   ├── ErrorManager.ts         # 에러 관리
│   │   ├── MemoryManager.ts        # 메모리 관리
│   │   ├── PerformanceMonitor.ts   # 성능 모니터링
│   │   ├── TimeoutConfig.ts        # 타임아웃 설정
│   │   ├── CategoryLogger.ts       # 카테고리별 로깅
│   │   └── SessionManager.ts       # 세션 관리
│   ├── types/              # 메인 프로세스 타입 정의
│   └── utils/              # 메인 프로세스 유틸리티
├── renderer/               # 렌더러 프로세스 (React)
│   ├── App.tsx            # React 애플리케이션 루트
│   ├── index.tsx          # 렌더러 진입점
│   ├── index.html         # HTML 템플릿
│   ├── components/        # React 컴포넌트
│   │   ├── Sidebar.tsx                 # 사이드바 네비게이션
│   │   ├── StreamerCard.tsx           # 스트리머 카드
│   │   ├── AddStreamerForm.tsx        # 스트리머 추가 폼
│   │   ├── DonationWidget.tsx         # 후원 위젯
│   │   ├── WeverseArtistCard.tsx      # 위버스 아티스트 카드
│   │   └── WeverseArtistManagement.tsx # 위버스 관리
│   ├── pages/             # 페이지 컴포넌트
│   │   ├── StreamerManagement.tsx     # 스트리머 관리
│   │   ├── NotificationHistory.tsx    # 알림 기록
│   │   ├── Settings.tsx               # 설정
│   │   └── WeverseManagement.tsx      # 위버스 관리
│   ├── styles/            # 스타일 파일
│   │   └── global.css     # 전역 스타일
│   ├── types/             # 렌더러 타입 정의
│   └── utils/             # 렌더러 유틸리티
└── shared/                # 공유 리소스
    ├── types/             # 공유 타입 정의
    │   └── index.ts       # 메인 타입 정의 파일
    ├── components/        # 공유 컴포넌트
    └── utils/             # 공유 유틸리티
```

## 🔧 핵심 서비스 아키텍처 상세 분석

### 1. MonitoringService (중앙 오케스트레이터)
```typescript
class MonitoringService {
  // 의존성 주입 컨테이너
  private databaseManager: DatabaseManager;
  private notificationService: NotificationService;
  private settingsService: SettingsService;
  
  // 플랫폼별 모니터링 서비스
  public chzzkMonitor: ChzzkMonitor;
  private twitterMonitor: TwitterMonitor;
  private cafeMonitor: CafeMonitor;
  private weverseMonitor: WeiverseMonitor;
  
  // 시스템 관리 서비스
  private memoryMonitor: MemoryMonitor;
  private cleanupScheduler: CleanupScheduler;
  private timeoutConfig: TimeoutConfig;
  private errorManager: ErrorManager;
  private performanceMonitor: PerformanceMonitor;
  
  // 상태 관리
  private isRunning: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastMonitoringTime: number = 0;
  private sleepDetectionThreshold = 600000; // 10분
  private isInitialStart: boolean = true;
  
  // 세션 관리
  private lastWeverseSessionCheck: number = 0;
  private weverseSessionCheckInterval = 10 * 60 * 1000; // 10분
  private naverLoginStatus: boolean | null = null;
  
  // 핵심 메서드
  + async start(): Promise<boolean>              // 모니터링 시작
  + async stop(): Promise<boolean>               // 모니터링 중지
  + async performMonitoringCheck(): Promise<void> // 단일 모니터링 사이클
  + getLiveStatus(): LiveStatus[]                 // 라이브 상태 조회
  + getMonitoringStats(): MonitoringStats         // 통계 정보
  + async recoverMissedNotifications(): Promise<void> // 누락 알림 복구
  + performEmergencyCleanup(): void               // 긴급 메모리 정리
}
```

#### 핵심 책임 및 역할

##### 🎯 생명주기 관리
- **서비스 초기화**: 모든 모니터링 서비스의 순차적 초기화
- **의존성 주입**: 각 서비스에 필요한 의존성 자동 주입
- **상태 복원**: 앱 재시작 시 이전 모니터링 상태 복원
- **우아한 종료**: 진행 중인 작업 완료 후 안전한 종료

##### ⏰ 스케줄링 시스템
- **주기적 실행**: 기본 30초 간격 (설정 가능)
- **동적 조정**: 메모리 압박 시 간격 자동 조정
- **슬립 모드 감지**: 10분 이상 비활성 시 시스템 슬립 감지
- **복구 로직**: 슬립 모드 해제 시 자동 복구 및 재시작

##### 🔄 상태 동기화
- **이벤트 기반 아키텍처**: Observer 패턴으로 상태 변화 전파
- **실시간 업데이트**: UI와 실시간 상태 동기화
- **크로스 서비스 통신**: 서비스 간 상태 공유 및 조율
- **일관성 보장**: 분산 상태의 일관성 유지

##### 🛡️ 에러 처리 및 복구
- **서킷 브레이커**: 연속 실패 시 서비스 일시 차단
- **백오프 전략**: 지수적 백오프로 재시도 간격 조정
- **자동 복구**: 네트워크/인증 오류 자동 해결
- **장애 격리**: 한 서비스 장애가 전체에 전파되지 않도록 격리

##### 🚀 성능 최적화
- **메모리 관리**: 실시간 메모리 사용량 모니터링 및 자동 정리
- **리소스 풀링**: 연결 재사용 및 리소스 효율성 최적화
- **병렬 처리**: 플랫폼별 모니터링 병렬 실행
- **캐싱 전략**: LRU 캐시로 중복 요청 최소화

#### 🔄 모니터링 플로우 상세
```
1. 초기화 단계 (앱 시작 시)
   ├── 의존성 주입 및 서비스 초기화
   ├── 이전 상태 복원 (monitor_states 테이블)
   ├── 기준선 설정 (새 스트리머 무음 모드)
   └── 누락 알림 복구 (앱 재시작 감지)

2. 정기 모니터링 사이클 (30초마다)
   ├── 메모리 사용량 확인
   ├── 플랫폼별 병렬 체크
   │   ├── Chzzk: API 호출 (라이브 상태)
   │   ├── Twitter: RSS 피드 파싱
   │   ├── Cafe: Playwright 스크래핑
   │   └── Weverse: 브라우저 세션 체크
   ├── 새 활동 감지 및 알림 생성
   ├── 상태 데이터베이스 업데이트
   ├── UI 실시간 업데이트 (IPC 이벤트)
   └── 성능 메트릭 수집

3. 에러 발생 시
   ├── 에러 분류 (network, timeout, auth, parsing)
   ├── 서킷 브레이커 상태 확인
   ├── 백오프 전략 적용
   ├── 자동 복구 시도
   └── UI 상태 업데이트

4. 메모리 압박 시
   ├── 캐시 정리 (LRU 만료 항목)
   ├── 가비지 컬렉션 강제 실행
   ├── 타임아웃 단축
   └── 브라우저 세션 재시작
```

#### 🎛️ 고급 기능

##### 슬립 모드 복구
```typescript
// 시스템 슬립 감지 로직
if (Date.now() - this.lastMonitoringTime > this.sleepDetectionThreshold) {
  console.log('🛌 Sleep mode detected, recovering monitoring state...');
  await this.recoverFromSleep();
}
```

##### 세션 관리
- **위버스 세션**: 10분마다 세션 유효성 검사
- **네이버 로그인**: 자동 로그인 상태 모니터링
- **브라우저 컨텍스트**: 메모리 압박 시 자동 재생성

##### 누락 알림 복구
- **앱 재시작 감지**: `isInitialStart` 플래그 기반
- **시간 기반 복구**: 마지막 체크 이후 누락된 활동 감지
- **중복 방지**: 이미 처리된 알림과 신규 알림 구분

### 2. DatabaseManager (데이터 관리 엔진)
```typescript
class DatabaseManager {
  // 데이터베이스 연결 관리
  private db!: Database.Database;
  private dbPath: string;
  private readonly CURRENT_SCHEMA_VERSION = 4;
  
  // 트랜잭션 관리
  private preparedStatements = new Map<string, Statement>();
  private transactionMode: 'auto' | 'manual' = 'auto';
  
  // 로깅 시스템
  private logInfo(message: string, data?: any): void;
  private logError(message: string, error?: any): void;
  private logSchema(message: string, data?: any): void;
  private logQuery(message: string, query?: string): void;
  
  // 초기화 및 마이그레이션
  + async initialize(): Promise<void>                    // 데이터베이스 초기화
  + createTables(): void                                // 테이블 생성
  + performMigration(): void                           // 스키마 마이그레이션
  + forceAddMissingColumns(): void                     // 누락 컬럼 강제 추가
  
  // 스트리머 관리
  + getStreamers(): StreamerData[]                     // 전체 스트리머 조회
  + addStreamer(data: Omit<StreamerData, 'id'>): StreamerData // 스트리머 추가
  + updateStreamer(data: StreamerData): StreamerData   // 스트리머 정보 수정
  + deleteStreamer(id: number): boolean                // 스트리머 삭제
  + updateStreamerProfileImage(id: number, url: string): void // 프로필 이미지 업데이트
  
  // 알림 관리
  + getNotifications(options: GetNotificationsOptions): NotificationRecord[] // 알림 조회
  + saveNotification(notification: NotificationData): void   // 알림 저장
  + markNotificationRead(id: number): void                  // 알림 읽음 처리
  + markAllNotificationsRead(): void                        // 전체 알림 읽음 처리
  + deleteAllNotifications(): void                          // 전체 알림 삭제
  + getUnreadNotificationCount(): number                    // 미읽음 알림 수
  
  // 설정 관리
  + getSetting(key: SettingKey): string | null             // 설정 조회
  + setSetting(key: SettingKey, value: string): void       // 설정 저장
  + getAllSettings(): Record<string, string>               // 전체 설정 조회
  
  // 모니터링 상태 관리
  + initializeMonitorStates(): Promise<void>               // 모니터링 상태 초기화
  + updateMonitorState(streamerId: number, platform: string, data: any): void // 상태 업데이트
  + getMonitorState(streamerId: number, platform: string): any // 상태 조회
  
  // 위버스 관리
  + getWeverseArtists(): WeverseArtist[]                   // 위버스 아티스트 조회
  + addWeverseArtist(artistName: string): WeverseArtist    // 아티스트 추가
  + updateWeverseArtist(data: Partial<WeverseArtist>): void // 아티스트 정보 수정
  + deleteWeverseArtist(id: number): boolean               // 아티스트 삭제
}
```

#### 🗄️ 데이터베이스 스키마 상세 설계

##### 📊 테이블 구조 및 관계
```sql
-- 스트리머 정보 테이블
CREATE TABLE streamers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,                    -- 스트리머 이름 (유니크)
  chzzk_id TEXT,                               -- 치지직 채널 ID
  twitter_username TEXT,                       -- 트위터 사용자명
  naver_cafe_user_id TEXT,                     -- 네이버 카페 사용자 ID
  cafe_club_id TEXT DEFAULT '30919539',        -- 네이버 카페 클럽 ID
  profile_image_url TEXT,                      -- 프로필 이미지 URL
  is_active BOOLEAN DEFAULT 1,                 -- 활성화 상태
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 알림 설정 테이블 (스트리머별 플랫폼 설정)
CREATE TABLE notification_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('chzzk', 'cafe', 'twitter', 'weverse')),
  enabled BOOLEAN DEFAULT 1,
  FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
  UNIQUE(streamer_id, platform)                -- 복합 유니크 제약
);

-- 위버스 아티스트 테이블
CREATE TABLE weverse_artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_name TEXT UNIQUE NOT NULL,            -- 아티스트 이름
  profile_image_url TEXT,                      -- 프로필 이미지 URL
  is_enabled BOOLEAN DEFAULT 1,               -- 알림 활성화 여부
  last_notification_id TEXT,                   -- 마지막 처리된 알림 ID
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 알림 기록 테이블 (중앙 집중식)
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_id INTEGER,                         -- 스트리머 연결 (nullable)
  weverse_artist_id INTEGER,                   -- 위버스 아티스트 연결 (nullable)
  type TEXT NOT NULL,                          -- 알림 타입: live, cafe, twitter, weverse, system
  title TEXT NOT NULL,                         -- 알림 제목
  content TEXT,                               -- 알림 내용 (텍스트)
  content_html TEXT,                          -- 알림 내용 (HTML)
  url TEXT,                                   -- 관련 URL
  unique_key TEXT UNIQUE,                     -- 중복 방지 키
  profile_image_url TEXT,                     -- 알림별 프로필 이미지
  is_read BOOLEAN DEFAULT 0,                  -- 읽음 상태
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
  FOREIGN KEY (weverse_artist_id) REFERENCES weverse_artists(id) ON DELETE CASCADE
);

-- 애플리케이션 설정 테이블
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,                        -- 설정 키
  value TEXT NOT NULL,                         -- 설정 값 (JSON 문자열 가능)
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 모니터링 전역 상태 테이블
CREATE TABLE monitoring_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),       -- 싱글톤 레코드
  last_check_time TIMESTAMP,                   -- 마지막 체크 시간
  is_monitoring BOOLEAN DEFAULT 1,             -- 모니터링 활성 상태
  last_recovery_time TIMESTAMP                 -- 마지막 복구 시간
);

-- 모니터링 세부 상태 테이블 (스트리머별, 플랫폼별)
CREATE TABLE monitor_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('chzzk', 'cafe', 'twitter', 'weverse')),
  last_content_id TEXT,                        -- 마지막 처리된 콘텐츠 ID
  last_check_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_status TEXT,                           -- 마지막 상태 (JSON)
  FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
  UNIQUE(streamer_id, platform)
);

-- 스키마 버전 관리 테이블
CREATE TABLE schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),       -- 싱글톤 레코드
  version INTEGER NOT NULL,                    -- 현재 스키마 버전
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

##### 🔍 인덱싱 전략
```sql
-- 성능 최적화를 위한 인덱스
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);  -- 시간순 정렬
CREATE INDEX idx_notifications_type ON notifications(type);                   -- 타입별 필터링
CREATE INDEX idx_notifications_unique_key ON notifications(unique_key);       -- 중복 체크
CREATE INDEX idx_notifications_is_read ON notifications(is_read);              -- 읽음 상태 필터링
CREATE INDEX idx_notifications_weverse_artist_id ON notifications(weverse_artist_id); -- 위버스 관계
CREATE INDEX idx_streamers_active ON streamers(is_active);                    -- 활성 스트리머
CREATE INDEX idx_monitor_states_streamer_platform ON monitor_states(streamer_id, platform); -- 복합 검색
CREATE INDEX idx_weverse_artists_enabled ON weverse_artists(is_enabled);      -- 활성 아티스트
```

##### 🔄 자동 트리거 시스템
```sql
-- updated_at 자동 갱신 트리거
CREATE TRIGGER update_streamers_timestamp 
AFTER UPDATE ON streamers
BEGIN
  UPDATE streamers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER update_settings_timestamp 
AFTER UPDATE ON app_settings
BEGIN
  UPDATE app_settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
END;

CREATE TRIGGER update_weverse_artists_timestamp 
AFTER UPDATE ON weverse_artists
BEGIN
  UPDATE weverse_artists SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
```

#### 🔧 고급 데이터베이스 기능

##### 스키마 마이그레이션 시스템
- **버전 관리**: `schema_version` 테이블로 현재 버전 추적
- **점진적 업그레이드**: 버전별 마이그레이션 스크립트 실행
- **롤백 지원**: 마이그레이션 실패 시 이전 상태로 복구
- **강제 컬럼 추가**: 기존 DB에 누락된 컬럼 자동 감지 및 추가

##### WAL 모드 최적화
- **성능 향상**: Write-Ahead Logging으로 동시성 개선
- **트랜잭션 격리**: 읽기 작업이 쓰기 작업을 차단하지 않음
- **크래시 복구**: 시스템 크래시 시 데이터 무결성 보장

##### Prepared Statement 캐싱
- **성능 최적화**: 자주 사용되는 쿼리 사전 컴파일
- **SQL 인젝션 방지**: 파라미터화된 쿼리로 보안 강화
- **메모리 효율성**: Statement 재사용으로 메모리 절약

### 3. Platform Monitors (플랫폼별 모니터링 시스템)

각 플랫폼별 모니터는 독립적으로 동작하면서도 공통된 인터페이스와 에러 처리 메커니즘을 공유합니다.

#### 🎮 ChzzkMonitor (치지직 모니터링)
```typescript
class ChzzkMonitor {
  private httpClient: AxiosInstance;
  private previousLiveStatus: LRUCache<string, boolean>;
  private previousLiveTitle: LRUCache<string, string>;
  private timeoutConfig: TimeoutConfig;

  // 핵심 기능
  + async checkAllStreamers(silentMode?: boolean): Promise<LiveStatus[]>
  + async checkStreamerLiveStatus(streamerId: string): Promise<ChzzkLiveResponse>
  + async updateStreamerProfileImage(streamerId: number, chzzkId: string): Promise<void>
  + async getChannelInfo(channelId: string): Promise<ChzzkChannelResponse>
}
```

**특징:**
- **API 기반 모니터링**: 공식 치지직 API 사용으로 안정적 데이터 수집
- **실시간 라이브 감지**: 방송 시작/종료 즉시 감지 및 알림
- **동적 프로필 업데이트**: 스트리머 프로필 이미지 자동 동기화
- **LRU 캐시 활용**: 이전 상태 비교로 중복 알림 방지
- **동적 타임아웃**: 메모리 압박 시 타임아웃 자동 조정

**모니터링 플로우:**
```
1. 활성 스트리머 목록 조회 (DB에서 is_active=true 필터링)
2. 병렬 API 호출 (Promise.allSettled로 장애 격리)
3. 라이브 상태 변화 감지 (이전 상태와 비교)
4. 새 방송 감지 시:
   - 알림 데이터 생성 (uniqueKey: `chzzk-live-${streamerId}-${timestamp}`)
   - NotificationService로 알림 전송
   - 데이터베이스 상태 업데이트
5. 프로필 이미지 변경 감지 시 자동 업데이트
```

#### 🐦 TwitterMonitor (트위터 모니터링)
```typescript
class TwitterMonitor {
  private rssParser: Parser;
  private httpClient: AxiosInstance;
  private lastTweetCache: LRUCache<string, string>;
  private timeoutConfig: TimeoutConfig;

  // 핵심 기능
  + async checkAllStreamers(silentMode?: boolean): Promise<void>
  + async checkStreamerTweets(streamer: StreamerData): Promise<void>
  + private async fetchRSSFeed(username: string): Promise<TwitterTweet[]>
  + private parseTwitterContent(content: string): { text: string; html: string }
}
```

**특징:**
- **RSS 피드 기반**: Twitter의 비공식 RSS 피드 활용
- **HTML 파싱**: 트윗 내용의 텍스트/HTML 분리 처리
- **중복 필터링**: 트윗 ID 기반 중복 트윗 제거
- **시간 기반 필터링**: 새 스트리머의 과거 트윗 무시 (설정 가능)
- **에러 처리**: RSS 피드 장애 시 자동 복구

**모니터링 플로우:**
```
1. 스트리머별 RSS URL 생성 (https://nitter.net/{username}/rss)
2. RSS 피드 파싱 및 최신 트윗 추출
3. 새 트윗 감지 (마지막 트윗 ID와 비교)
4. 콘텐츠 파싱:
   - HTML 태그 제거 (텍스트 버전)
   - 링크/멘션 처리 (HTML 버전)
5. 알림 생성 및 전송
```

#### ☕ CafeMonitor (네이버 카페 모니터링)
```typescript
class CafeMonitor {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionManager: SessionManager;
  private lastPostCache: LRUCache<string, string>;

  // 핵심 기능
  + async initialize(): Promise<void>
  + async checkAllStreamers(silentMode?: boolean): Promise<void>
  + async checkStreamerPosts(streamer: StreamerData): Promise<void>
  + async ensureLoggedIn(): Promise<boolean>
  + async restartBrowser(): Promise<void>
}
```

**특징:**
- **Playwright 기반**: 실제 브라우저 자동화로 정확한 스크래핑
- **세션 관리**: 네이버 로그인 상태 자동 유지 및 갱신
- **동적 콘텐츠 처리**: JavaScript 렌더링된 콘텐츠 정확 추출
- **메모리 최적화**: 메모리 압박 시 브라우저 자동 재시작
- **에러 복구**: 로그인 실패 시 자동 재인증 시도

**모니터링 플로우:**
```
1. 브라우저 세션 상태 확인
2. 로그인 필요 시 자동 인증
3. 스트리머별 카페 게시글 페이지 이동
4. DOM 파싱으로 최신 게시글 추출
5. 새 게시글 감지 (제목, 작성시간 비교)
6. 게시글 메타데이터 수집:
   - 제목, 작성자, 작성시간
   - 게시글 URL
   - 미리보기 이미지 (가능한 경우)
7. 알림 생성 및 전송
```

#### 🌟 WeiverseMonitor (위버스 모니터링)
```typescript
class WeiverseMonitor {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private sessionManager: SessionManager;
  private lastNotificationCache: LRUCache<string, string>;

  // 핵심 기능
  + async initialize(): Promise<void>
  + async checkWeverseNotifications(silentMode?: boolean): Promise<void>
  + async refreshArtistList(): Promise<WeverseArtist[]>
  + async ensureLoggedIn(): Promise<boolean>
  + private async parseNotificationElements(elements: ElementHandle[]): Promise<WeverseNotification[]>
}
```

**특징:**
- **브라우저 세션 관리**: 위버스 로그인 상태 유지
- **다중 아티스트 지원**: 여러 아티스트 동시 모니터링
- **실시간 알림 감지**: 위버스 알림 페이지 모니터링
- **아티스트 자동 발견**: 새 아티스트 자동 감지 및 추가
- **세션 복구**: 세션 만료 시 자동 재로그인

**모니터링 플로우:**
```
1. 위버스 알림 페이지 접근
2. 로그인 상태 확인 및 필요시 재인증
3. 아티스트별 최신 알림 수집
4. 새 알림 감지 (알림 ID 기반)
5. 알림 상세 정보 추출:
   - 아티스트명, 알림 타입
   - 제목, 내용, 시간
   - 관련 URL 및 이미지
6. 알림 생성 및 전송
```

### 4. NotificationService (지능형 알림 엔진)
```typescript
class NotificationService {
  private databaseManager: DatabaseManager;
  private settingsService: SettingsService;
  private activeNotifications: Map<string, NotificationData>;
  private processedNotifications: Set<string>;
  private profileImageCache: LRUCache<string, string>;

  // 핵심 기능
  + async sendNotification(data: NotificationData): Promise<void>
  + async sendTestNotification(): Promise<boolean>
  + private async downloadProfileImage(url: string): Promise<string>
  + private generateUniqueKey(data: NotificationData): string
  + private async handleNotificationClick(url?: string): Promise<void>
}
```

#### 🧠 지능형 중복 방지 시스템
```typescript
// uniqueKey 생성 로직
private generateUniqueKey(data: NotificationData): string {
  switch (data.type) {
    case 'live':
      // 라이브 방송은 스트리머+시간대 기준 (1시간 단위 그룹화)
      const hourGroup = Math.floor(Date.now() / (60 * 60 * 1000));
      return `chzzk-live-${data.streamerName}-${hourGroup}`;
    
    case 'twitter':
      // 트위터는 콘텐츠 해시 기준
      return `twitter-${data.streamerName}-${this.hashContent(data.content)}`;
    
    case 'cafe':
      // 카페는 게시글 URL 기준
      return `cafe-${data.streamerName}-${this.hashUrl(data.url)}`;
    
    case 'weverse':
      // 위버스는 알림 ID 기준
      return `weverse-${data.streamerName}-${data.originalTimestamp}`;
  }
}
```

#### 🖼️ 동적 프로필 이미지 처리
- **자동 다운로드**: 프로필 이미지 URL에서 로컬 임시 파일로 다운로드
- **캐시 관리**: LRU 캐시로 중복 다운로드 방지
- **형식 변환**: 다양한 이미지 형식을 시스템 알림 호환 형식으로 변환
- **오류 처리**: 이미지 다운로드 실패 시 기본 아이콘 사용

#### 🎯 사용자 상호작용
```typescript
// 알림 클릭 처리
private async handleNotificationClick(url?: string): Promise<void> {
  if (url) {
    // 외부 브라우저에서 URL 열기
    await shell.openExternal(url);
    
    // 클릭 통계 수집 (향후 개선을 위한 데이터)
    this.performanceMonitor.recordUserInteraction('notification_click', {
      url: url,
      timestamp: Date.now()
    });
  }
}
```

### 5. TrayService (시스템 트레이 인터페이스)
```typescript
class TrayService {
  private app: StreamerAlarmApp;
  private tray: Tray | null = null;
  private monitoringService: MonitoringService;
  private contextMenuTemplate: MenuItemConstructorOptions[];

  // 핵심 기능
  + createTray(): Tray
  + updateContextMenu(stats?: MonitoringStats): void
  + showContextMenu(): void
  + private createMenuTemplate(stats?: MonitoringStats): MenuItemConstructorOptions[]
}
```

#### 📋 동적 컨텍스트 메뉴
```typescript
private createMenuTemplate(stats?: MonitoringStats): MenuItemConstructorOptions[] {
  return [
    {
      label: `🔴 라이브: ${stats?.liveStreamers || 0}명`,
      enabled: false
    },
    {
      label: `👥 총 스트리머: ${stats?.totalStreamers || 0}명`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: stats?.isMonitoring ? '⏸️ 모니터링 중지' : '▶️ 모니터링 시작',
      click: () => this.toggleMonitoring()
    },
    {
      label: '🌐 네이버 로그인',
      click: () => this.handleNaverLogin()
    },
    { type: 'separator' },
    {
      label: '📊 메인 창 표시',
      click: () => this.app.showMainWindow()
    },
    {
      label: '❌ 종료',
      click: () => this.app.quit()
    }
  ];
}
```

### 6. 시스템 관리 서비스들

#### 🛡️ ErrorManager (통합 에러 관리)
```typescript
class ErrorManager {
  private static instance: ErrorManager;
  private errorStats = {
    network: { count: 0, lastOccurred: 0, consecutive: 0 },
    timeout: { count: 0, lastOccurred: 0, consecutive: 0 },
    browser: { count: 0, lastOccurred: 0, consecutive: 0 },
    auth: { count: 0, lastOccurred: 0, consecutive: 0 },
    parsing: { count: 0, lastOccurred: 0, consecutive: 0 },
    unknown: { count: 0, lastOccurred: 0, consecutive: 0 }
  };

  // 서킷 브레이커 관리
  private serviceErrors = new Map<string, {
    errorCount: number;
    lastErrorTime: number;
    isHealthy: boolean;
    consecutiveFailures: number;
    circuitBreakerOpen: boolean;
    nextRetryTime: number;
  }>();

  + handleError(service: string, error: Error): RecoveryAction
  + isServiceHealthy(service: string): boolean
  + shouldRetry(service: string): boolean
  + classifyError(error: Error): ErrorType
}
```

**에러 분류 및 복구 전략:**
- **네트워크 에러**: 지수적 백오프로 재시도 (최대 3회)
- **타임아웃 에러**: 타임아웃 값 동적 조정 후 재시도
- **브라우저 에러**: 브라우저 세션 재시작
- **인증 에러**: 자동 재로그인 시도
- **파싱 에러**: 페이지 구조 변경 감지 후 복구 시도

#### 🧠 MemoryManager (메모리 최적화)
```typescript
class MemoryManager {
  private static instance: MemoryManager;
  private memoryThresholds = {
    warning: 512 * 1024 * 1024,   // 512MB
    critical: 1024 * 1024 * 1024, // 1GB  
    emergency: 1536 * 1024 * 1024 // 1.5GB
  };

  + startMonitoring(intervalMs: number): void
  + onMemoryAlert(callback: Function): void
  + performCleanup(level: CleanupLevel): void
  + getMemoryUsage(): NodeJS.MemoryUsage
}
```

**메모리 최적화 전략:**
- **경고 단계 (512MB)**: 캐시 부분 정리, GC 권장
- **위험 단계 (1GB)**: 캐시 전체 정리, GC 강제 실행
- **응급 단계 (1.5GB)**: 브라우저 재시작, 전체 서비스 재시작 고려

#### ⚡ PerformanceMonitor (성능 모니터링)
```typescript
class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics = {
    monitoring: {
      chzzkResponseTime: [] as number[],
      twitterResponseTime: [] as number[],
      cafeResponseTime: [] as number[],
      weverseResponseTime: [] as number[],
      totalMonitoringCycles: 0,
      successfulCycles: 0
    },
    system: {
      memoryUsageHistory: [] as Array<{ timestamp: number; usage: number; level: string }>,
      cpuUsageHistory: [] as Array<{ timestamp: number; usage: number }>,
      networkLatency: [] as number[]
    },
    errors: {
      errorRateByService: new Map<string, Array<{ timestamp: number; count: number }>>(),
      circuitBreakerActivations: 0,
      criticalFailures: 0
    }
  };

  + recordServiceResponseTime(service: string, responseTime: number): void
  + recordMemoryUsage(usage: NodeJS.MemoryUsage, level: string): void
  + recordError(service: string, errorType: string): void
  + generatePerformanceReport(): PerformanceReport
}
```

**성능 메트릭 수집:**
- **응답 시간**: 각 플랫폼별 API/스크래핑 응답 시간
- **메모리 사용량**: RSS, Heap, External 메모리 추적
- **에러율**: 서비스별 성공/실패 비율
- **사용자 경험**: 알림 전달 시간, UI 응답성

#### ⏱️ TimeoutConfig (동적 타임아웃 관리)
```typescript
class TimeoutConfig {
  private static instance: TimeoutConfig;
  private baseTimeouts = new Map<string, number>([
    ['chzzk_api', 10000],        // 치지직 API: 10초
    ['twitter_rss', 15000],      // 트위터 RSS: 15초
    ['cafe_scraping', 30000],    // 카페 스크래핑: 30초
    ['weverse_session', 25000],  // 위버스 세션: 25초
    ['profile_download', 8000]   // 프로필 다운로드: 8초
  ]);
  
  private currentTimeouts = new Map<string, number>();
  private memoryPressureLevel: string = 'normal';

  + getTimeout(operation: string): number
  + updateMemoryPressure(level: string): void
  + adjustForRetry(operation: string, retryCount: number): number
  + getHttpTimeout(service: string): number
}
```

**동적 타임아웃 조정:**
- **메모리 기반 조정**: 메모리 압박 시 타임아웃 20-50% 단축
- **재시도 기반 조정**: 재시도 횟수에 따른 지수적 백오프
- **서비스별 최적화**: 각 플랫폼 특성에 맞는 타임아웃 설정
- **네트워크 상태 반영**: 연결 품질에 따른 동적 조정

## 🔄 데이터 흐름 및 상호작용

### 1. 애플리케이션 시작 플로우
```
🚀 Application Startup
├── 1. Main Process 초기화
│   ├── SingleInstanceLock 확인
│   ├── 사용자 데이터 디렉토리 설정
│   └── Context Isolation 설정
├── 2. 데이터베이스 초기화
│   ├── SQLite 연결 및 WAL 모드 활성화
│   ├── 스키마 마이그레이션 실행
│   ├── 인덱스 및 트리거 생성
│   └── 기본 설정 데이터 삽입
├── 3. 핵심 서비스 초기화
│   ├── ErrorManager (싱글톤)
│   ├── MemoryManager (싱글톤)
│   ├── PerformanceMonitor (싱글톤)
│   ├── TimeoutConfig (싱글톤)
│   ├── NotificationService
│   └── TrayService
├── 4. 플랫폼 모니터 초기화
│   ├── ChzzkMonitor (HTTP 클라이언트)
│   ├── TwitterMonitor (RSS 파서)
│   ├── CafeMonitor (Playwright 브라우저)
│   └── WeiverseMonitor (Playwright 브라우저)
├── 5. MonitoringService 시작
│   ├── 이전 상태 복원 (monitor_states)
│   ├── 기준선 설정 (새 스트리머 무음 모드)
│   ├── 누락 알림 복구
│   └── 정기 모니터링 시작 (30초 간격)
└── 6. UI 초기화
    ├── Renderer Process 시작
    ├── React 애플리케이션 마운트
    ├── IPC 이벤트 리스너 등록
    └── 초기 데이터 로드
```

### 2. 실시간 모니터링 사이클
```
⏰ Monitoring Cycle (Every 30s)
├── 1. 시스템 상태 확인
│   ├── 메모리 사용량 체크
│   ├── 슬립 모드 감지 (10분 임계값)
│   └── 서킷 브레이커 상태 확인
├── 2. 플랫폼별 병렬 모니터링
│   ├── 🎮 Chzzk: API 호출
│   │   ├── 활성 스트리머 목록 조회
│   │   ├── 라이브 상태 확인 (병렬)
│   │   ├── 상태 변화 감지
│   │   └── 프로필 이미지 업데이트
│   ├── 🐦 Twitter: RSS 파싱
│   │   ├── RSS 피드 다운로드
│   │   ├── 새 트윗 추출
│   │   ├── 콘텐츠 파싱 (텍스트/HTML)
│   │   └── 중복 필터링
│   ├── ☕ Cafe: 웹 스크래핑
│   │   ├── 브라우저 세션 확인
│   │   ├── 로그인 상태 검증
│   │   ├── 게시글 페이지 탐색
│   │   └── 새 게시글 추출
│   └── 🌟 Weverse: 알림 수집
│       ├── 위버스 세션 확인
│       ├── 알림 페이지 접근
│       ├── 아티스트별 알림 수집
│       └── 새 알림 감지
├── 3. 결과 처리 및 알림
│   ├── 새 활동 감지된 경우:
│   │   ├── uniqueKey 생성
│   │   ├── 중복 검사 (DB unique 제약)
│   │   ├── 알림 데이터 생성
│   │   ├── 프로필 이미지 다운로드
│   │   ├── 시스템 알림 전송
│   │   └── 데이터베이스 저장
│   └── 상태 업데이트:
│       ├── monitor_states 테이블 업데이트
│       ├── monitoring_status 테이블 업데이트
│       └── IPC 이벤트 전송 (UI 동기화)
├── 4. 성능 메트릭 수집
│   ├── 응답 시간 기록
│   ├── 메모리 사용량 추적
│   ├── 에러율 계산
│   └── 사용자 경험 메트릭
└── 5. 다음 사이클 스케줄링
    ├── 메모리 압박 시 간격 조정
    ├── 에러 발생 시 백오프 적용
    └── 정상 상태 시 기본 간격 유지
```

### 3. 에러 처리 및 복구 플로우
```
🛡️ Error Handling & Recovery
├── 1. 에러 감지 및 분류
│   ├── ErrorManager.classifyError()
│   ├── 에러 타입별 통계 업데이트
│   └── 서킷 브레이커 상태 확인
├── 2. 복구 전략 선택
│   ├── Network Error:
│   │   ├── 지수적 백오프 (1s → 2s → 4s)
│   │   ├── 최대 3회 재시도
│   │   └── DNS/연결 상태 확인
│   ├── Timeout Error:
│   │   ├── 타임아웃 값 동적 증가
│   │   ├── 메모리 압박 시 타임아웃 감소
│   │   └── 최대 2회 재시도
│   ├── Browser Error:
│   │   ├── 페이지 새로고침
│   │   ├── 브라우저 컨텍스트 재시작
│   │   └── 전체 브라우저 재시작
│   ├── Auth Error:
│   │   ├── 자동 재로그인 시도
│   │   ├── 세션 쿠키 갱신
│   │   └── 수동 로그인 요청
│   └── Parsing Error:
│       ├── 페이지 구조 변경 감지
│       ├── 백업 셀렉터 시도
│       └── 관리자 알림
├── 3. 서킷 브레이커 관리
│   ├── 연속 실패 임계값 도달 시:
│   │   ├── 서킷 OPEN (서비스 일시 중단)
│   │   ├── 쿨다운 기간 설정
│   │   └── UI 상태 업데이트
│   ├── Half-Open 상태 전환:
│   │   ├── 제한된 트래픽 허용
│   │   ├── 성공 시 CLOSED로 전환
│   │   └── 실패 시 OPEN 유지
│   └── 복구 완료:
│       ├── 정상 서비스 재개
│       ├── 통계 리셋
│       └── 성공 알림
└── 4. 사용자 알림
    ├── 시스템 트레이 상태 업데이트
    ├── UI 에러 메시지 표시
    ├── 복구 완료 시 알림
    └── 관리자 개입 필요 시 경고
```

### 4. 메모리 관리 및 최적화 플로우
```
🧠 Memory Management Flow
├── 1. 실시간 모니터링 (30초 간격)
│   ├── process.memoryUsage() 수집
│   ├── 임계값과 비교
│   └── 메모리 압박 레벨 결정
├── 2. 레벨별 최적화 전략
│   ├── Warning (512MB):
│   │   ├── LRU 캐시 부분 정리
│   │   ├── 만료된 항목 제거
│   │   ├── GC 권장 실행
│   │   └── 타임아웃 10% 단축
│   ├── Critical (1GB):
│   │   ├── 모든 캐시 전체 정리
│   │   ├── GC 강제 실행 (global.gc())
│   │   ├── 브라우저 페이지 새로고침
│   │   ├── 타임아웃 30% 단축
│   │   └── 비활성 연결 종료
│   └── Emergency (1.5GB):
│       ├── 브라우저 프로세스 재시작
│       ├── 모든 서비스 메모리 정리
│       ├── 타임아웃 50% 단축
│       ├── 모니터링 간격 증가
│       └── 긴급 재시작 고려
├── 3. 캐시 관리 시스템
│   ├── LRU Cache 자동 정리:
│   │   ├── 접근 시간 기반 만료
│   │   ├── 크기 제한 초과 시 제거
│   │   └── 30분마다 정리 작업
│   ├── 프로필 이미지 캐시:
│   │   ├── 최대 500개 이미지
│   │   ├── 1시간 TTL
│   │   └── 디스크 공간 모니터링
│   └── 상태 캐시:
│       ├── 스트리머 상태 (1시간)
│       ├── 라이브 상태 (30분)
│       └── 알림 중복 방지 (24시간)
└── 4. 자동 복구 메커니즘
    ├── 메모리 누수 감지
    ├── 서비스별 메모리 사용량 추적
    ├── 임계값 초과 서비스 재시작
    └── 전체 애플리케이션 재시작 (최후 수단)
```

## 🎨 UI 컴포넌트 및 상태 관리

### React 애플리케이션 구조
```
📱 React Application Architecture
├── App.tsx (루트 컴포넌트)
│   ├── 전역 상태 관리 (useState + useEffect)
│   ├── IPC 이벤트 리스너 설정
│   ├── 실시간 데이터 동기화
│   └── 라우팅 제어
├── 🧭 React Router 구조
│   ├── /streamers → StreamerManagement.tsx
│   ├── /notifications → NotificationHistory.tsx
│   ├── /settings → Settings.tsx
│   └── /weverse → WeverseManagement.tsx
├── 🧩 공통 컴포넌트
│   ├── Sidebar.tsx (네비게이션)
│   ├── StreamerCard.tsx (스트리머 정보 카드)
│   ├── AddStreamerForm.tsx (스트리머 추가 폼)
│   ├── WeverseArtistCard.tsx (위버스 아티스트 카드)
│   └── DonationWidget.tsx (후원 위젯)
└── 🎨 스타일링 시스템
    ├── Tailwind CSS (유틸리티 클래스)
    ├── 반응형 디자인
    ├── 다크/라이트 테마
    └── 컴포넌트별 스타일 모듈
```

### 상태 관리 패턴
```typescript
// App.tsx - 전역 상태 관리
function App() {
  // 핵심 상태
  const [streamers, setStreamers] = useState<StreamerData[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [liveStatuses, setLiveStatuses] = useState<LiveStatus[]>([]);
  const [weverseArtists, setWeverseArtists] = useState<WeverseArtist[]>([]);
  const [monitoringStats, setMonitoringStats] = useState<MonitoringStats | null>(null);
  
  // IPC 이벤트 리스너
  useEffect(() => {
    // 실시간 업데이트 리스너
    window.electronAPI.onStreamerDataUpdated(setStreamers);
    window.electronAPI.onLiveStatusUpdated(setLiveStatuses);
    window.electronAPI.onNotificationReceived(handleNewNotification);
    window.electronAPI.onWeverseArtistsUpdated(setWeverseArtists);
    
    // 초기 데이터 로드
    loadInitialData();
    
    return () => {
      // 정리 작업
      window.electronAPI.removeAllListeners();
    };
  }, []);
}
```

### IPC 통신 패턴
```typescript
// Preload Script - 안전한 API 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // 스트리머 관리
  getStreamers: () => ipcRenderer.invoke('get-streamers'),
  addStreamer: (data) => ipcRenderer.invoke('add-streamer', data),
  updateStreamer: (data) => ipcRenderer.invoke('update-streamer', data),
  deleteStreamer: (id) => ipcRenderer.invoke('delete-streamer', id),
  
  // 실시간 이벤트 구독
  onStreamerDataUpdated: (callback) => {
    ipcRenderer.on('streamer-data-updated', (_, data) => callback(data));
  },
  onLiveStatusUpdated: (callback) => {
    ipcRenderer.on('live-status-updated', (_, data) => callback(data));
  },
  onNotificationReceived: (callback) => {
    ipcRenderer.on('notification-received', (_, data) => callback(data));
  },
  
  // 모니터링 제어
  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  getMonitoringStatus: () => ipcRenderer.invoke('get-monitoring-status'),
  
  // 유틸리티
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showTrayMenu: () => ipcRenderer.invoke('show-tray-menu')
});
```

## 🔨 빌드 및 배포 시스템

### Webpack 멀티 설정
```javascript
// webpack.main.config.js - Main Process
module.exports = {
  target: 'electron-main',
  entry: './src/main/main.ts',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main')
    }
  },
  externals: {
    'better-sqlite3': 'commonjs better-sqlite3',
    'playwright': 'commonjs playwright'
  }
};

// webpack.renderer.config.js - Renderer Process  
module.exports = {
  target: 'electron-renderer',
  entry: './src/renderer/index.tsx',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: [
          'style-loader',
          'css-loader', 
          'postcss-loader'
        ]
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html'
    })
  ]
};
```

### Electron Builder 설정
```json
{
  "build": {
    "appId": "com.streameralarm.app",
    "productName": "Streamer Alarm System",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "assets/icon.*",
      "package.json"
    ],
    "asarUnpack": [
      "node_modules/better-sqlite3/**/*",
      "node_modules/playwright/**/*"
    ],
    "win": {
      "target": "nsis",
      "icon": "assets/icon.ico"
    },
    "mac": {
      "target": ["dmg", "zip"],
      "icon": "assets/icon.icns",
      "hardenedRuntime": true
    },
    "linux": {
      "target": ["AppImage", "deb", "rpm"],
      "icon": "assets/icon.png",
      "category": "Network"
    }
  }
}
```

### 플랫폼별 최적화
- **Windows**: NSIS 설치 프로그램, 자동 업데이트 지원
- **macOS**: 코드 사이닝, 공증, Universal Binary (Intel/Apple Silicon)
- **Linux**: AppImage (포터블), DEB/RPM (패키지 관리자)

## 🔒 보안 및 성능 심화 분석

### 보안 측면
1. **프로세스 격리**: Main/Renderer 프로세스 완전 분리
2. **권한 최소화**: 필요한 권한만 부여
3. **입력 검증**: 모든 사용자 입력 및 외부 데이터 검증
4. **세션 보안**: 로그인 토큰 암호화 저장
5. **업데이트 보안**: 코드 사이닝된 업데이트만 허용

### 성능 최적화
1. **메모리 효율성**: LRU 캐시, 자동 정리, 메모리 모니터링
2. **네트워크 최적화**: 연결 풀링, 타임아웃 관리, 병렬 처리
3. **데이터베이스 최적화**: WAL 모드, 인덱싱, Prepared Statement
4. **UI 최적화**: Virtual DOM, 지연 로딩, 메모이제이션

---

*이 문서는 Streamer Alarm System v2.1.0의 실제 구현을 기준으로 상세히 분석하여 작성되었습니다.*