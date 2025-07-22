# 🚀 Electron 학습 커리큘럼 - Streamer Alarm 프로젝트 분석

## 📚 전체 커리큘럼 개요

이 커리큘럼은 실제 운영 중인 **Streamer Alarm System** 프로젝트를 기반으로 한 15일 완성 Electron 학습 과정입니다. 기초 프로그래밍 지식이 있지만 웹 개발과 Electron을 처음 접하는 학습자를 위해 설계되었습니다.

### 🎯 학습 목표
- **Electron 아키텍처** 완전 이해
- **실무 수준**의 프로젝트 구조 분석 능력
- **보안을 고려한** 안전한 애플리케이션 개발
- **현대적인 개발 도구**와 워크플로우 습득

## 📅 주차별 학습 계획

### 🥇 1주차 (1-7일): Electron 기초와 프로젝트 구조
| 일차 | 주제 | 학습 내용 | 상태 |
|------|------|-----------|------|
| **1일** | [Electron 소개와 프로젝트 구조](./1일차.md) | 기본 개념, package.json 분석, 개발환경 | ✅ 완료 |
| **2일** | [Main Process와 생명주기](./2일차.md) | 애플리케이션 생명주기, BrowserWindow, 서비스 아키텍처 | ✅ 완료 |
| **3일** | [Renderer Process와 React](./3일차.md) | React 통합, 상태관리, IPC 기초 | ✅ 완료 |
| **4일** | [Preload Script와 IPC](./4일차.md) | Context Bridge, 안전한 API 노출, 통신 패턴 | ✅ 완료 |
| **5일** | [보안 모델과 Context Isolation](./5일차.md) | 보안 위험, 방어 기법, 안전한 설계 | ✅ 완료 |
| **6일** | 빌드 시스템과 Webpack | 개발/프로덕션 환경, HMR, 최적화 | 📋 계획됨 |
| **7일** | 1주차 종합 실습 | 미니 프로젝트, 문제 해결, 코드 리뷰 | 📋 계획됨 |

### 🥈 2주차 (8-14일): 고급 기능과 서비스 아키텍처
| 일차 | 주제 | 학습 내용 | 상태 |
|------|------|-----------|------|
| **8일** | 서비스 지향 아키텍처 | DatabaseManager, MonitoringService 분석 | 📋 계획됨 |
| **9일** | 데이터베이스 통합 | SQLite, better-sqlite3, 데이터 모델링 | 📋 계획됨 |
| **10일** | 시스템 알림과 트레이 | NotificationService, TrayService 구현 | 📋 계획됨 |
| **11일** | 외부 API와 웹 스크래핑 | Playwright, 실시간 모니터링 시스템 | 📋 계획됨 |
| **12일** | 실시간 모니터링 시스템 | 이벤트 기반 아키텍처, 성능 최적화 | 📋 계획됨 |
| **13일** | 설정 관리와 자동 시작 | SettingsService, 시스템 통합 | 📋 계획됨 |
| **14일** | 에러 처리와 로깅 | Winston 로깅, 예외 처리 패턴 | 📋 계획됨 |

### 🥉 3주차 (15일): 배포와 최적화
| 일차 | 주제 | 학습 내용 | 상태 |
|------|------|-----------|------|
| **15일** | 패키징과 배포 | Electron Builder, 자동 업데이트, 성능 최적화 | 📋 계획됨 |

## 🛠️ 프로젝트 기술 스택

### Core Technologies
- **Electron** `^28.1.0` - 데스크톱 애플리케이션 프레임워크
- **React** `^18.2.0` - UI 라이브러리  
- **TypeScript** `^5.3.3` - 타입 안전성
- **Webpack** `^5.89.0` - 모듈 번들러

### Backend Services
- **better-sqlite3** `^9.6.0` - SQLite 데이터베이스
- **Winston** `^3.17.0` - 구조화된 로깅
- **Playwright** `^1.40.1` - 웹 스크래핑
- **node-notifier** `^10.0.1` - 시스템 알림

### Development Tools
- **electron-builder** `^24.9.1` - 앱 패키징
- **concurrently** `^8.2.2` - 동시 프로세스 실행
- **TailwindCSS** `^3.3.6` - 유틸리티 CSS

## 📋 학습 방법론

### 🔄 4단계 학습 사이클
각 일차는 다음과 같은 구조로 구성됩니다:

1. **🎓 이론 학습** - 핵심 개념과 원리 이해
2. **🔍 코드 분석** - 실제 프로젝트 코드 해부
3. **⚡ 실습 예제** - 단계별 실습으로 경험 축적
4. **🎯 과제** - 문제 해결 중심의 응용 과제

### 💡 학습 팁

**✅ DO (권장사항)**
- 반드시 실습을 직접 해보기
- 에러 메시지를 두려워하지 않기
- 공식 문서와 함께 학습하기
- 코드를 복사하지 말고 직접 타이핑하기

**❌ DON'T (주의사항)**  
- 이론만 읽고 넘어가지 않기
- 에러 발생 시 바로 다음 단계로 건너뛰지 않기
- 과제를 건너뛰지 않기
- 이전 학습 내용을 복습하지 않고 진도만 나가지 않기

## 🚀 시작하기 전 준비사항

### 필수 프로그램 설치
```bash
# Node.js (LTS 버전 권장)
node --version  # v18 이상

# 프로젝트 클론 및 의존성 설치
git clone <repository-url>
cd streamer-alarm2
npm install
```

### 개발 환경 실행
```bash
# 개발 모드 실행
npm run dev

# 빌드 및 실행
npm run build
npm start
```

### 권장 개발 도구
- **VS Code** - TypeScript/React 지원
- **React DevTools** - 컴포넌트 디버깅
- **Electron DevTools** - Electron 특화 디버깅

## 📞 도움이 필요할 때

### 공식 문서
- [Electron 공식 가이드](https://www.electronjs.org/docs/latest/)
- [React 공식 문서](https://react.dev/)
- [TypeScript 핸드북](https://www.typescriptlang.org/docs/)

### 커뮤니티
- [Electron Discord](https://discord.com/invite/electron)
- [React 커뮤니티](https://react.dev/community)

## 🎖️ 수료 후 성취 목표

이 커리큘럼을 완주하면 다음과 같은 능력을 갖추게 됩니다:

- ✅ **Electron 앱을 처음부터 설계하고 구현**할 수 있음
- ✅ **보안을 고려한 안전한 애플리케이션** 개발 가능
- ✅ **복잡한 프로젝트 구조**를 이해하고 분석할 수 있음
- ✅ **현대적인 개발 도구와 워크플로우** 활용 가능
- ✅ **실무 수준의 코드 품질**로 개발 가능

---

*🎯 **시작이 반이다!** 1일차부터 차근차근 시작해보세요. 매일 조금씩 성장하는 자신을 발견할 수 있을 것입니다.*