# C4 MCP versioned 공유 snapshot 조회 결과

- [계획](../planning/2026-10-01-Database-VersionedMcpRead.md). `get_project_document_state`를 실제 MCP에 등록하고 인증된 사용자로 REST와 같은 versioned service/전체 계약을 사용한다. shared source/preview만 읽고 personal merge나 baseline 발급은 하지 않는다.
- SDK의 tool metadata는 raw/AST body를 opaque object로 표현하고 protocol/project/sequence/source version/native status/진단을 기술한다. 실행 handler는 원본·AST·DB 문맥을 포함한 전체 contracts 스키마로 검증한다. metadata의 표현 한계로 runtime 검증을 줄이지 않았다.
- instructions와 v1 조회/capabilities 설명에 preview available과 실제 usable 및 현재 v1 편집/쓰기 제한을 명시했다.
- SDK unit 6개 통과: tools/list와 outputSchema/annotations, structured response·actor 전달, native body 위조/비밀 값 미노출, spoofed input, read 권한/폐기된 토큰 확인. 기존 registry/auth tests도 통과했다.
- 격리 PostgreSQL versioned HTTP/MCP suite 7개 통과. 실제 StreamableHTTP MCP의 snapshot이 REST와 완전히 일치하고, old get_project가 native를 해석하지 않으며, 비멤버에게 source를 노출하지 않고 document/version/sequence/updatedAt/baseline을 유지했다.
- 전체 `pnpm check`: 800개 통과/51개 건너뜀, 포맷·타입·빌드 통과. 임시 DB와 MCP 로그는 runner가 정리했다. 기존 큰 Vite 번들 및 runner child-process 경고는 유지된다.

native 데이터는 격리 fixture seed이며 제품 native 저장/ACK는 아직 활성화하지 않았다. 다음은 review/personal의 공통 native canvas 소비와 web snapshot/native 편집, upgrade/import/history/sync 연결이다. 실제 DDL·DB 실행·브라우저 및 전체 명세 완료로 보고하지 않는다.
