# Native upgrade ACK 재생 권한과 원문 보존 구현 결과

- 시작 HEAD `5d1ef29`. [계획](../planning/2026-10-02-Database-NativeUpgradeReplay.md)에 따라 독립 단위 구현과 targeted 검증을 완료했다. git add/commit은 하지 않았다.

## 변경 파일

1. `apps/server/src/workspace/native-upgrade.service.ts`
2. 새 `apps/server/test/native-upgrade-replay.integration.test.ts`
3. `docs/planning/2026-10-02-Database-NativeUpgradeReplay.md`
4. 이 결과 문서.

## 동작

- 기존 writable db.transaction 안에서 현재 read 권한 → actor/fingerprint replay → current project UPDATE lock → replay 재확인 → 신규 design 권한 → 기존 전체 요청/context/active/source/migration 검증 순서로 바꿨다.
- 동일 actor가 read를 유지하면 viewer/workspace archive/project archive에서도 같은 요청의 ACK를 재생한다. actor 또는 fingerprint 불일치는 기존 `sync.replay-mismatch` 409다. 미가입 actor/read 권한 상실은 403이며 viewer/workspace archive의 신규 요청도 403이다. project archive의 신규 요청은 기존 `project.archived` 409다.
- 캐시 결과는 nativeSyncOperationResultSchema.safeParse로 구조만 확인하고 stored result의 structuredClone을 반환한다. actor의 앞뒤 공백을 비롯한 과거 ACK 원문은 현재 parser의 trim/default로 바꾸지 않는다. 잘못된 저장 ACK는 `sync.protocol-mismatch` 409로 명시 차단한다. 기존 잘못된 저장값의 Zod 예외에 대한 처리도 이 경계로 정리했다.
- 최소 operationId 검사와 fingerprint 계산은 조회 전 유지하며 전체 upgrade 요청 스키마 검증은 두 replay 조회 뒤에 수행한다. 예전 요청의 최신 스키마 불일치나 현재 head/context/source/baseline 변경 때문에 이미 저장된 동일 ACK를 차단하지 않는다.
- 재생과 차단 요청은 project/document/counters/ledger/baselines/field versions/tombstones를 변경하지 않고 database-context 알림을 발행하지 않는다. 새 upgrade의 commit 이후 publish 로직은 그대로다.
- migration의 locked 서버 source, derived previous, 현재 DB 정책/gate 및 기존 v1 audit/boundary 기록은 수정하지 않았다. 임의 native/legacy 입력을 previous로 받는 경로도 추가하지 않았다.

## 검증

- `pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/native-upgrade-replay.integration.test.ts`: 실제 AppModule/configureApplication + local disposable PostgreSQL **9개 통과**.
- 4개 권한 조건(viewer/workspace archive/project archive/viewer+workspace archive)에서 동일 ACK, 다른 fingerprint/actor, fresh operation, outsider/read loss 및 상태 불변을 검사했다. 추가로 raw cached actor, 역사적 요청, context/head/source 변경, 동시 동일 요청, 손상된 ACK 거부를 검사했다.
- actor/session/workspace/project는 실제 REST로 생성하고 실제 POST `/api/projects/:id/document/upgrade`를 호출했다. 현재 허용되는 빈 PostgreSQL 설계의 실제 migration을 사용했으며 gate/validator/서비스/권한은 mock하지 않았다. 실제 gateway publish를 call-through spy로 관찰해 replay/차단 시 추가 호출이 없고 동시 fresh upgrade는 한 번만 publish함을 검사했다.
- 역사적 요청 fixture는 기존 accepted ledger fingerprint만 과거 요청의 서버 해시로 설정했다. 동일 과거 요청의 새 operationId는 최신 요청 검증에서 400으로 차단했다. raw actor fixture는 저장 result만 바꾸고 전체 ACK equality로 원문 보존을 확인했다. 현재 head/context fixture는 테스트 프로젝트만 변경했다. 제품의 기존 데이터/gate flags는 변경하지 않았다.
- 동시 upgrade는 version/sequence/revision 및 ledger가 한 번 증가하고 ACK baseline이 하나임을 확인했다. deletion snapshot의 v1 원본은 최초 프로젝트 document와 일치하고 tombstone은 보존된다.
- 담당 서비스와 새 integration 파일에 루트 strict/NodeNext/decorator/exact optional/noUncheckedIndexedAccess 옵션의 targeted tsc noEmit 통과. 해당 서비스와 필요한 의존 파일만 기존 dist에 targeted emit한 뒤 실제 main AppModule을 부팅했다. 임시 barrel/독립 모듈을 사용하지 않았고 전체 server build/check로 계산하지 않는다.
- 담당 TS 파일 Prettier 및 diff whitespace 검사 통과. docs는 루트 .prettierignore에 따라 별도 관리한다.

## 통합과 제한

- 기존 서비스/POST route를 사용하므로 AppModule/index 등록은 추가로 필요 없다. main은 위 네 파일만 독립 commit할 수 있다. 다른 agent의 Replay/history/MCP/model/UI 변경은 수정하지 않았다.
- main이 완료한 MCP upgrade의 validated raw 출력 helper는 이 단위에서 수정하지 않았다. 이 테스트는 실제 upgrade REST 경계 검증이며 신규 MCP wire 회귀를 수행했다고 주장하지 않는다.
- 지정 scope의 구현과 검증은 완료했고 main 리뷰 가능한 ready 상태다. 전체 QA/커밋은 main 담당이다. 다음 legacy import provenance 단위는 아직 시작하지 않았다.
