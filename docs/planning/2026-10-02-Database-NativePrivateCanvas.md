# Native private canvas revision·durable 저장 계획

2026-10-02. MySQL physical 단위를 완료한 다음 독립 web unit이다. 담당은 새 native-private-canvas.ts/tests 및 NativeERDCanvas의 개인 저장 분기다. NativeProjectView 직접 수정, 서버/contract 변경, shared canvas/clipboard/domain 기능 변경, git add/commit은 하지 않는다. 필요한 props 및 서버 wire 계약은 main에 전달한다.

현재 PersonalStateController PUT은 expectedVersion/state만 소비하고 PersonalStateService GET에는 databaseRevision이 없다. MCP apply_personal_changes에는 별도의 operationId replay ledger가 있지만 REST PUT에는 없다. native web은 구 계약에서 쓰기를 활성화하지 않는다. main 연결 계약은 GET/PUT response databaseRevision, PUT expectedVersion/expectedDatabaseRevision/expectedProjectVersion/expectedSyncSequence/state이며 backend는 project lock 아래 context와 개인 version CAS를 검증해야 한다. shared document version/sequence는 개인 저장으로 증가하지 않는다.

동일 actor/project NativeDurableQueue(kind privateCanvas)를 transaction claim하고 실제 전송 lease/heartbeat를 사용한다. actor API는 첫 await 이전에 capture한다. unknown IDB/storage는 쓰기를 차단한다. 기존 localStorage pending은 정확히 같은 payload로 adopt하며 전송 결과 unknown 상태를 유지한다. payload에 auth/token을 저장하지 않는다. commands/history/upgrade/private는 동일 row로 배제된다.

REST PUT에는 idempotency key/ETag/operation ACK ledger가 없으므로 로컬 revision은 durable identity일 뿐 서버 ACK ID가 아니다. PUT response의 정확한 version+state+context 일치를 직접 성공으로 확인한다. recovery GET의 expectedVersion+1 및 동일 state는 CAS가 소비된 동일 postcondition이라는 별도 semantic 확인이다. 이 경우 늦은 같은 expectedVersion PUT은 다시 mutation할 수 없다. 임의 HTTP409/404 또는 다른 state/더 높은 version은 ACK로 취급하지 않으며 미확인 pending을 버리지 않는다. CAS baseline과 before state 및 모든 revision context가 그대로일 때만 동일 PUT을 재전송한다. cancel_native_request에 private PUT을 넣지 않는다.

UI는 actor/project/shared version/sequence/DB revision identity guard로 stale 응답의 setState를 차단한다. unmount는 durable pending이나 typed draft를 지우지 않는다. pending 조회는 async이고 unknown→empty도 반드시 actual queue read를 거친다. 전송 전 pending만 명시 reset 가능하며 uncertain reset은 queue가 거부한다. 개인 입력은 공유 export source를 바꾸지 않는다. 실제 IDB 두 연결, actor 변경 후 no PUT, matching response/GET semantic confirmation, stale revision/no replay, newer draft 유지 등의 targeted tests와 typecheck/Prettier를 수행한다.
