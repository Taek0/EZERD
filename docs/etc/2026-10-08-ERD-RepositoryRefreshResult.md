# EZERD 레포 변경 재확인 결과

- [계획](2026-10-08-ERD-RepositoryRefreshPlan.md)
- 기준 커밋: `f71ae5e`. 대상: TY / ezerd (`903ec4ff-2ca4-4724-8d8a-3ec98765a68b`), version 78 / sequence 79.
- 레포 Drizzle 스키마와 현재 MCP 원본을 비교한 결과 스키마 수정 명령 0개. 19개 테이블, 142개 컬럼, 28개 FK가 일치한다.
- 이전 동기화 이후 `projects.document`와 `sync_client_baselines.document`의 TypeScript 타입만 `DesignDocument`에서 `StoredDesignDocument`로 변경됐다. JSONB 타입·기본값·NULL·제약조건에는 변화가 없다.
- 기존 비교 스크립트가 제안하는 23개 배치 명령은 오래된 세로형 배치와의 차이로, 적용하지 않았다. 사용자가 요청한 가로형 공유·개인 배치를 그대로 유지했다.
- 메타데이터로 보존한 CHECK 2개와 부분 UNIQUE 인덱스 1개의 표현식 지원 정책에는 변경이 없었다. 레포의 실제 제약 SQL과 저장된 메타데이터는 일치한다.
- `get_project_view` 정상: 공유 화면 노드 20개, 다음 페이지 없음.
- `list_view_relations` 정상: 관계 28개, 다음 페이지 없음. 이전 native v2 조회 실패가 해소된 것을 확인했다.
- 제품 코드와 EZERD 문서를 수정할 필요가 없어 MCP 쓰기를 수행하지 않았다. 문서만 추가하여 별도 형식 검사나 제품 테스트는 실행하지 않았다.
- 기존 작업 중인 UI 파일 및 `docs/EZERD.txt`는 수정/커밋하지 않았다.

검증 명령: `node --import ./apps/server/node_modules/tsx/dist/loader.mjs apps/server/scripts/compare-repository-erd.mjs .data/erd-refresh-2026-10-08`. 임시 비교 산출물은 Git 제외 경로에 보관했다.
