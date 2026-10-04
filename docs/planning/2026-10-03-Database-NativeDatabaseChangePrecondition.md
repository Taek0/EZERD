# Native databaseChange precondition 소비 queue fence

2026-10-03. 일반409 뒤 fresh GET의 단조 version/revision으로 원래 DB 변경 요청의 새 mutation이 불가능함을 확인한 consumer를 위한 작은 queue 단위. queue.ts/test.ts 및 새 계획/완료 로그만 수정한다. Aristotle의 remote proof/consumer, 기존 private CAS와 confirmRejected, root/server는 변경하지 않는다. 독립 커밋 후 freeze한다.

confirmDatabaseChangePreconditionConsumed(pending,token,guard)는 databaseChange kind, exact operation/payload/actor/project, live owner/token/미만료 lease를 transaction 안에서 확인한다. guard는 필수 동기 callback이며 caller가 fresh proof·actor/context를 확인하고 원문을 영속 archive/readback한 뒤 반환한다. 성공은 uncertain=false만 저장하고 요청/송신 lease/원문을 보존한다. 실패·guard throw는 abort/원문 보존이며 guard는 fence 손실 때 실행하지 않는다. 같은 lease에서 이미 소비된 proof는 재실행하지 않는다. endTransmission 후 명시 discard가 필요하고 신규 transmission은 다시 uncertain=true가 된다.

이 결과는 no-new-mutation proof다. 원래 mutation이 과거에 적용되지 않았다는 terminal ledger/no-applied proof 또는 accepted ACK를 뜻하지 않는다. 일반409/404/transport failure 자체로 호출해서는 안 된다. 그 의미의 remote 검사와 UX는 consumer 담당이다.

필수 fake-indexeddb 두 연결의 wrongkind/payload/op/actor/project/owner/token, 만료/새 lease, guard throw/archive quota, 동시 proof에서 guard once, 원문 reload 및 명시 discard를 검증한다. async guard는 허용하지 않는다. queue 및 관련 private/save regression, strict typecheck/Prettier를 확인하고 담당 네 파일만 커밋한다.
