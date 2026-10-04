# Native DB conversion의 실제 두 WebSocket context 수신 QA

2026-10-03. deferrable clear 계약 f8530f4 커밋 뒤 별도 작은 QA 단위다. 새 서버 integration test와 이 계획/작업 로그만 작성한다. production service/gateway/registry/부모 browser/full QA 파일은 변경하지 않고 git add/commit 하지 않는다.

normal scripts/test-isolated.ts의 localhost 검증, fresh UUID ezerd_qa_* DB/migration/finally DROP namespace를 사용한다. 테스트 자체도 prefix/UUID를 검사해 사용자 DB나 기존 등록 QA resource를 사용하지 않는다. compiled AppModule을 loopback 임의 포트에서 띄우고 실제 HTTP 사용자/session/project를 생성한다. 두 인증 actor의 실제 ws sockets가 프로젝트 subscribe(subscribed ACK)한 뒤 변환을 HTTP로 수행한다. publish mock/spy/가짜 socket/직접 gateway 호출로 수신을 계산하지 않는다.

작은 네 case는 PostgreSQL↔MySQL의 빈 물리 설계와 signed16/32/64 컬럼이 있는 설계다. 세 signed 폭을 한 fixture에 포함하여 양방향 타입 매핑을 확인한다. 모두 실제 frame collector가 conversion head의 projectId/sequence/databaseRevision을 수신한다. head 자체에는 kind/profile/snapshot이 없으므로 두 actor의 HTTP document-state와 fresh native baseline에서 target kind/profile/revision/source 및 counter를 확인한다. conversion은 native operation을 만들어낸 것으로 처리하지 않으며 polling의 resetRequired boundary를 확인한다.

old baseline과 command expectations를 변환 전 발급해 둔다. 변환 뒤 old expectation의 command는 거부하고 old native baseline write도 현재 정책에 맞게 rejected ACK/원문 보존을 확인한다. 두 fresh actor context에서 새 write는 accepted되고 두 sockets에서 실제 operation frame/ACK/revision을 받아 DB row와 비교한다. duplicate conversion 및 old accepted write replay는 original 결과를 돌려주고 counter/audit/ledger를 중복 변경하지 않는다. replay 중 추가 operation frame 부재는 socket subscribe barrier 뒤 관찰 가능한 bounded 구간으로만 주장한다. 15초 periodic heads와 conversion notification은 구분 가능한 내용/대기 구간을 기록한다.

인증/subscribe/receive에는 bounded timeout와 cleanup을 둔다. source fixture는 새 native HTTP command 경로로 준비하고 registry override나 gate=false 가정을 넣지 않는다. actual isolated run, test strict typecheck 및 root Prettier 확인 후 work-log/ready를 보고한다. 다음 독립 작업은 부모 지시 후 진행한다.
