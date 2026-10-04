# Native databaseChange precondition 소비 queue fence

2026-10-03. [계획](../planning/2026-10-03-Database-NativeDatabaseChangePrecondition.md)의 독립 작은 단위 완료. queue.ts/test.ts와 계획/이 로그 네 파일만 변경한다. Aristotle의 원격 proof/consumer와 root/server, 기존 private CAS 및 confirmRejected는 변경하지 않았다. 독립 커밋 후 freeze한다.

## API와 의미

`confirmDatabaseChangePreconditionConsumed(pending, token, guard): Promise<boolean>`를 추가했다. guard는 필수 동기 callback이다. databaseChange kind, exact payload fingerprint/operation, actor/project row, current owner/token, 아직 유효한 lease와 uncertain=true를 IndexedDB transaction 안에서 확인한다. fence 손실이나 이미 소비된 같은 lease는 false이며 guard를 실행하지 않는다. guard가 성공하면 uncertain=false만 기록하고 원래 row/원문/송신 token은 유지한다. guard throw 및 Promise/thenable 반환은 transaction을 abort한다.

이 성공은 **no-new-mutation proof**다. 원래 요청이 과거에 적용되지 않았음을 뜻하는 terminal ledger/no-applied rejection 또는 accepted ACK가 아니다. 일반409/404나 transport failure만으로 증명되지 않는다. caller가 fresh GET의 단조 version/revision과 원래 expected 조건, 현재 actor/project 문맥을 검증하고 원문 archive 영속 쓰기·readback까지 guard 안에서 완료해야 한다. consumer의 원격 정책 검증은 Aristotle 소유다.

```ts
const confirmed = await queue.confirmDatabaseChangePreconditionConsumed(pending, token, () => {
  // Caller-owned: assert still-current actor/context + validated fresh remote proof.
  // Caller-owned: synchronously preserve exact original input, verify archive readback.
});
// The row still exists; endTransmission precedes separately authorized explicit discard.
```

endTransmission 뒤에는 pending 상태로 남고 명시 discard로만 삭제한다. 그 전에 재송신하면 다시 uncertain=true가 되며 이전 proof를 재사용할 수 없다. 같은 owner/token으로 동시에 소비하려 해도 guard는 한 번만 실행된다. IDB abort는 외부 archive의 이미 발생한 부작용을 되돌리지 않는다. archive readback 실패 뒤 일부 archive가 존재해도 durable row는 uncertain을 유지하며 폐기가 허용되지 않는다.

## 검증

필수 fake-indexeddb 두 연결의 wrong kind/payload/op/actor/project, wrong owner/token, exact expiry, old token/new lease 및 재송신을 확인했다. commands/history/privateCanvas/upgrade는 새 메서드로 해제할 수 없고 guard도 실행되지 않는다. fresh proof 실패·actor context 변경·archive quota/readback 실패를 동기 guard fault injection으로 검증했다. 실패 후 connection close/reopen에서도 원래 요청과 unknown/discard 차단이 유지된다. 성공은 동시 proof guard once/row 유지/활성 송신 중 discard busy/end 후 명시 discard/보관 원문 유지까지 확인했다.

- queue + native-private-cas-proof + native-save: **3파일 94 PASS, skip0** (이 단위의 새12 case 포함).
- queue.ts/test.ts: web DOM/strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes 기반 독립 noEmit typecheck PASS. 임시 `.data/native-database-precondition-typecheck.tmp.json`은 삭제했다.
- root Prettier 및 담당 diff whitespace PASS. production diff는 새29줄 메서드만이며 private CAS/confirmRejected 본문은 동일하다.

```powershell
pnpm exec vitest run apps/web/src/features/projects/native-durable-queue.test.ts apps/web/src/features/projects/native-private-cas-proof.test.ts apps/web/src/features/projects/native-save.test.ts
pnpm exec prettier --check apps/web/src/features/projects/native-durable-queue.ts apps/web/src/features/projects/native-durable-queue.test.ts
```

원격 HTTP fresh GET/409/실제 서비스 경쟁과 gallery UX는 이 단위에서 테스트·완료로 집계하지 않았다. consumer가 최종 상태가 아니므로 부모/Aristotle의 연결 후 전체 check와 실제 브라우저 QA가 별도로 필요하다. 새 proof 함수는 저장 불변식만 담당하며 confirmRejected를 이 proof 의미로 느슨하게 확장하지 않는다.
