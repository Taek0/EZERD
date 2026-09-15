# 문서 안내

문서를 주된 목적에 따라 두 폴더로 나눈다. 계획 문서에 현재 상태가 일부 들어 있거나 작업 문서에 남은 과제가 포함돼 있더라도 원문은 유지한다. 폴더 분류는 구현 완료 여부를 대신하지 않으며, 각 문서의 상태와 검증 기록을 기준으로 판단한다.

## planning · 구현 이전 계획·설계

| 문서 | 내용 |
| --- | --- |
| [REQUIREMENTS.md](./planning/REQUIREMENTS.md) | 제품 요구사항과 작업 흐름 |
| [RELEASE_SCOPE.md](./planning/RELEASE_SCOPE.md) | 출시 범위와 추가 확정 계획, 완료 기준 |
| [DATA_MODEL.md](./planning/DATA_MODEL.md) | 논리·물리 모델의 설계 원칙 |
| [TECH_STACK.md](./planning/TECH_STACK.md) | 기술 선택과 구조 설계, 검토 이력 |
| [DESIGN_SYSTEM.md](./planning/DESIGN_SYSTEM.md) | 시각·조작 기준과 디자인 결정 |
| [EDITOR_WORKFLOW_DECISIONS.md](./planning/EDITOR_WORKFLOW_DECISIONS.md) | 다음 편집 기능의 확정 사항과 미확정 세부 설계 |

## work-log · 진행한 작업·검증·사용 안내

| 문서 | 내용 |
| --- | --- |
| [IMPLEMENTATION_PROGRESS.md](./work-log/IMPLEMENTATION_PROGRESS.md) | 구현 이력, 검증 결과와 남은 작업 |
| [SETUP_VERIFICATION.md](./work-log/SETUP_VERIFICATION.md) | 개발 환경 구성·장애 대응·검증 기록 |
| [DEVELOPMENT_VERSIONS.md](./work-log/DEVELOPMENT_VERSIONS.md) | 구성한 실행 환경과 도구 버전 |
| [DEPENDENCY_VERSIONS.md](./work-log/DEPENDENCY_VERSIONS.md) | 실제 패키지 버전 자동 생성 목록 |
| [DRIZZLE_START.md](./work-log/DRIZZLE_START.md) | 구현한 기능으로 설명하는 Drizzle·SQL |
| [USER_GUIDE.md](./work-log/USER_GUIDE.md) | 현재 기능 사용법 |
| [POSTGRES_EXPORT.md](./work-log/POSTGRES_EXPORT.md) | 현재 DDL 지원 범위와 검증 방법 |
| [SHARED_UI.md](./work-log/SHARED_UI.md) | 적용한 공통 UI API·테마·출처 |
| [LAN_HOSTING.md](./work-log/LAN_HOSTING.md) | 준비된 호스팅 구성과 실행·접속 확인 절차 |

새 기획·설계 결정은 `planning`, 실제 구현·검증·운영 안내는 `work-log`에 추가한다. `pnpm docs:versions`의 생성 위치는 `work-log/DEPENDENCY_VERSIONS.md`다.
