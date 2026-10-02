# C3 버전별 프로젝트 snapshot 조회 결과

- [계획](../planning/2026-10-01-Database-VersionedReadApi.md). 실제 `GET /api/projects/:id/document-state`를 추가했다. read 권한으로 같은 row의 metadata/version/sequence와 raw sourceDocument 및 별도 native preview/진단을 반환한다. source 계약은 구조 검증만 하며 raw alias/ID를 정규화하지 않는다.
- 프로젝트 profile/revision을 필수로 전달하고 preview/프로젝트 문맥 및 native source mismatch 처리를 계약에서 검증한다. 조회가 migration/native canonicalization을 저장하거나 baseline을 발급하지 않는다.
- gallery metadata와 capabilities는 native fixture도 읽는다. 카드의 native 타입 caption은 DB 카탈로그의 기본 이름/배열/ENUM/legacy 원문이다. 파라미터·생성 옵션까지 포함한 전체 편집 표시는 C4에 남아 있다.
- v1 normalizer/getProject/export/baseline/events/새 sync 쓰기는 native 저장을 명시 409로 차단한다. 승인된 v1 replay/lookup은 새 쓰기 차단보다 먼저 기존 응답을 유지한다. native 다른 DB/profile 변경도 변환 준비 전 차단하고 rename 같은 metadata 수정은 원본을 유지한다.
- 새 contract 3개와 native gallery 1개 테스트 통과. 전체 검증에서 기존 write-auth fixture의 누락 schemaVersion을 발견해 실제 v1 형태로 보완했고 authorship 검증은 그대로 통과했다.
- 격리 PostgreSQL 실제 HTTP 테스트 6개 + 기존 autosync 8개 모두 통과: 세 DB v1 raw/preview 조회·원본/순서/baseline 불변, 인증/타 사용자 차단/보관/404, native fixture 조회/갤러리/capabilities, 구버전 조회/쓰기 보호, v1 accepted replay/lookup, DB 변경 차단/rename 보존, 문맥 mismatch 명시.
- 전체 `pnpm check`: 798개 통과/50개 건너뜀, 포맷·타입·빌드 통과. 격리 runner는 임시 DB/기록을 정리했다. 기존 큰 Vite 번들과 runner child-process 경고는 유지된다.

이번 native 저장 데이터는 API 활성화 없이 격리 테스트에서 직접 seed했다. native upgrade/sync ACK·UI/DDL 실행 검증으로 보고하지 않는다. 다음은 MCP/web versioned read 소비와 native 편집·upgrade/import/history 연결이다. DB와 무관한 review/personal 소비의 native canvas 연결도 저장 활성화 전에 완료해야 한다. 전체 명세는 미완료이며 기존 API/MCP 통합 실패 5건은 별도로 해소할 예정이다.
