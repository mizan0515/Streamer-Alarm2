# Streamer Alarm System 2 - Claude 개발 가이드

## 🎯 프로젝트 개요

**Electron + React 기반 한국 VTuber 모니터링 시스템**

실시간 스트리밍, 커뮤니티 포스트, 소셜 미디어 활동을 통합 모니터링하여 즉시 알림을 제공하는 데스크톱 애플리케이션입니다.

## 🏗️ 핵심 아키텍처

### Electron 멀티프로세스 아키텍처 (상세)
```
┌───────────────────────────────────────────────────────────────┐
│                         Main Process                         │
│                    (Node.js 환경 - 시스템 접근 권한)                │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ MonitoringService│  │ DatabaseManager │  │NotificationService│ │
│  │   (중앙 관리자)    │  │   (SQLite3)     │  │   (알림 엔진)     │ │
│  │ • 스케줄링         │  │ • 트랜잭션 관리   │  │ • 중복 방지       │ │
│  │ • 상태 동기화      │  │ • 스키마 마이그레이션│ │ • 프로필 이미지    │ │
│  │ • 에러 복구       │  │ • 인덱스 최적화   │  │ • 사용자 상호작용  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   TrayService   │  │  ErrorManager   │  │ MemoryManager   │ │
│  │  (시스템 트레이)   │  │  (에러 처리)     │  │  (메모리 최적화)  │ │
│  │ • 컨텍스트 메뉴    │  │ • 서킷 브레이커   │  │ • LRU 캐시       │ │
│  │ • 상태 표시       │  │ • 백오프 전략     │  │ • 가비지 컬렉션   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ PlatformMonitors│  │PerformanceMonitor│ │ TimeoutConfig   │ │
│  │ • ChzzkMonitor  │  │ • 메트릭 수집     │  │ • 동적 타임아웃   │ │
│  │ • TwitterMonitor │  │ • 응답 시간 추적  │  │ • 메모리 기반 조정│ │
│  │ • CafeMonitor   │  │ • 리소스 모니터링 │  │ • 재시도 로직     │ │
│  │ • WeverseMonitor│  │ • 임계값 관리     │  │ • 백오프 알고리즘 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└───────────────────────────────────────────────────────────────┘
                               ↕ IPC (안전한 메시지 채널)
┌───────────────────────────────────────────────────────────────┐
│                       Renderer Process                       │
│                   (Chrome 환경 - UI 렌더링)                     │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   React App     │  │  React Router   │  │  State Manager  │ │
│  │ • 컴포넌트 트리    │  │ • 클라이언트 라우팅│ │ • 전역 상태 관리  │ │
│  │ • Hooks 패턴     │  │ • 네비게이션 관리  │ │ • IPC 이벤트 동기화│ │
│  │ • 이벤트 핸들링   │  │ • 히스토리 관리    │  │ • 실시간 업데이트  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### 정교한 데이터베이스 설계 (SQLite WAL 모드)
```sql
-- 스키마 버전 4 (자동 마이그레이션)
CREATE TABLE streamers (
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
);

-- 통합 알림 테이블 (스트리머/위버스 양방향 지원)
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_id INTEGER,                  -- 스트리머 연결 (nullable)
  weverse_artist_id INTEGER,            -- 위버스 아티스트 연결 (nullable)
  type TEXT NOT NULL,                   -- live, cafe, twitter, weverse, system
  title TEXT NOT NULL,
  content TEXT,
  content_html TEXT,
  url TEXT,
  unique_key TEXT UNIQUE,               -- 중복 방지 핵심 필드
  profile_image_url TEXT,
  is_read BOOLEAN DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
  FOREIGN KEY (weverse_artist_id) REFERENCES weverse_artists(id) ON DELETE CASCADE,
  
  -- 체크 제약: 스트리머 또는 위버스 중 하나는 반드시 존재
  CHECK ((streamer_id IS NOT NULL AND weverse_artist_id IS NULL) OR 
         (streamer_id IS NULL AND weverse_artist_id IS NOT NULL))
);

-- 성능 최적화 인덱스 전략
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_unique_key ON notifications(unique_key);
CREATE INDEX idx_streamers_active ON streamers(is_active);
CREATE INDEX idx_monitor_states_streamer_platform ON monitor_states(streamer_id, platform);

-- 조건부 인덱스 (특정 조건의 데이터만 인덱싱)
CREATE INDEX idx_notifications_unread ON notifications(created_at) WHERE is_read = 0;
CREATE INDEX idx_active_streamers ON streamers(name) WHERE is_active = 1;
```

### 실시간 모니터링 플로우 (30초 주기)
```
⏰ Monitoring Cycle
├── 1. 시스템 상태 확인
│   ├── 메모리 사용량 체크 (512MB/1GB/1.5GB 임계값)
│   ├── 슬립 모드 감지 (10분 임계값)
│   └── 서킷 브레이커 상태 확인
├── 2. 플랫폼별 병렬 모니터링
│   ├── 🎮 Chzzk: API 호출 → 라이브 상태 확인
│   ├── 🐦 Twitter: RSS 파싱 → 새 트윗 추출
│   ├── ☕ Cafe: Playwright → 게시글 스크래핑
│   └── 🌟 Weverse: 세션 유지 → 알림 수집
├── 3. 결과 처리 및 알림
│   ├── uniqueKey 생성 (플랫폼별 로직)
│   ├── 중복 검사 (DB unique 제약)
│   ├── 알림 생성 및 전송
│   └── 상태 데이터베이스 업데이트
└── 4. 성능 메트릭 수집
    ├── 응답 시간 기록
    ├── 메모리 사용량 추적
    └── 에러율 계산
```

## 🛠️ 기술 스택 상세

### 프론트엔드
- **React 18.2.0**: 함수형 컴포넌트 + Hooks
- **TypeScript 5.3.3**: 타입 안전성
- **Tailwind CSS 3.3.6**: 유틸리티 퍼스트 스타일링

### 백엔드
- **Electron 28.1.0**: 멀티프로세스 아키텍처
- **better-sqlite3 9.6.0**: 고성능 SQLite (WAL 모드)
- **Playwright 1.40.1**: 브라우저 자동화 (헤드리스)
- **Winston 3.17.0**: 구조화된 로깅

### 빌드 도구
- **Webpack 5.89.0**: 모듈 번들링 (Main/Renderer 분리)
- **electron-builder 24.9.1**: 크로스 플랫폼 패키징

## 📝 개발 지침

### 코드 작성 규칙
1. **타입 안전성**: 모든 API와 데이터는 TypeScript 타입 정의 필수
2. **에러 처리**: try-catch + Winston 로깅으로 모든 예외 상황 처리
3. **성능 최적화**: 메모리 누수 방지 및 리소스 정리 필수
4. **보안**: Context Isolation + nodeIntegration:false 엄격 적용

### 주요 파일 위치
```
src/main/main.ts              # 메인 프로세스 엔트리포인트
src/main/services/            # 백그라운드 서비스들
src/main/preload.ts           # IPC 브릿지
src/renderer/App.tsx          # React 메인 컴포넌트
src/shared/types/index.ts     # 공통 타입 정의
교보재/                       # 15일 학습 커리큘럼
```

### 서비스 초기화 순서
1. **DatabaseManager**: 스키마 초기화 및 마이그레이션
2. **SettingsService**: 애플리케이션 설정 로드
3. **PerformanceMonitor/MemoryManager**: 시스템 모니터링
4. **NotificationService**: 알림 시스템 준비
5. **MonitoringService**: 실시간 모니터링 시작

## 🚀 개발 워크플로우

### 로컬 개발
```bash
npm run dev          # 개발 서버 (Hot Reload)
npm run build        # 프로덕션 빌드
npm start           # 빌드된 앱 실행
```

### 디버깅
- **Main Process**: VS Code 디버거 + Node.js
- **Renderer Process**: Chrome DevTools
- **로그 파일**: `userData/logs/` 디렉토리

### 배포 준비
```bash
npm run build:win    # Windows NSIS 인스톨러
npm run build:mac    # macOS DMG 파일
npm run build:linux  # Linux AppImage/DEB
```

## 🔍 주요 기능 구현

### 지능형 모니터링 시스템
- **30초 주기 폴링**: 4개 플랫폼 동시 병렬 모니터링
- **슬립 모드 복구**: 10분 이상 비활성 시 자동 감지 및 복구
- **서킷 브레이커**: 연속 실패 시 서비스 일시 차단 (자동 복구)
- **동적 타임아웃**: 메모리 압박 시 타임아웃 자동 조정 (20-50% 단축)
- **uniqueKey 중복 방지**: 플랫폼별 고유 로직으로 동일 알림 차단

### 고성능 데이터 관리
- **SQLite WAL 모드**: Write-Ahead Logging으로 동시성 최적화
- **자동 스키마 마이그레이션**: v1→v4 점진적 업그레이드
- **조건부 인덱싱**: 활성 데이터만 선별적 인덱싱
- **Prepared Statement 캐싱**: 자주 사용 쿼리 사전 컴파일
- **트랜잭션 관리**: ACID 속성 보장 및 롤백 지원

### 메모리 최적화 & 성능 모니터링
- **3단계 메모리 관리**: Warning(512MB) → Critical(1GB) → Emergency(1.5GB)
- **LRU 캐시 전략**: 프로필 이미지, 상태 정보 효율적 캐싱
- **실시간 성능 추적**: 응답 시간, 에러율, 리소스 사용량 모니터링
- **가비지 컬렉션**: 메모리 압박 시 강제 GC 실행
- **브라우저 세션 관리**: 메모리 누수 방지 자동 재시작

### 시스템 통합 & 보안
- **Context Isolation**: 렌더러와 Node.js 환경 완전 격리
- **Preload Script**: 안전한 IPC API만 선별적 노출
- **Single Instance Lock**: 중복 실행 방지 및 포커스 리다이렉션
- **동적 트레이 메뉴**: 실시간 상태 반영 컨텍스트 메뉴
- **자동 시작 관리**: OS 부팅 시 백그라운드 자동 실행

## 📚 학습 리소스

### 교보재 구성 (15일 커리큘럼)
- **기초편 (1-5일)**: Electron 아키텍처, IPC 통신, React 통합
- **실습편 (6-10일)**: 서비스 아키텍처, 데이터베이스, 시스템 통합
- **고급편 (11-15일)**: 실시간 모니터링, 성능 최적화, 배포

### 참고 문서
- `architecture.md`: 상세한 시스템 아키텍처 분석
- `교보재/README.md`: 학습 진행 상황 및 계획
- 각 일차별 `.md` 파일: 단계별 학습 가이드

## ⚠️ 주의사항

### 보안
- Remote Module 완전 비활성화
- Context Isolation 엄격 적용
- Preload 스크립트를 통한 안전한 API 노출만 허용

### 성능
- 메모리 누수 방지: 이벤트 리스너 정리 필수
- 브라우저 인스턴스 관리: Playwright 페이지 적절한 close()
- 데이터베이스 연결: 트랜잭션 후 정리

### 호환성
- Windows 10+, macOS 10.15+, Ubuntu 18.04+ 지원
- Node.js 네이티브 모듈 (better-sqlite3) ASAR 언팩 필요

---

*🔧 이 가이드는 Claude가 프로젝트를 이해하고 효과적으로 개발 지원을 하기 위한 참조 문서입니다.*