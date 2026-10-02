# C3/C4 native shared sync와 실제 MCP 편집 소비

- 시작 `d34860f`(제품 구현 head `49dfbe0`), 작업 트리 깨끗함. 기존 trusted native 후보 helper를 실제 row-lock 트랜잭션·저장/ACK에 연결하고 native MCP 편집 소비를 같은 단위에서 준비한다.
- native 전용 baseline/operation/lookup/events REST 경계와 NativeSyncService를 추가한다. 기존 v1 endpoint와 결과 재생은 보존하고 v1 reader가 v2 결과를 읽으면 명시 upgrade-required로 거부한다. 새 native 기능 usable gate는 유지한다.
- authorization과 요청 fingerprint 기반 replay를 새 검증보다 먼저 수행한다. 프로젝트 lock 뒤 replay를 재확인하고 서버 발급 baseline·현재 row/context/field versions로 후보 helper를 호출한다. raw claims, read-set, retired IDs 및 previous=current 정책을 완화하지 않는다.
- accepted/rejected 순서·감사 결과, accepted 최종 문서·field versions·deletion snapshots/tombstone·다음 baseline을 원자 저장한다. WS 알림은 commit 뒤 보낸다. native 후보/문맥에 맞는 v2 응답 계약을 사용한다.
- 실제 MCP native patch/delete/FK/column 명령은 trusted 서버 baseline에서 후보를 만들고 같은 native service에 저장한다. 명령 replay는 baseline 재발급 전에 검사한다. SDK 메타데이터와 실제 전체 runtime 입력/출력 검증을 구분한다. v2 저장은 이 소비 경로를 준비한 뒤 연결하며 UI/upgrade/import/history는 다음 단위에서 이어간다.
- 세 DB native 기존 값 보존·수정·삭제, legacy 복구 정책/신규 미검증 타입 차단, accepted/rejected replay, concurrency/참조 read-set, scope/권한, v1 guard와 WS/polling·실제 DB 상태를 격리 PostgreSQL HTTP/MCP 통합으로 검증한다. 전체 check·기록·독립 커밋 뒤 턴 종료 없이 다음 단위를 진행한다.
