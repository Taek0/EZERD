# 공유 메뉴 DDL 내보내기 사전 조사 결과

- 조사일: 2026-10-01
- 계획: [사전 조사 범위](../planning/2026-10-01-Canvas-DDLExportAssessment.md)
- 기준: 현재 작업 트리와 Git 이력. 조사 중 다른 작업의 미커밋 변경도 존재하므로 아래 줄 번호와 파일 수는 구현 시 다시 확인한다.
- 이번 변경: 조사 문서만 작성. 제품 코드 및 `docs/EZERD.txt`는 변경하지 않음.

## 결론

PostgreSQL DDL 생성 엔진과 진단 보조 함수는 남아 있다. 현재 공유 메뉴에는 프로젝트 JSON과 PNG만 있으며 DDL 호출·SQL 다운로드·결과 표시 연결은 없다. PostgreSQL 프로젝트 전체의 생성 DDL을 내보내는 범위라면 주로 프런트엔드 연결 복원 작업이며 새 서버 API나 DB 마이그레이션은 필요하지 않다.

Git 커밋 `ae51b81`(2026-09-14, `feat(editor): simplify the physical canvas and project controls`)은 당시 `apps/web/src/App.tsx`에서 `downloadDdl()`, DDL 버튼, 진단 상태 및 결과 패널을 제거했다. 엔진을 유지했다는 기록은 [당시 작업 로그](2026-09-14-PhysicalCanvas-Simplification.md)에도 있다. 과거 코드를 참고할 수 있지만 현재 자동 저장·협업·번역·직접 소속 테이블 구조에 맞춰 연결해야 한다.

## 현재 남아 있는 코드

| 영역 | 현황 | 근거 및 재사용 방식 |
| --- | --- | --- |
| SQL 생성 | 구현됨 | `packages/model/src/postgres.ts:170`의 `exportPostgres(document)`가 `{ sql, diagnostics, canExport }` 반환. `packages/model/src/index.ts`에서 공개 |
| 지원 범위 | PostgreSQL 생성 DDL | 스키마, ENUM, 물리 테이블·컬럼, 타입·배열·지원되는 기본값·NOT NULL, PK/UNIQUE, 복합·순환 FK, 삭제/갱신 동작, 테이블·컬럼 COMMENT 생성 |
| 오류 차단 | 구현됨 | 물리 테이블 없음, 빈 물리 컬럼, 중복·잘못된 식별자, 미지원 타입/기본값, 키/FK 불일치 등을 진단. 오류 하나라도 있으면 `canExport=false`, `sql=''` |
| 진단 대상 찾기 | 보조 함수만 존재 | `apps/web/src/features/tables/ddl-diagnostics.ts:5`. 테이블·컬럼·키·관계·도메인의 라벨과 이동 좌표 계산. 현재 사용처는 테스트뿐이며 결과 UI 연결 없음 |
| 진단 스타일 | 일부 잔존 | `apps/web/src/features/comments/comments.css:189`의 `.ddl-diagnostics`. 현재 화면 테마 및 배치에 적합한지는 재검토 필요 |
| 메뉴·실행 상태 | 구현됨 | `apps/web/src/features/canvas/Canvas.tsx:1264` 부근의 공유 Dropdown, `exporting`, `exportError`, 중복 실행 차단 재사용 가능 |
| 자동 저장 확인 | JSON 내보내기에 연결됨 | `apps/web/src/app/App.tsx:1130` 부근에서 `flushAutosave()` → `prepareToLeave()` → pending/storageFailure 확인 |
| 서버 설계 조회 | 구현됨 | `GET /api/projects/:id/export`는 JSON 전송 형식, `GET /api/projects/:id`는 프로젝트·설계 문서 반환. 둘 중 하나로 저장된 공유 설계 조회 가능 |
| 권한 | 기존 조회 권한 재사용 가능 | 서버 `WorkspaceService.getProject()`는 `runProject(..., 'read', ...)` 사용. DDL 전용 쓰기 권한 도입 필요 없음 |
| 다운로드 방식 | JSON/PNG에 존재 | `ProjectTransfer.tsx:18`의 Blob + object URL + 다운로드 링크 패턴 재사용. 함수 자체는 JSON 전용이므로 DDL용 래퍼 추가 또는 작은 공용 함수 추출 필요 |
| 테스트 | 존재 및 통과 | 생성기·ENUM·타입 정책·도메인 없는 테이블·진단 대상·프로젝트 전송 파일 테스트 확인 |

생성기는 화면이나 도메인의 선택 상태가 아니라 문서 전체의 물리 테이블을 대상으로 한다. 도메인이 없는 테이블도 포함한다. 논리 전용 객체·업무 관계·개인 화면 배치는 DDL 대상이 아니다. 기존 생성기는 생성용 SQL이며 기존 DB와의 차이를 계산하는 마이그레이션 생성기가 아니다.

## 추가해야 할 부분

1. **공유 메뉴 항목**: `DDL 내보내기` 항목 및 `onExportDdl` 콜백 연결. 기존 내보내기 상태와 오류 안내 재사용. PNG의 `nodes.length` 조건을 복사하지 않는다. 도메인 맵에 카드가 없어도 소속 없는 물리 테이블의 DDL은 내보낼 수 있다.
2. **데이터 기준 및 저장 처리**: JSON과 동일하게 자동 저장과 동기화를 처리한 뒤 저장된 공유 설계를 조회하여 생성하는 방식을 권장한다. 기존 JSON 다운로드 함수와 설계 조회 단계를 분리하거나 기존 프로젝트 조회 API를 사용한다. 비동기 대기 후 클릭 시점의 오래된 `opened.document`를 그대로 생성기에 전달하지 않도록 한다.
3. **SQL 파일 다운로드**: `exportPostgres()` 호출, `canExport` 확인, UTF-8 `.sql` Blob 생성, 프로젝트 이름 기반 안전한 파일명, URL 해제. 진단이 있으면 파일을 만들지 않는다. JSON 파일명 정제 규칙을 참고하되 확장자 전용 함수는 별도로 둔다.
4. **진단 결과 화면**: 오류 목록, 닫기, 대상 테이블로 이동을 복원한다. 기존 `diagnosticTarget()`과 `focusTarget` 연결을 재사용한다. ENUM 진단은 현재 라벨·이동 처리에 ENUM 분기가 없어 별도 라벨 및 ENUM 관리창 이동을 보완할지 결정한다. 프로젝트 전환·재실행 시 결과를 초기화한다.
5. **번역과 접근성**: 메뉴명, 생성 성공/실패, 결과 제목·닫기·이동 문구를 번역 등록하고 키보드 실행·포커스·상태 안내 확인. 생성기 진단 메시지는 현재 한국어 문자열이므로 영문 진단까지 요구하면 진단 코드별 번역 또는 모델 메시지 분리가 추가 범위다.
6. **회귀 검증**: 정상 파일 생성과 오류 시 다운로드 차단, 저장 실패·충돌·대기, 반복 실행, 읽기 전용/보관 프로젝트, 빈 설계, 도메인 없는 테이블, 프로젝트 전환, 진단 이동, 메뉴 키보드 동작 및 실제 다운로드 확인.

## 구현 범위와 작업량 추정

아래는 구현 전 추정이며 확정 견적이나 실제 변경 줄 수가 아니다. 공통 기반 완성도를 임의의 백분율로 표현하지 않고 누락된 작업으로 구분한다.

| 선택 범위 | 예상 규모 | 추가 내용 |
| --- | --- | --- |
| 최소 연결 | 작음: 제품 파일 약 4~5개, 약 80~150줄 + 검증 | 메뉴, App 콜백, SQL 다운로드 유틸, 번역. 오류는 기존 오류 영역에 요약 표시. 생성기·서버 변경 없음 |
| 권장 범위 | 작음~중간: 제품 파일 약 5~8개, 약 150~300줄 + 테스트 | 최소 연결 + 진단 목록/닫기/테이블 이동, 조회와 다운로드 분리, 결과 상태 초기화, 필요한 스타일. ENUM 이동과 영문 진단 전체 지원은 별도 추가 가능 |
| MySQL/SQLite도 실제 방언 출력 | 별도 기능 개발 | 해당 SQL 생성기, 타입·기본값·ENUM·키/FK 정책, 진단 및 실행 검증이 새로 필요. 메뉴 연결 규모를 넘어섬 |

핵심 수정 후보는 `Canvas.tsx`, `App.tsx`, DDL 다운로드/조회 유틸, 진단 결과 컴포넌트, 번역 파일이며 필요 시 `ProjectTransfer.tsx`와 진단 스타일을 조정한다. 기존 엔진의 지원 범위를 유지하면 모델/계약/서버 API/DB 스키마 변경은 필수가 아니다.

## 권장 UX 기준

- 메뉴 순서: 프로젝트 내보내기 → DDL 내보내기 → 고화질 PNG.
- DDL 범위: 프로젝트 전체의 물리 설계. 현재 화면만 내보내기는 FK·ENUM 의존성 처리가 필요하므로 별도 기능으로 다룬다.
- 방언: PostgreSQL임을 메뉴 보조 문구나 결과 화면에 명시한다. 프로젝트 `databaseKind`에는 PostgreSQL/MySQL/SQLite가 있지만 현재 생성 엔진은 PostgreSQL뿐이다. MySQL/SQLite 프로젝트에서 암묵적으로 PostgreSQL SQL을 내보내지 않도록 비활성화·사유 안내 또는 명시적인 PostgreSQL 출력 선택을 제공한다.
- 오류: 파일을 생성하지 않고 수정 대상 목록 표시. ENUM 오류는 최소한 ENUM 이름을 보여 주고 이동은 별도 지원 여부 결정.
- 권한: 기존 프로젝트 읽기 권한을 기준으로 내보내기 허용. 편집 권한이 없다는 이유로 다운로드까지 차단할 필요는 없다.

이 기준은 조사 결과에 따른 제안이며 이번 작업에서 제품 동작으로 구현하지 않았다.

## 검증 결과 및 한계

- 실행: `pnpm exec vitest run packages/model/src/postgres.test.ts packages/model/src/postgres-enum.test.ts packages/model/src/postgres-types.test.ts packages/model/src/direct-table-canvas.test.ts apps/web/src/features/tables/ddl-diagnostics.test.ts apps/web/src/features/projects/project-transfer.test.ts`
- 결과: 6개 파일, 71개 테스트 통과.
- `pnpm format:check` 실행: 조사와 무관한 제품 코드/테스트/임시 QA 파일 25개에서 형식 경고로 실패. 기존 및 동시 작업의 변경을 건드리지 않기 위해 전체 포맷 쓰기는 실행하지 않았다. 이번 문서 두 파일은 루트 `.prettierignore`의 `docs/`, `**/*.md` 제외 대상이다.
- 현재 실제 브라우저 SQL 다운로드나 DB 실행 검증은 수행하지 않았다. `scripts/verify-postgres-export.mjs`와 `pnpm test:ddl`이 실제 로컬 PostgreSQL 검증 경로로 남아 있다. 과거 성공 기록은 [ENUM DDL 로그](2026-09-14-Enum-DDL.md)에서 확인했으며 이를 이번 실행 결과로 간주하지 않는다.
