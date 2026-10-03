# Native durable queue databaseChange writer

2026-10-03. [계획](../planning/2026-10-03-Database-NativeDatabaseChangeQueue.md)의 작은 코드 단위 완료. 수정 범위는 native-durable-queue.ts/test.ts와 계획/이 로그 네 파일이다. 사용자 최신 지시대로 직접 독립 커밋하며 root/gallery/cancellation/archive/서버 및 다른 agent WIP는 변경하지 않는다.

NativeDurableKind와 persisted-row runtime 허용 목록에 `databaseChange`를 추가했다. actor/project row key, schema version/store, transactional claim, fingerprint, owner/token/lease, unknown/uncertain 및 exact ACK/discard 검사는 기존 구현을 유지한다. 개인 CAS precondition 소비 proof는 여전히 privateCanvas에만 적용한다.

필수 fake-indexeddb의 별도 두 연결을 사용한 테스트를 보강했다. 기존 다섯 writer 경쟁과 private-only guard forloop에 새 kind를 포함한다. databaseChange 대 commands/history/privateCanvas/upgrade의 두 가지 진입 순서에서 하나만 claim 성공함을 확인한다. 원본 target/counter/operation/payload는 close/reopen에서도 유지되고 altered payload/kind/operation/actor/project는 송신/adopt/ACK로 해제할 수 없다. exact ACK 뒤 교체된 요청은 이전 finalizer/ACK로 제거되지 않는다.

crash lease는 활성 동안 busy, 만료 뒤 원본만 replay 가능한 unknown 상태를 유지한다. 신규 writer/변경 요청/discard는 계속 차단되며 old token은 새 lease를 무효화하지 못한다. databaseChange가 private CAS release를 요청하면 false이고 archive guard를 실행하지 않는다. caller가 검증한 terminal rejection에 대한 confirmRejected 이후에만 명시 discard가 가능하다. 새 kind admission 및 다른 알 수 없는 kind의 transaction abort/storage-unknown도 확인했다. 이 테스트는 queue 불변식 proof이며 원격 database/change ACK를 검증하는 제품 consumer의 책임을 대신하지 않는다.

검증: queue + native-private-cas-proof + native-save **3파일 82 PASS / skip0**. queue.ts/test.ts는 web DOM/strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes 기반 독립 noEmit 검사 PASS, root Prettier PASS 및 담당 diff whitespace 확인. 임시 typecheck 설정은 제거했다. 전체 web typecheck는 병렬 WIP `native-gallery-conversion.ts`의 direct zod import TS2307 및 이에 따른 consumer implicit-any 오류로 실패했다. 그 파일을 수정하지 않았으며 부모/Aristotle의 통합 후 전체 check가 필요하다.

```powershell
pnpm exec vitest run apps/web/src/features/projects/native-durable-queue.test.ts apps/web/src/features/projects/native-private-cas-proof.test.ts apps/web/src/features/projects/native-save.test.ts
pnpm exec prettier --check apps/web/src/features/projects/native-durable-queue.ts apps/web/src/features/projects/native-durable-queue.test.ts
```

읽기 인계: native-draft-archive의 categories는 editor/property의 보존 입력이며 durable kind union과 별개다. native-save의 pending loader는 commands-only이고 private loader/proof는 privateCanvas-only라 새 DB 변경을 해당 payload로 파싱하지 않는다. native-cancellation은 commands/history/upgrade만 지원하고 다른 kind는 명시 거부한다. DB 변경 재생/복구/ACK UI 및 root의 unknown→실제 IDB 재조회 보호는 Aristotle가 새 consumer로 연결해야 한다. 이 단위는 shared single-row 상호배제를 제공하며 databaseChange를 기존 cancel_native_request 또는 개인 CAS 해제로 우회하지 않는다.
