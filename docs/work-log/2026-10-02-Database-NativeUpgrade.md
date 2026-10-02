# C2/C3 명시적 native 업그레이드 결과

- 계획: [NativeUpgrade](../planning/2026-10-02-Database-NativeUpgrade.md), 시작 `992f44d`.
- REST `/projects/:id/document/upgrade` 및 실제 MCP `upgrade_project_document`를 연결했다. operationId/clientId와 expectedVersion/sequence/databaseRevision은 필수다. design 권한·재생·row lock 재생 확인 뒤 새 검증을 수행한다.
- 변환 원본은 잠긴 프로젝트의 v1 행이다. 기존 순수 migration으로 PG의 알려진 의미만 변환하고 MySQL/SQLite 및 unknown type/default/namespace는 legacy로 유지한다. 전체 native 구조/예산을 검사하고 기존 source에서 유래한 복구 문제는 보존한다. 원본 행과 migration 진단을 upgrade 감사 snapshot에 기록한다.
- document/version·DB revision·sync sequence, 기존 baseline 삭제와 실제 새 native baseline, 이력·format boundary field versions를 원자 갱신한다. 과거 entity field versions/tombstone은 유지해 ordinary ID 재사용을 허용하지 않는다. native polling은 upgrade boundary를 reset으로 반환하고 context head는 commit 뒤 보낸다.
- GET은 원본을 변경하지 않으며 ordinary native 쓰기의 legacy/retired ID 정책은 그대로다. native usable gate도 비활성이다. 새 physical 타입 사용 가능 여부와 형식 upgrade를 구분한다.

## 검증

- 전체 `pnpm check`: **840개 통과/66개 건너뜀**, 포맷·타입·빌드 통과. 기존 대형 웹 번들 경고가 있다.
- 최종 빌드 뒤 격리 PostgreSQL API/MCP/versioned/autosync **49개 통과**. 세 DB를 실제 HTTP/MCP로 업그레이드하고 원문 audit·migration 일치·revision/version/sequence·새 baseline 및 native 복구 편집을 확인했다.
- 같은 operation의 동시 재생은 한 번만 적용되며 다른 요청/구 version/revision/권한 없는 viewer를 거부한다. 기존 승인된 v1 작업은 동일 응답으로 재생하고 새 v1 쓰기는 upgrade-required로 차단한다. 보관 뒤 동일 승인 upgrade 재생 역시 유지했다.

native 웹 편집 진입, native 전송/이력·undo/restore, DB별 물리 편집 UI/DDL/고급 타입·기능 및 실제 SQL/DB 변환은 남아 있다. 다음 native 웹 편집 소비 단위를 같은 턴에서 이어간다.
