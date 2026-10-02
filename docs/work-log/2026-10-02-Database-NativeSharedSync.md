# C3/C4 native shared sync 실제 저장·MCP 소비 결과

- 계획: [NativeSharedSync](../planning/2026-10-02-Database-NativeSharedSync.md). 제품 시작 `49dfbe0`, 진행 방식 기록 `d34860f` 이후 구현했다.
- NativeSyncService와 `/projects/:id/native-sync/{baseline,operations,operations/:operationId,events}` REST 경계를 연결했다. 서버 발급 baseline은 native 저장 원문을 검사하고 정규화/업그레이드가 필요한 원본을 자동 덮어쓰지 않는다. 같은 row/profile/revision/version/sequence에서 baseline을 발급한다.
- 권한·operation identity/fingerprint 재생을 먼저 검사하고 row lock 아래 재생을 재확인한 뒤 전체 입력·raw claims 및 trusted 후보 검증을 수행한다. locked current가 previous이며 baseline 사용자/client/발급 시각·read-set·retired ID·최종 구조/예산/DB 정책을 기존 helper로 검증한다. v2 저장을 위해 이 정책을 완화하지 않았다.
- accepted/rejected 순서와 감사 결과를 저장하고 accepted 문서/version·field versions·deletion snapshots/tombstone·다음 baseline을 원자 기록한다. HTTP ACK는 실제 결과이며 WS operation은 commit 뒤 발행한다. polling은 누락 이력/구문맥/future cursor에 reset과 native snapshot을 반환한다. v1 lookup에서 v2 결과를 읽으면 명시 upgrade-required로 차단하며 과거 v1 결과 재생은 유지한다.
- 실제 `apply_native_project_changes` MCP 명령을 같은 저장 경로에 연결했다. table/column strict patch, 컬럼 추가, 명시 삭제 계획 및 PK 기반 FK 파생을 수행한다. 명령 재생은 baseline 재발급 전에 검사하며 includeDocument는 출력 옵션으로 fingerprint에서 제외한다. SDK 메타데이터는 얕은 구조를 제공하고 서비스/handler는 전체 AST·입력·출력 계약을 검사한다.
- native 구조/type·default·legacy 원문을 v1 physical payload에 투영하지 않는다. 미검증 native 타입·기능의 usable gate는 비활성으로 유지해 신규 입력을 차단한다. 이미 존재하는 문제의 안전한 설명 수정/삭제 등은 current 기반 복구 정책을 따른다.

## 검증

- 전체 `pnpm check`: 포맷·타입·테스트·빌드 통과, **840개 통과/62개 건너뜀**. 기존 대형 웹 번들 경고가 있다.
- 최종 빌드 후 격리 PostgreSQL 전체 API/MCP/versioned/autosync **45개 통과**. 세 DB native 문서에 REST/MCP로 실제 저장하고 원본 type/default 보존, field 경로·version/sequence·승인/거부 ACK·조회·polling을 확인했다.
- 승인/거부 재생, 출력 옵션만 다른 MCP 재생, DB revision 변경/보관 뒤 기존 승인 응답 유지, 미검증 새 타입 거부, 삭제 snapshot/tombstone 및 일반 요청의 retired ID 재사용 거부를 확인했다.
- 동시 동일 operation은 한 번만 저장하며, 위조 claims/ID trim·다른 사용자 baseline·actor 주입·명시 read-set 충돌을 거부했다. 실제 인증 WS에서 native ACK를 받은 뒤 DB의 동일 sequence/document가 커밋되어 있음을 확인했다.
- 새 baseline 계약은 DB 문맥과 native document를 묶고 공개 오류 목록을 제한한다. MCP 단위 mock constructor와 새 명령 목록도 갱신했다. 모델·계약 helper 통과를 실제 저장/ACK 통과로 대신 계산하지 않았다.

## 남은 작업 및 이어가기

native shared REST/MCP 쓰기는 연결됐지만 fresh 프로젝트 생성과 일반 웹 편집은 아직 v1이며 native 웹은 조회 전용이다. native upgrade/import/history·undo/restore, 실제 native 편집 UI/durable queue, DB별 DDL·SQL 실행·고급 타입/기능·DB 변환은 남아 있다. 현재 연결 범위를 전체 명세 완료로 간주하지 않는다.

다음은 native 웹 편집 소비 및 업그레이드/전송/이력 경로를 연결한다. 현재 commit 이후에도 턴을 종료하지 않고 다음 단위를 이어간다. 예약 프롬프트에는 세부 이력을 누적하지 않는다.
