# 문서 안내

문서는 주된 목적에 따라 세 폴더로 나눈다. 먼저 제품 개발에 직접 관련된 문서인지 판단한 뒤, 제품 문서만 계획과 실행 결과로 구분한다. 폴더 분류는 구현 완료 여부를 대신하지 않으며 각 문서의 상태와 검증 기록을 기준으로 판단한다.

| 위치 | 분류 기준 | 예시 |
| --- | --- | --- |
| `planning/` | 제품 구현 이전의 계획·설계·아이디어·의사결정 | 기능 제안, DB/API 설계, UI 시안, 성능 개선·QA 계획 |
| `work-log/` | 제품 구현·코드 개선·QA·운영의 결과와 안내 | 버그 수정, 테스트 결과, 코드 품질 개선, 사용법·호스팅, 개발 재현에 필요한 버전 기준 |
| `etc/` | 제품 개발 자체가 아닌 보조 작업의 계획과 결과 | Git 동기화, 로컬 도구 장애, 문서 정리, 외부 소개 자산, 예시 ERD 제작·배치, 학습 안내 |

파일명이나 사용 도구만으로 분류하지 않는다. 예를 들어 MCP로 실제 워크스페이스 기능의 DB 설계를 정하는 작업은 `planning/`에, 이미 구현된 스키마를 예시 프로젝트로 생성하고 보기 좋게 배치하는 작업은 `etc/`에 둔다. 코드 변경이 없는 기능 아이디어·QA 문서도 제품 문서다. 제품 결정과 보조 작업이 섞이면 주된 목적을 따르되 독립적으로 참조할 내용은 분리하고 서로 링크한다.

새 계획·기록은 `YYYY-MM-DD-Domain-Task.md` 형식을 사용한다. 기타 작업은 `etc/` 안에서 `Plan`/`Result`로 단계를 구분한다. 이동만 하는 기존 문서의 날짜·이름은 가능한 한 보존하며 이름 충돌 시 접미사를 붙인다. `docs/EZERD.txt`는 사용자 관리 파일이므로 수정하거나 이동하지 않는다.

## planning · 구현 이전 계획·설계

| 문서 | 내용 |
| --- | --- |
| [REQUIREMENTS.md](./planning/REQUIREMENTS.md) | 제품 요구사항과 작업 흐름 |
| [RELEASE_SCOPE.md](./planning/RELEASE_SCOPE.md) | 출시 범위와 추가 확정 계획, 완료 기준 |
| [DATA_MODEL.md](./planning/DATA_MODEL.md) | 논리·물리 모델의 설계 원칙 |
| [TECH_STACK.md](./planning/TECH_STACK.md) | 기술 선택과 구조 설계, 검토 이력 |
| [DESIGN_SYSTEM.md](./planning/DESIGN_SYSTEM.md) | 시각·조작 기준과 디자인 결정 |
| [EDITOR_WORKFLOW_DECISIONS.md](./planning/EDITOR_WORKFLOW_DECISIONS.md) | 다음 편집 기능의 확정 사항과 미확정 세부 설계 |
| [캔버스 성능 개선 계획](./planning/2026-09-17-Canvas-Performance.md) | 현재 구현 기준의 계측·최적화 후보와 완료 조건 |
| [성능 조사 7단계 실측 절차](./planning/2026-09-28-Canvas-PerformanceInvestigation.md) | 2026-09-28 구조 기준 계측 위치·실험·판정·결과 기록 방법 |
| [브라우저 자동화 성능 측정 계획](./planning/2026-09-28-Canvas-BrowserPerformance.md) | 안정성 점검·UI 시나리오·계측 어댑터·결과 수집·중단 및 복구 |
| [저장소 폴더 정리 계획](./planning/2026-09-17-Repository-FolderRefactoring.md) | 기능별 소유 위치, 단계별 이동과 책임 분리, 경로·동작 검증 |
| [프로젝트 내보내기·가져오기 제안](./planning/2026-09-17-Project-ExportImport.md) | JSON 설계 백업·이동 범위와 미결정 사항 · 미구현 |

## work-log · 진행한 작업·검증·사용 안내

| 문서 | 내용 |
| --- | --- |
| [최신 편집기 측정 호환](./work-log/2026-10-02-Performance-CurrentEditors.md) | 현재 공유 v1·Native v2 읽기 측정 범위와 검증 |
| [최소 성능 측정 도구](./work-log/2026-09-28-Canvas-MeasurementImplementation.md) | 측정 빌드·계산 runner 사용법 · 당시 구현 기준 |
| [100·300개 규모 측정](./work-log/2026-09-28-Canvas-ScaleMeasurement.md) | 기존 schemaVersion1 캔버스의 측정 기록 |
| [IMPLEMENTATION_PROGRESS.md](./work-log/IMPLEMENTATION_PROGRESS.md) | 구현 이력, 검증 결과와 남은 작업 |
| [SETUP_VERIFICATION.md](./work-log/SETUP_VERIFICATION.md) | 개발 환경 구성·장애 대응·검증 기록 |
| [DEVELOPMENT_VERSIONS.md](./work-log/DEVELOPMENT_VERSIONS.md) | 구성한 실행 환경과 도구 버전 |
| [DEPENDENCY_VERSIONS.md](./work-log/DEPENDENCY_VERSIONS.md) | 실제 패키지 버전 자동 생성 목록 |
| [USER_GUIDE.md](./work-log/USER_GUIDE.md) | 현재 기능 사용법 |
| [POSTGRES_EXPORT.md](./work-log/POSTGRES_EXPORT.md) | 현재 DDL 지원 범위와 검증 방법 |
| [SHARED_UI.md](./work-log/SHARED_UI.md) | 적용한 공통 UI API·테마·출처 |
| [LAN_HOSTING.md](./work-log/LAN_HOSTING.md) | 준비된 호스팅 구성과 실행·접속 확인 절차 |

## etc · 기타 보조 작업

| 문서 | 내용 |
| --- | --- |
| [문서 재분류 계획](./etc/2026-09-30-Docs-ClassificationPlan.md) / [결과·이동 목록](./etc/2026-09-30-Docs-ClassificationResult.md) | 분류 기준, 이동한 문서와 검증 |
| [README 현행화](./etc/2026-09-30-Documentation-ReadmeRefreshResult.md) | 제품 소개 문서 정리 |
| [공개 저장소 보안·main 관리 목록](./etc/2026-10-01-Repository-GitHubSettingsResult.md) | GitHub 설정 순서, 내부 주소 정리와 MIT 적용 기록 |
| [Git 동기화](./etc/2026-09-21-Git-RebasePushResult.md) | 원격 main 반영·문서 커밋 게시 |
| [Docker 장애 조사](./etc/2026-09-14-Docker-RootCauseResult.md) / [pnpm 경로 진단](./etc/2026-09-15-Toolchain-PnpmDiagnosisResult.md) | 로컬 개발 도구의 장애·환경 조사 |
| [Notion 커버 제작](./etc/2026-09-15-Brand-NotionCoverResult.md) | 외부 소개용 이미지 제작 |
| [예시 코드 ERD 생성](./etc/2026-09-30-ERD-RepositoryReverseEngineeringResult.md) | 기존 스키마를 MCP 프로젝트와 참고 산출물로 변환 |
| [DRIZZLE_START.md](./etc/DRIZZLE_START.md) | 구현한 기능을 소재로 배우는 Drizzle·SQL |

제품 기획·설계는 `planning`, 제품 구현·검증·운영은 `work-log`, 기타 보조 작업은 계획과 결과 모두 `etc`에 추가한다. `pnpm docs:versions`의 생성 위치는 제품 개발 재현용인 `work-log/DEPENDENCY_VERSIONS.md`로 유지한다.

## 성능 작업 위치

성능 작업은 codex/performance-lab 워크트리에서 수행한다. [격리 계획](./etc/2026-09-28-Workspace-PerformanceIsolationPlan.md)과 [결과](./etc/2026-09-28-Workspace-PerformanceIsolationResult.md)를 참고한다. 기본 D:/ChatGPT/ERD는 main이며 원시 결과는 lab의 artifacts/performance에 보존한다.
