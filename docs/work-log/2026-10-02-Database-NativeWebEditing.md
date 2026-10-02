# C4 native 웹 기본 속성 편집과 저장 결과 복구

- 계획: [NativeWebEditing](../planning/2026-10-02-Database-NativeWebEditing.md).
- native 테이블/컬럼의 물리 이름·설명과 논리 이름·정의를 실제 공유 저장에 연결했다. v1 편집기로 투영하지 않으며 타입/default/generation/legacy 원문을 부분 patch에서 보존한다.
- REST `POST /projects/:id/native-sync/commands`는 URL 프로젝트 식별자를 고정하고 MCP native executor와 동일한 최종 후보·권한·revision·idempotency 검증을 사용한다. 인증 없는 요청/본문 프로젝트 재지정/보관 프로젝트 신규 쓰기를 차단한다.
- 사용자·프로젝트별 pending 요청을 POST 전에 보관하고 operation/group/client ID 및 version/sequence/revision을 유지한다. 결과 조회를 먼저 하고 404일 때만 동일 문맥에서 같은 요청을 재생한다. readonly에서는 조회만 허용한다.
- 입력 초안을 사용자·프로젝트·객체별로 보관한다. 오래된 초안은 원본 네 필드와 현재 값을 비교하고 사용자의 명시적 검토 후 수정한다. 수정하지 않은 필드는 최신 내용에서 계승한다. ACK 요청에 해당하는 초안만 재조회 전에 정리해 reload와 초안 삭제 사이의 경쟁을 방지하며 다른 탭의 더 최신 입력은 보존한다.
- native draft/pending/ACK/권한 재생/저장 공간 실패/타 사용자 격리 단위 테스트 9개, 기존 화면 테스트 2개를 확인했다. 세 DB HTTP native 명령 테스트를 추가했다. 격리 PostgreSQL API/MCP/versioned/autosync 52개가 통과했다.
- 최종 `pnpm check`: 포맷·타입·빌드 통과, 849개 테스트 통과/69개 DB 통합 테스트 건너뜀. 실제 DB 통합 실행은 위 별도 격리 테스트를 사용한다. 기존 Vite 번들 크기 경고는 유지된다.
- 실제 브라우저에서 PG 컬럼 입력의 reload 복원, 저장 완료 후 ACK 응답을 누락시킨 503, 새로고침 후 저장 결과 조회와 단 한 번의 version/sequence 증가를 확인했다. 최초 socket 단절에서는 브라우저가 같은 POST를 재시도했고 서버 idempotency로 한 번만 적용됐다. MySQL 논리 정의/SQLite 테이블 이름도 실제 저장했고 원래 legacy 타입/default가 유지됐다. 뷰어 로그인과 안내까지 확인했으나 최종 native readonly 화면 검사는 사용자 중단으로 실행되지 않았으므로 그 브라우저 검증을 완료로 계산하지 않는다.
- [저장 결과 화면](assets/2026-10-02-Database-NativeWebEditQA.png). 임시 QA 서버는 중단 때 종료되었으며 남은 전용 DB는 고정 fixture 프로젝트 ID 3개로 소유를 확인한 뒤 제거했다. 임시 harness도 제거했다.

현재 범위는 기본 속성 편집이다. DB별 타입/options/default/generated/키/index/CHECK 편집, native ERD/clipboard, 웹 upgrade 진입, import/export/history 및 DDL/실제 SQL 실행은 후속 단위다. 전체 명세와 신규 기능 usable gate는 아직 완료되지 않았다.
