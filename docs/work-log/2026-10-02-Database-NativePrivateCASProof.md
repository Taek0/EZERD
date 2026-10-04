# Native private CAS 소멸 proof 후속 상태와 인계

2026-10-02. [계획](../planning/2026-10-02-Database-NativePrivateCASProof.md). native-private-cas-proof.ts/test 및 별도 NativePrivateCASRecovery.tsx를 작성했다. NativeERDCanvas/NativeProjectView/queue core/cancellation/backend는 수정하지 않았다. 부모의 core 수정 협의 범위를 지켰으며 git add/commit 하지 않았다.

helper API:

- inspectNativePrivateCASPrecondition(pending,actualSnapshot): native GET의 required DB revision을 parse하고 private version/context counter 증가만 distinct cas-precondition-consumed로 반환한다. context 감소는 거부하고 same-version state 차이/같은 target state/낮은 private version만으로는 unconfirmed다.
- verifyNativePrivateCASPrecondition(actor,snapshot,pending,options): 첫 await 전 actor API capture, exact actor/project pending read, 송신 lease, cache:no-store 실제 personal GET, monotonic counter 검사 후 원자 fence를 요청한다. matching pending/state/before/exact local lease token/actual observation 및 일치하는 captured draft를 archive한다. 인증 token은 저장하지 않는다. 다른/newer draft는 제거하지 않는다.
- loadNativePrivateCASArchive: archive payload/fence UUID/reasons/native metadata를 검증하고 임의 extra fields를 소비하지 않는다.
- discardArchivedNativePrivateCAS: archive가 있어도 queue uncertainty/active lease를 우회하지 않는다. 명시 동작에서만 exact pending을 discard하고 archive/입력을 남긴다. PUT/native cancel을 호출하지 않는다.

## 초기 부모 core 연결 대기 (아래 후속에서 해결)

초기 검증 당시 native-durable-queue.ts에는 아래 API가 없었다. helper는 runtime capability를 검사하여 native.private-cas-fence-unavailable로 차단했다. accepted/rejected ACK를 조작하거나 기존 confirmRejected를 proof로 재사용하지 않았다.

```ts
confirmPrivateCASPreconditionConsumed(
  pending: NativeDurablePending,
  token: string,
  guard?: () => void,
): Promise<boolean>
```

필수 core 의미: IDB 한 readwrite transaction에서 privateCanvas kind, exact actor/project/operation/payload, current token 및 expiresAt>now의 활성 lease를 검사한다. mismatch/expired token은 false이며 guard를 호출하지 않는다. 성공에서만 guard→uncertain=false로 바꾸고 transmission/pending row는 남긴다. archive 쓰기/readback 또는 actor/UI guard 예외는 transaction abort한다. confirmRejected의 server-ledger 의미는 변경하지 않는다. helper finally가 matching token만 end하고 proof 이후 pending은 명시 discard까지 남는다. outcome은 helper/archive의 cas-precondition-consumed이며 server ACK가 아니다.

초기 상태에서는 부모 API 연결 전 실제 두 IDB 연결의 expired/stolen token/late end/actor-changed/storage-abort proof와 explicit discard 전체 흐름을 완료로 표시하지 않았다. 실패 시 원 pending/입력을 유지했다. 아래 후속 검증에서 이 대기 조건을 해결했다.

## UI props 인계

NativePrivateCASRecovery에 userId/current ProjectDocumentState/pending/disabled/options와 onArchive/onDiscard를 넘긴다. disabled는 permission/프로젝트 상태 및 기존 pending 카드 제어를 따른다. options.assertCurrent는 root actor/project/counter identity guard와 조합되며 컴포넌트 자체는 unmount/identity 변경을 검사한다. onDiscard에서 archive.pending.revision과 현재 UI pending.revision이 같은 경우에만 UI pending을 clear하고 authoritative queue/personal GET을 refresh한다. unknown→empty는 실제 IDB read를 반드시 거친다. archive만 load된 상태에서는 해제 버튼이 켜지지 않고 fresh 기준 확인을 요구한다. 자동 clear는 없다. 현재 NativeERDCanvas가 다른 agent 범위라 직접 연결하지 않았다.

## 검증과 실제 개인 저장 보완

- boundary classifier/archive/fail-closed test13개 및 기존 private helper22개: 35 passed. 이후 private/Canvas/core queue/actor-api 포함5파일 **73 passed**, skip0. core에 없는 method를 mock으로 증명했다고 주장하지 않는다.
- 실제 isolated3141 service GET과 SQL: personal version2/project version1/sequence1/DB revision0, 개인 뷰 Private Flow View1개 및 camera zoom1.2. 실제 응답을 classifier에 주어 expected private version1보다 증가했다는 별도 outcome/reason을 확인했다. 이 representative classifier 검증은 미연결 atomic proof/discard 완료와 다르다.
- full draft ref strict parse 오류의 helper 수정/회귀 test와 실제 guarded PUT 개인 뷰 저장은 [기존 unit 보완 기록](2026-10-02-Database-NativePrivateCanvas.md)을 따른다. 카메라 저장/reopen 및 개인 뷰 생성 UI를 실제 API에서 확인했다.
- model/server/web typecheck 및 담당 파일 Prettier 통과. 사용자/부모 DB를 건드리지 않았고 두 owned UUID QA DB/listener는 stop/finally에서 제거했다. 정확한 workspace/PID/args를 검증하여 Vite3142 child도 종료했다. 카메라 reload/reopen PNG와 sanitized actual GET/SQL evidence만 .data에 유지하고 own 임시 script/config는 제거했다. 전체 check/build/commit은 부모 담당이다.

## 부모 actual queue 연결 후 독립 단위 ready

부모가 private-kind/exact payload/current owner/활성 lease/exact token의 readwrite transaction fence를 구현했다. 이번 후속은 owned native-private-cas-proof.test.ts만 코드 수정했다. core는 수정하지 않았으며 NativeERDCanvas pending-card 연결도 부모 담당이다. helper/컴포넌트 API와 props는 그대로 유지한다.

필수 fake-indexeddb6.2.5의 실제 동일 DB 두 연결과 production NativeDurableQueue를 사용하여 아래를 확인했다. positive queue fence를 mock으로 대체하지 않았다. UI guard가 transaction 안에서 변경되는 한 경우에만 production method로 call-through하며 guard 예외의 실제 IDB rollback을 검사했다.

- default actor-bound request→fetch GET의 Authorization 캡처, cache:no-store, 실제 응답 parse 및 no POST/PUT/cancel. exact pending.before/state/captured draft 및 실제 beginTransmission token을 archive하고 pending을 유지한다. 다른 연결의 명시 discard 후 archive/typed input은 남는다. pending이 존재하는 동안 새 commands claim도 거부한다.
- 개인 version뿐 아니라 DB/shared version/sequence advance를 실제 helper→queue로 소비한다. same version/content 변화·missing/regressed context·404·transport failure는 archive/ACK를 만들지 않고 unknown row를 보존한다.
- GET 중 actor 변경, initial IDB read 중 actor 변경(네트워크0회), transaction guard 안 UI context 변경은 archive/uncertainty release를 차단한다. 정확하지 않은 payload/project도 GET 전에 거부한다.
- lease expiry 및 다른 owner의 새 lease 동안 지연된 GET proof는 guard/storage 쓰기0회로 거부한다. old token finally end가 새 transmission을 지우지 않는다. 두 concurrent proof reader는 GET1회/승자1개만 허용하고 pending은 explicit discard까지 유지한다.
- archive write denial 및 readback failure는 IDB transaction을 abort한다. archive가 먼저 기록되고 readback이 실패한 경우에도 unknown row 때문에 archive-only discard가 거부된다. captured typed input을 보존한다. storageunknown/IDB open denied는 GET 전에 차단한다.
- proof 이후 새 transmission은 uncertainty를 다시 설정한다. 과거 archive로 active lease나 end 후 unknown row를 해제하지 못한다. 더 새로운 editor revision은 captured original로 오인하거나 삭제하지 않는다.
- unchanged CAS는 unconfirmed로 남고 기존 정확한 pending의 GET→PUT 재시도를 유지한다. expected personal/DB/project/sequence triple을 그대로 보내며 matching 결과만 row를 clear한다.

최종 native-private-cas-proof **35 passed**. private/Canvas/core queue/actor-api 포함5파일 **98 passed**, skip0 (부모가 추가한 core fence tests도 포함). web 전체 typecheck 및 owned helper/component/test Prettier 통과. actual server GET/SQL·private 저장 검증은 앞 절의 owned disposable DB evidence를 따르고, 새 CAS 컴포넌트의 pending-card 실제 브라우저 조작은 부모 통합 QA다. gate flags/shared root/production queue를 변경하지 않았고 git add/commit은 하지 않았다.
