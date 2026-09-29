# 타입 변경 검증과 Workspace 설계 검토 결과

## 확인한 상태

- 코드 기준 커밋: `f30023f` (`fix: deduplicate PostgreSQL type aliases in column editors`).
- MCP ezerd 프로젝트에서 5개 도메인, 15개 테이블 및 사용자 작성 workspace 초안을 확인했다. 운영 PostgreSQL에 직접 접속하여 스키마를 조사한 것은 아니다.
- 기존 ERD와 애플리케이션 코드는 수정하지 않았다. 아래 결과는 코드와 MCP 설계 데이터 검토이다.

## 타입 변경

- `packages/model/src/postgres-types.ts`는 `timestamp with time zone`을 `timestamptz`로 정규화한다. 선택지·카드 표기·PostgreSQL DDL 생성기가 이를 사용한다.
- 저장 문서 자체는 정규화하지 않는다. 기존 테스트도 `without changing saved data`를 검증한다. 계약의 physicalTypeSchema.name은 문자열이므로 과거 이름을 API/MCP에서 금지하는 구현은 아니다.
- MCP 전체 15개 테이블 조회 시 저장 타입 집계는 `timestamp with time zone` 22개, `timestamptz` 2개, `double precision` 2개였으며 numeric은 없었다. 사용자가 편집 중인 문서의 조회 시점 결과이다.
- `real`과 `double precision`은 선택지에 남아 있고 `float8`은 `double precision`으로 정규화된다. `double precision`을 `numeric(p,s)`로 바꾸는 구현은 없다.
- `review_threads.x/y`는 ERD와 서버 Drizzle 스키마 모두 double precision이다. double precision에 precision/scale을 붙이는 것은 지원되지 않으며 DDL 생성기에서도 거부된다.
- NUMERIC(p,s)는 전체 정밀도와 소수 자릿수를 지정하는 십진 수 타입이다. double precision은 부동소수점 타입이므로 단순 별칭 치환이 아니다. PostgreSQL 공식 문서에서 의미 차이를 확인했다.

## Workspace 초안에서 보완할 점

- `workspace`: workspace_id PK, workspace_name varchar(64), created_at timestamptz를 확인했다. 최초 조회 시 UUID 및 생성 시각 기본값은 없었다.
- `user_workspaces`: workspace_id와 user_id FK는 있으나 PK/UNIQUE가 없어 동일 멤버를 중복 등록할 수 있다. 두 FK의 ON DELETE는 NO ACTION이다.
- `projects.workspace_id`는 아직 없다. 멤버십과 프로젝트 소속을 연결해야 workspace가 실질적인 협업 경계가 된다.
- 현재 서버의 WorkspaceService라는 이름은 프로젝트 서비스 이름이며 실제 workspace 테이블/멤버십 구현을 의미하지 않는다. 프로젝트 조회와 export에는 현재 controller 수준 workspace membership 검사가 없고 listProjects에도 workspace 필터가 없다.
- 상세 제안과 도입 순서는 `docs/planning/2026-09-29-Workspace-TypeAuditAndDesign.md`에 기록했다. 기본 workspace owner와 기존 사용자 접근 정책은 실제 이관 전에 확정해야 한다.

## 검증

- `pnpm test apps/web/src/features/tables/column-type-options.test.ts apps/web/src/features/tables/column-type-display.test.ts apps/web/src/features/tables/column-defaults.test.ts packages/model/src/postgres.test.ts`: 공유 패키지 빌드 성공, 4개 파일 / 45개 테스트 통과.
- 런타임 계약과 정규화 함수로 과거 타입 허용 여부 및 표준 표기를 추가 확인했다.
- 일반 변경·실제 DB 마이그레이션·MCP 쓰기는 수행하지 않았다. 문서만 추가했다.

## 근거

- [PostgreSQL 날짜/시간 타입](https://www.postgresql.org/docs/current/datatype-datetime.html)
- [PostgreSQL 숫자 타입](https://www.postgresql.org/docs/current/datatype-numeric.html)
