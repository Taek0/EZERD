# Native upgrade ACK 재생 권한과 원문 보존 계획

- 기준 HEAD `5d1ef29`. [DB 기능 명세](2026-10-01-Database-CapabilitySpecification.md)의 5.1, 6.1, 6.2 및 기존 NativeReplayAccess 정책에 따른다.
- 변경 범위는 `apps/server/src/workspace/native-upgrade.service.ts`, 새 `apps/server/test/native-upgrade-replay.integration.test.ts`, 이 계획 및 동일 이름의 `docs/work-log` 결과 문서다. git add/commit은 main이 담당한다.

## 구현

- 기존 writable transaction을 유지한다. 현재 read 권한 확인 → 같은 actor/fingerprint 캐시 조회 → 프로젝트 UPDATE lock → 캐시 재조회 → 신규 design 권한 확인 → 전체 요청/현재 상태/migration 검증 순서로 처리한다.
- 최소 operationId와 fingerprint 계산은 유지한다. 같은 ID의 actor/fingerprint 불일치는 기존 `sync.replay-mismatch` 409다. read 권한 상실은 403이며 viewer/workspace archive는 동일 ACK 재생만 허용한다. 프로젝트 archive도 캐시 재생은 허용하되 신규 변경은 기존 active 검사를 유지한다.
- 저장 ACK는 구조만 검증하고 원문 structuredClone을 반환한다. 과거 actor 문자열·document·audit를 정규화하지 않는다. 재생에서는 ledger/baseline/field version/tombstone/프로젝트 및 WS 발행을 변경하지 않는다.
- locked 서버 v1 원본에 대한 기존 migration/previous/DB 정책/gate는 변경하지 않는다. main 소유 MCP 출력 helper/AppModule도 변경하지 않는다.

## 검증

- 실제 AppModule/configureApplication을 부팅하고 isolated local PostgreSQL runner로 POST `/api/projects/:id/document/upgrade`를 호출한다.
- viewer/workspace archive/project archive에서 동일 ACK와 신규 변경/다른 fingerprint/다른 actor/read loss의 차이를 확인한다. trim될 수 있는 raw actor, 최신 runtime schema에 맞지 않는 역사적 요청, 현재 head/context 변경, 동시 동일 요청 및 상태 불변을 확인한다.
- 대상 파일 Prettier, strict targeted TypeScript와 integration만 실행한다. 전체 build/check 및 임시 모듈을 실제 AppModule 검증으로 계산하지 않는다.
