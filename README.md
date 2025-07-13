# 🚀 Streamer Alarm System v2.0

> 한국 VTuber 스트리머들을 실시간 모니터링하고 즉시 알림을 전송하는 Electron 데스크톱 애플리케이션

[![Electron](https://img.shields.io/badge/Electron-v28.1.0-blue.svg)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-v18.2.0-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5.3.3-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 📖 목차
- [✨ 주요 기능](#-주요-기능)
- [🏗️ 아키텍처](#️-아키텍처)
- [🗂️ 프로젝트 구조](#️-프로젝트-구조)
- [🚀 설치 및 실행](#-설치-및-실행)
- [🎨 UI 구성](#-ui-구성)
- [⚙️ 사용법](#️-사용법)
- [🔧 문제 해결](#-문제-해결)

---

## ✨ 주요 기능

### 🎯 실시간 모니터링
- **🔴 CHZZK 라이브 스트림** - API 기반 실시간 방송 상태 감지
- **💬 네이버 카페 게시물** - Playwright 브라우저 자동화로 새 게시물 추적
- **🐦 X(Twitter) 트윗** - RSS 피드 기반 새 트윗 감지
- **🖼️ 프로필 이미지 동기화** - CHZZK API에서 자동 업데이트

### 🔔 스마트 알림 시스템
- **Windows 네이티브 토스트** - 프로필 이미지 포함 리치 알림
- **실시간 응답** - 50ms 이내 즉시 알림
- **개별 알림 제어** - 스트리머별 × 플랫폼별 세밀한 on/off 설정
- **알림폭탄 방지** - 새 스트리머 등록 시 과거 게시물 자동 필터링

### 🎨 현대적 UI/UX
- **글래스모피즘 디자인** - 반투명 카드 + 백드롭 블러 효과
- **네온 테마** - 보라색 그라디언트 + 동적 글로우 애니메이션
- **반응형 레이아웃** - 모든 화면 크기 대응
- **다크 모드** - 눈의 피로도 최소화

---

## 🏗️ 아키텍처

<img width="1000" alt="Image" src="https://github.com/user-attachments/assets/72a7736b-fdc6-4e27-94c1-86bf57e3563c" />

### 📊 시스템 구조
```
🏢 Streamer Alarm System v2.0
├── 📡 MonitoringService     # 모니터링 오케스트레이터
├── 🎯 ChzzkMonitor         # CHZZK API 전용 모니터
├── ☕ CafeMonitor          # Playwright 브라우저 자동화
├── 🐦 TwitterMonitor       # RSS 파서
├── 🗄️ DatabaseManager      # SQLite 데이터베이스 관리
├── 🔔 NotificationService  # Windows 토스트 알림
├── ⚙️ SettingsService      # 애플리케이션 설정 관리
└── 🎭 TrayService          # 시스템 트레이 통합
```

### 🔄 데이터 흐름
```
📱 외부 플랫폼 → 📡 모니터 → 🔔 알림 서비스 → 🖥️ Windows 알림
      ↓              ↓            ↓
  🗄️ SQLite DB ← 📊 상태 관리 → 🎨 React UI
```

### 🏗️ 마이크로서비스 아키텍처

#### 📡 MonitoringService (핵심 오케스트레이터)
- **역할**: 모든 모니터링 서비스 조정 및 스케줄링
- **기능**: 
  - 30초 주기 모니터링 루프 관리
  - 플랫폼별 모니터 서비스 병렬 실행
  - 절전모드 감지 및 자동 복구
  - 오류 격리 및 재시도 로직
- **패턴**: Promise.allSettled로 장애 격리

#### 🎯 ChzzkMonitor (CHZZK API 통합)
- **API 엔드포인트**: `https://api.chzzk.naver.com/polling/v2/channels/{id}/live-status`
- **기능**:
  - 실시간 라이브 상태 감지
  - 프로필 이미지 자동 동기화
  - 상태 변경 감지 (오프라인 → 라이브)
- **최적화**: HTTP 클라이언트 연결 풀링

#### ☕ CafeMonitor (브라우저 자동화)
- **엔진**: Playwright Chromium (헤드리스)
- **세션 관리**: 
  - 쿠키 영구 저장
  - 자동 로그인 복구
  - 캡챠/페이지 변경 감지
- **스크래핑 전략**: 
  - iframe 직접 접근
  - 다중 셀렉터 폴백
  - 게시물 ID 기반 중복 제거

#### 🐦 TwitterMonitor (RSS 피드 파싱)
- **데이터 소스**: Nitter 인스턴스 RSS 피드
- **백업 전략**: 다중 인스턴스 자동 전환
- **파싱**: HTML 태그 제거 + 텍스트 정리
- **중복 방지**: 트윗 ID 기반 상태 추적

#### 🗄️ DatabaseManager (SQLite CRUD)
- **ACID 보장**: better-sqlite3 동기 트랜잭션
- **스키마**: 관계형 정규화 설계
  - `streamers` (스트리머 정보)
  - `notification_settings` (개별 알림 설정)
  - `notifications` (알림 기록)
  - `monitor_states` (모니터링 상태)
- **최적화**: 인덱스 + 준비된 문장(Prepared Statements)

#### 🔔 NotificationService (알림 통합)
- **Windows 통합**: node-notifier + Windows.UI.Notifications
- **리치 알림**: 
  - 프로필 이미지 80x80 최적화
  - 클릭 액션 URL 연결
  - 시스템 알림 센터 통합
- **폴백 메커니즘**: 토스트 → 클립보드 → 브라우저

#### ⚙️ SettingsService (설정 관리)
- **타입 안전**: 설정 키 enum 제한
- **동기화**: DB ↔ 시스템 설정 양방향
- **자동 시작**: Windows 레지스트리 통합
- **캐싱**: 메모리 캐시 + 변경 감지

#### 🎭 TrayService (시스템 통합)
- **동적 아이콘**: Canvas 기반 상태 표시 아이콘
- **컨텍스트 메뉴**: 실시간 상태 반영
- **크로스 플랫폼**: Windows(16x16), macOS(32x32), Linux(22x22)
- **폴백**: 픽셀 기반 아이콘 생성

### 🔗 IPC 통신 아키텍처

#### Context Bridge 패턴
```typescript
// preload.ts - 안전한 API 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // 스트리머 관리
  addStreamer: (data) => ipcRenderer.invoke('add-streamer', data),
  updateStreamer: (data) => ipcRenderer.invoke('update-streamer', data),
  
  // 실시간 이벤트 리스너
  on: (channel, func) => ipcRenderer.on(channel, func),
  removeListener: (channel, func) => ipcRenderer.removeListener(channel, func)
});
```

#### 실시간 이벤트 시스템
```typescript
// Main → Renderer (실시간 업데이트)
interface IpcEvents {
  'streamer-data-updated': StreamerData[];      // 스트리머 정보 변경
  'notification-received': NotificationData;    // 새 알림 수신
  'live-status-updated': LiveStatus[];          // 라이브 상태 변경
  'monitoring-status-changed': boolean;         // 모니터링 시작/중지
  'settings-updated': Record<string, any>;     // 설정 변경
}

// Renderer → Main (사용자 액션)
interface IpcHandlers {
  'add-streamer': (data: StreamerData) => Promise<StreamerData>;
  'test-notification': () => Promise<boolean>;
  'naver-login': () => Promise<boolean>;
  'update-setting': (key: string, value: any) => Promise<void>;
}
```

### 🧠 핵심 기술 스택

**Frontend (Renderer Process)**
- **React 18**: 함수형 컴포넌트 + Hooks
- **TypeScript 5**: 컴파일 타임 타입 안전성
- **Tailwind CSS**: 유틸리티 퍼스트 스타일링
- **글래스모피즘**: 커스텀 CSS 컴포넌트 시스템

**Backend (Main Process)**
- **Electron 28**: 크로스 플랫폼 데스크톱 런타임
- **Node.js**: 비동기 이벤트 루프
- **SQLite**: 임베디드 관계형 데이터베이스
- **Playwright**: 브라우저 자동화 엔진

**외부 통합**
- **CHZZK API**: RESTful HTTP 통신
- **Nitter RSS**: XML 파싱
- **Windows APIs**: 토스트 알림, 시스템 트레이, 자동 시작

### 🔐 보안 아키텍처

#### 프로세스 격리
- **Context Bridge**: 메인 ↔ 렌더러 안전한 통신
- **nodeIntegration: false**: 렌더러에서 Node.js 접근 차단
- **contextIsolation: true**: 격리된 컨텍스트 실행

#### 데이터 보안
- **로컬 저장**: 모든 데이터 사용자 디렉토리 암호화
- **세션 관리**: 브라우저 세션 샌드박스 격리
- **API 키 없음**: 공개 API만 사용하여 키 노출 위험 제거

### ⚡ 성능 최적화 패턴

#### 비동기 처리
- **Promise.allSettled**: 플랫폼별 병렬 모니터링
- **이벤트 기반**: 상태 변경 시에만 UI 업데이트
- **연결 풀링**: HTTP 클라이언트 재사용

#### 메모리 관리
- **단일 브라우저**: Playwright 컨텍스트 공유
- **캐시 관리**: LRU + 만료 시간 기반 자동 정리
- **리소스 해제**: 적절한 cleanup + garbage collection

---

## 🗂️ 프로젝트 구조

```
streamer-alarm2/
├── src/
│   ├── main/                    # Electron 메인 프로세스
│   │   ├── main.ts             # 애플리케이션 엔트리 포인트
│   │   ├── preload.ts          # IPC 브릿지
│   │   └── services/           # 백엔드 서비스들
│   │       ├── MonitoringService.ts
│   │       ├── ChzzkMonitor.ts
│   │       ├── CafeMonitor.ts
│   │       ├── TwitterMonitor.ts
│   │       ├── NotificationService.ts
│   │       ├── DatabaseManager.ts
│   │       ├── SettingsService.ts
│   │       └── TrayService.ts
│   ├── renderer/               # React 프론트엔드
│   │   ├── index.tsx           # React 엔트리
│   │   ├── App.tsx             # 메인 앱 컴포넌트
│   │   ├── components/         # 재사용 컴포넌트
│   │   │   ├── StreamerCard.tsx
│   │   │   ├── AddStreamerForm.tsx
│   │   │   └── Sidebar.tsx
│   │   └── pages/              # 페이지 컴포넌트
│   │       ├── StreamerManagement.tsx
│   │       ├── NotificationHistory.tsx
│   │       └── Settings.tsx
│   └── shared/                 # 공유 타입 정의
│       └── types/index.ts
├── assets/                     # 앱 아이콘 및 리소스
├── release/                    # 빌드 결과물
└── package.json               # NPM 설정
```

---

## 🚀 설치 및 실행

### 💻 시스템 요구사항

#### ✅ **필수 요구사항**
- **OS**: Windows 10/11 (x64)
- **메모리**: 최소 4GB RAM (권장 8GB)
- **저장공간**: 300MB (Chromium 포함)
- **인터넷**: 초기 설정 및 브라우저 다운로드 시 필요

#### ⚠️ **주의사항**
- **Node.js 불필요**: 별도 설치 필요 없음 (Electron 내장)
- **자동 설치**: Playwright Chromium 자동 다운로드
- **방화벽**: HTTP/HTTPS 외부 통신 허용 필요

### 📦 Windows 사용자용 설치

#### **🚀 설치형 (추천)**
1. [Releases 페이지](https://github.com/mizan0515/Streamer-Alarm2/releases)에서 `Streamer.Alarm.System.Setup.2.0.6.exe` 다운로드
2. 설치 프로그램 실행 → Playwright 브라우저 자동 설치
3. 윈도우 앱 검색에서 "Streamer Alarm System" 실행
4. 바로 사용 가능 ✅

#### **📁 무설치형 (포터블)**
1. [Releases 페이지](https://github.com/mizan0515/Streamer-Alarm2/releases)에서 `windows-Streamer.Alarm.System.zip` 다운로드
2. 압축을 풀고 `Streamer Alarm System.exe` 실행
3. 바로 사용 가능 ✅

> **💡 참고**: 설치형은 자동 업데이트와 Windows 시작 프로그램 등록을 지원합니다.

### 🛠️ 개발자용 설치

**시스템 요구사항**
- Node.js 18.0.0 이상
- npm 8.0.0 이상

```bash
# 1. 저장소 클론
git clone https://github.com/mizan0515/streamer-alarm2.git
cd streamer-alarm2

# 2. 의존성 설치
npm install

# 3. Playwright 브라우저 설치
npx playwright install chromium

# 4. 개발 서버 시작
npm run dev
```

### 🔨 빌드 명령어

| 명령어 | 용도 | 결과물 |
|--------|------|---------|
| `npm run dev` | 개발 서버 (Hot Reload) | - |
| `npm run build` | TypeScript 컴파일 | `dist/` |
| `npm run pack` | 개발용 패키징 | `release/win-unpacked/` |
| `npm run dist` | 배포용 인스톨러 | `release/*.exe` |

---

## 🎨 UI 구성

### 📱 메인 인터페이스
<img width="800" alt="메인 화면" src="https://github.com/user-attachments/assets/4c3b2a61-76ad-4cd7-896d-52773adb915b" />

### 📊 알림 기록
<img width="800" alt="알림 기록" src="https://github.com/user-attachments/assets/f3bc2b58-9b9c-4c42-89a9-c220f0e550bb" />

### ⚙️ 설정 페이지
<img width="800" alt="설정 화면" src="https://github.com/user-attachments/assets/c7d51931-de29-4d84-b374-8468e09c8a12" />

### 🎨 UI 구성 요소
```
📱 애플리케이션
├── 🎛️ 사이드바 네비게이션
│   ├── 📺 스트리머 관리
│   ├── 🔔 알림 기록
│   └── ⚙️ 설정
├── 📊 실시간 상태 대시보드
│   ├── 모니터링 상태
│   ├── 안읽은 알림 수
│   ├── 활성 스트리머 수
│   └── 라이브 중인 수
├── 🃏 스트리머 카드 (글래스모피즘)
│   ├── 🖼️ 프로필 이미지 (자동 동기화)
│   ├── 🏷️ 플랫폼 배지 (CHZZK/Twitter/Cafe)
│   ├── 🔄 활성 상태 토글
│   └── ⚙️ 개별 알림 설정
└── 📋 시스템 트레이
    ├── UI 열기/숨기기
    ├── 네이버 로그인/로그아웃
    ├── GitHub 릴리스 페이지
    └── 앱 종료
```

---

## ⚙️ 사용법

### 🖱️ 첫 실행 설정
1. **앱 시작** → 시스템 트레이에 아이콘 표시
2. **네이버 로그인** → 설정 탭에서 "네이버 로그인" (카페 모니터링용)
3. **스트리머 추가** → "스트리머 관리" 탭에서 새 스트리머 추가

### 📺 스트리머 관리
1. **새 스트리머 추가**
   - 이름, CHZZK ID, Twitter 사용자명, 네이버 카페 ID 입력
   - 플랫폼별 알림 on/off 설정
   - 저장 시 프로필 이미지 자동 가져오기

2. **알림 설정**
   - **글로벌**: 설정 탭 → "데스크톱 알림 표시"
   - **개별**: 스트리머 편집 → 플랫폼별 체크박스

### 🔔 알림 시스템

| 플랫폼 | 트리거 | 알림 내용 | 클릭 동작 |
|--------|--------|-----------|-----------|
| 🔴 **CHZZK** | 방송 시작 | 방송 제목 + 프로필 | 치지직 방송 페이지 |
| 💬 **카페** | 새 게시물 | 게시물 제목 + 작성자 | 네이버 카페 게시물 |
| 🐦 **Twitter** | 새 트윗 | 트윗 내용 요약 | X(Twitter) 트윗 |

### 📊 모니터링 제어
- **자동 시작**: 앱 실행 시 자동 모니터링 시작
- **수동 제어**: 시스템 트레이 메뉴에서 시작/중지
- **절전모드 복구**: 120초 이상 간격 감지 시 자동 복구

---

## 🔧 문제 해결

### 🚨 일반적인 문제

#### ❌ 알림이 표시되지 않음
1. **Windows 알림 권한 확인**
   - 설정 → 시스템 → 알림 및 작업 → "Streamer Alarm System" 권한 활성화
2. **앱 설정 확인**
   - 설정 탭 → "데스크톱 알림 표시" 체크
   - "알림 테스트" 버튼으로 테스트

#### 🌐 카페 모니터링 실패
1. **로그인 상태 확인**
   - 설정 탭 → 네이버 로그인 상태 확인
2. **브라우저 데이터 초기화**
   - 앱 종료 → `%APPDATA%\Streamer Alarm System\cafe_browser_data` 삭제
3. **재로그인**: 앱 재시작 → 네이버 로그인 재실행

#### 🔄 모니터링 중단
- 시스템 트레이 → "모니터링 시작"
- 또는 앱 재시작

### 🔄 완전 초기화 (Windows)
```powershell
# 1. 앱 종료
taskkill /f /im "Streamer Alarm System.exe"

# 2. 데이터 삭제
Remove-Item -Recurse -Force "$env:APPDATA\Streamer Alarm System"

# 3. 앱 재설치
```

---

## 🤝 기여하기

- **🐛 버그 신고**: [GitHub Issues](https://github.com/mizan0515/streamer-alarm2/issues)
- **💡 기능 제안**: [GitHub Discussions](https://github.com/mizan0515/streamer-alarm2/discussions)
- **🔧 Pull Request**: Fork → Feature Branch → PR

---

## 📜 라이선스

이 프로젝트는 **MIT 라이선스** 하에 배포됩니다.

---

<div align="center">

**⭐ 이 프로젝트가 도움이 되었다면 Star를 눌러주세요! ⭐**

</div>
