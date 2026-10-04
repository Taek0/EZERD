# Native private CAS precondition 소멸의 보관·명시 해제 계획

2026-10-02. 기존 private web unit 다음 독립 후속이다. 새 helper/컴포넌트/tests 및 이 계획/작업 로그만 담당한다. NativeERDCanvas 직접 연결은 Aristotle/main 담당이며 core queue는 main 협의/구현 전 수정하지 않는다. commit 하지 않는다.

실제 actor-bound GET personal-state의 required databaseRevision/projectVersion/syncSequence/private version을 사용한다. private version 또는 context counter가 pending 기대값보다 증가한 경우에만 원 CAS 요청의 미래 commit 불가능성을 증명한다. 감소·누락·유효하지 않은 counter, 단순404/transport failure, same version의 content 차이는 proof가 아니다. 프로젝트 lifetime에서 counter는 단조적이라는 서버 계약을 전제로 하고 actor/project/current UI scope도 확인한다.

lease 획득 뒤 실제 GET하고 exact payload/lease token을 IDB transaction으로 fence한다. 새 core API 요청: confirmPrivateCASPreconditionConsumed(pending,token,guard?)는 exact row+active token 검사→guard→uncertain=false만 수행하고 row는 보존한다. archived outcome은 accepted/rejected ACK가 아닌 cas-precondition-consumed로 구분한다. 기존 command/history/upgrade confirmRejected 의미는 변경하지 않는다.

guard 안에서 원 pending/before/state 및 GET snapshot, captured editor reference/input(있으면 해당 revision)을 보관한다. localStorage archive 쓰기/검증 실패는 tx를 중단하고 기존 pending과 typed memory input을 보존한다. auth/token은 보관하지 않는다. lease token은 archive의 fence evidence로만 보존한다. 다른/newer pending을 해제하지 않는다. proof 확인 후에도 자동 삭제하지 않으며 별도의 사용자 명시 '요청 해제'에서만 discard한다. captured/newer editor draft는 삭제하지 않는다.

새 컴포넌트는 pending/current actor/project snapshot/permission/options 및 callbacks props를 받아 검사 결과와 archive를 표시하고 explicit discard를 제공한다. old snapshot/account/project 변경 뒤 UI 응답은 identity guard로 무시한다. same version+same request retry는 기존 private recovery를 사용하며 cancel_native_request로 private PUT을 보내지 않는다.

boundary proof classifier, actual actor-bound GET metadata, IDB 두 연결 token/claim race, unknown storage/404/mismatched scope, archive exact payload/newer draft 유지 및 explicit-only discard를 targeted 검증한다. live private 카메라/뷰 QA와 server snapshot 확인은 별도 격리 QA DB에서 이어 수행한다.

2026-10-02 부모 연결 후 범위: 부모가 confirmPrivateCASPreconditionConsumed를 queue core에 구현했다. 현재 owner/활성 lease/exact private payload/token 검사와 loss-fence 때 guard 미호출을 실제 구현으로 소비한다. core 및 Canvas/root는 부모 담당으로 유지하고 helper tests만 확장한다. fake-indexeddb6.2.5 필수 두 연결에서 positive archive→pending 유지→명시 discard, storage transaction abort, actor/context 변경, expired/new transmission 및 same-CAS 기존 recovery를 검사한다. mocked fence 성공을 실제 원자성 증명으로 사용하지 않는다.
