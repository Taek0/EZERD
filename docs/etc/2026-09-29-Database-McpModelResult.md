# EZERD DB 구조 MCP 구성 결과

- 프로젝트명: `ezerd`
- 프로젝트 ID: `903ec4ff-2ca4-4724-8d8a-3ec98765a68b`
- 생성 방법: EZERD MCP `import_project`, 생성 직후 version 0 / syncSequence 0.
- 기준: 현재 저장소 `apps/server/src/db/schema.ts` 및 `apps/server/drizzle/meta/0010_snapshot.json`. 운영 DB의 실제 적용 상태를 직접 확인한 결과는 아니다.
- 구성: 테이블 13개, 컬럼 95개, PK·UNIQUE 키 18개, 실제 FK 18개, ENUM 1개.
- 도메인: 인증 3개 테이블, 프로젝트 3개, 리뷰 3개, 동기화 4개. 개요에 도메인 의존 관계 5개를 표시했다.
- 각 도메인 화면에 필요한 외부 부모 테이블을 함께 배치했다. 개요 포함 5개 화면, 카드 배치 22개이며 부모에서 자식으로 왼쪽→오른쪽 계층을 구성했다.
- 컬럼 타입, 길이, 기본값, NULL 허용, 복합 키, FK 삭제·갱신 동작을 보존했다. 일반 인덱스와 CHECK는 테이블의 physical customProperties에 JSON으로 보존했다. 따라서 일반 인덱스와 CHECK는 네이티브 제약 객체가 아닌 참조용 속성이다.
- `projects.document` 등 JSONB 내부 객체는 별도 물리 테이블로 추가하지 않았다. 사용자 관리 파일 `docs/EZERD.txt`는 변경하지 않았다.

## 검증

- `get_project_summary`: 예상 객체 수와 실제 저장 결과 일치.
- 모든 테이블의 `get_table_details`: 정규화 비교로 테이블 정의, 컬럼, 키, 연관 FK 전체가 입력과 일치함을 확인.
- `get_project_view`: 모든 화면의 전체 페이지 재조회 완료. `nextCursor`는 모두 null.
- 재조회한 카드 좌표에서 모든 카드 쌍의 가로 또는 세로 간격이 40px 이상임을 확인. 콘텐츠 크기는 저장소의 `tableCardMetrics`로 산정했다.
- `list_view_relations`: 인증 2개, 프로젝트 4개, 리뷰 6개, 동기화 6개의 FK 표시 확인.
- `diagnose_project`: diagnostics 빈 배열.
- `pnpm format`, `pnpm format:check`: 통과. 애플리케이션 코드 변경 없음.
