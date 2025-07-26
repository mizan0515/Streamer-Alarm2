# Streamer Alarm System 2

🚀 **한국 VTuber 스트리머 실시간 모니터링 및 알림 시스템**

Electron 기반의 데스크톱 애플리케이션으로, 치지직/카페/트위터/위버스 플랫폼을 통합 모니터링하여 실시간 알림을 제공합니다.

## ✨ 주요 기능

- **🔴 실시간 라이브 감지**: 치지직 스트리밍 시작 즉시 알림
- **📝 커뮤니티 모니터링**: 네이버 카페 새 글 알림
- **🐦 소셜 미디어**: 트위터 트윗 및 위버스 포스트 추적
- **🔔 시스템 알림**: OS 네이티브 알림 및 시스템 트레이 지원
- **💾 데이터 관리**: SQLite 기반 알림 기록 및 설정 저장

## 🛠️ 기술 스택

- **Framework**: Electron 28.1.0
- **Frontend**: React 18.2.0 + TypeScript 5.3.3
- **Backend**: Node.js + better-sqlite3 9.6.0
- **Build**: Webpack 5.89.0
- **Monitoring**: Playwright 1.40.1 (웹 스크래핑)
- **Logging**: Winston 3.17.0

## 🚀 빠른 시작

### 개발 환경
```bash
# 의존성 설치
npm install

# 개발 서버 실행 (Hot Reload)
npm run dev

# 프로덕션 빌드
npm run build

# 빌드된 앱 실행
npm start
```

### 배포
```bash
# Windows 실행 파일 생성
npm run build:win

# macOS 앱 생성
npm run build:mac

# Linux AppImage 생성
npm run build:linux
```

## 📁 프로젝트 구조

```
src/
├── main/                    # Main Process (Node.js)
│   ├── main.ts             # 애플리케이션 엔트리포인트
│   ├── preload.ts          # 안전한 API 브릿지
│   └── services/           # 백그라운드 서비스들
│       ├── MonitoringService.ts    # 중앙 모니터링 관리자
│       ├── DatabaseManager.ts     # SQLite 데이터 관리
│       ├── NotificationService.ts # 시스템 알림 엔진
│       └── monitors/              # 플랫폼별 모니터링
│           ├── ChzzkMonitor.ts    # 치지직 라이브 감지
│           ├── TwitterMonitor.ts  # 트위터 RSS 파싱
│           ├── CafeMonitor.ts     # 네이버 카페 스크래핑
│           └── WeiverseMonitor.ts # 위버스 알림 수집
├── renderer/               # Renderer Process (React)
│   ├── App.tsx            # React 메인 컴포넌트
│   ├── components/        # UI 컴포넌트들
│   └── pages/             # 페이지 컴포넌트들
└── shared/
    └── types/             # 공통 타입 정의
```

## 🏗️ 아키텍처

### Electron 멀티프로세스 아키텍처
```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process (Node.js)                  │
│                   시스템 접근 권한 & 백그라운드              │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│ │MonitoringService│ │ DatabaseManager │ │NotificationSvc  │ │
│ │   (중앙 관리자)   │ │   (SQLite WAL)  │ │   (알림 엔진)    │ │
│ │ • 30초 주기 체크  │ │ • 스키마 v4     │ │ • 중복 방지     │ │
│ │ • 4개 플랫폼 통합 │ │ • 자동 마이그레이션│ │ • 프로필 이미지  │ │
│ │ • 슬립모드 복구   │ │ • WAL 모드 최적화│ │ • 시스템 트레이  │ │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘ │
│                             ↕ IPC (Context Isolation)        │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                 Renderer Process (Chromium)                │
│                    React UI + TypeScript                   │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│ │   React 18.2    │ │  Tailwind CSS   │ │  React Router   │ │
│ │ • 함수형 컴포넌트  │ │ • 유틸리티 퍼스트 │ │ • 클라이언트 라우팅│ │
│ │ • Hooks 패턴     │ │ • 반응형 디자인   │ │ • 4개 페이지 관리 │ │
│ │ • 실시간 상태 동기화│ │ • 다크/라이트 테마│ │ • 히스토리 관리   │ │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 통합 플랫폼 모니터링 시스템
```
🎯 실시간 모니터링 (30초 주기)
├── 🎮 ChzzkMonitor
│   ├── API 기반 라이브 상태 감지
│   ├── 동적 프로필 이미지 동기화
│   └── LRU 캐시 기반 상태 비교
├── 🐦 TwitterMonitor  
│   ├── RSS 피드 파싱 (nitter.net)
│   ├── HTML/텍스트 분리 처리
│   └── 트윗 ID 기반 중복 제거
├── ☕ CafeMonitor
│   ├── Playwright 브라우저 자동화
│   ├── 네이버 로그인 세션 관리
│   └── DOM 파싱 게시글 추출
└── 🌟 WeiverseMonitor
    ├── 브라우저 세션 유지
    ├── 다중 아티스트 지원
    └── 알림 페이지 실시간 감지
```

### 데이터베이스 스키마 (SQLite + WAL)
```sql
-- 핵심 엔티티 관계
streamers (1) ←→ (N) notifications
streamers (1) ←→ (N) notification_settings  
streamers (1) ←→ (N) monitor_states
weverse_artists (1) ←→ (N) notifications

-- 성능 최적화 인덱스
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_unique_key ON notifications(unique_key);
CREATE INDEX idx_streamers_active ON streamers(is_active);
```

### 지능형 알림 시스템
- **중복 방지**: uniqueKey 기반 동일 알림 필터링
- **프로필 이미지**: 자동 다운로드 및 LRU 캐시 관리
- **컨텍스트 인식**: 스트리머별, 플랫폼별 맞춤 알림
- **사용자 상호작용**: 클릭 시 외부 브라우저 연동


## 🔧 개발 도구

- **TypeScript**: 타입 안전성 보장
- **ESLint + Prettier**: 코드 품질 관리
- **Hot Module Replacement**: 빠른 개발 피드백
- **Electron Builder**: 크로스 플랫폼 패키징

## 📄 라이선스

MIT License - 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 🤝 기여하기

이슈 리포트나 기능 제안은 GitHub Issues를 통해 환영합니다!

---

*🎯 Electron과 React를 활용한 실무급 데스크톱 애플리케이션 개발 학습 프로젝트*