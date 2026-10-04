# Native durable queue의 databaseChange writer

2026-10-03. Aristotle의 gallery native DB 변경 consumer를 위한 작은 queue 단위. NativeDurableKind와 runtime persisted-row kind 허용 목록에 databaseChange만 추가한다. actor/project 단일 row, fingerprint, transaction claim, 송신 owner/token/lease, uncertain fencing 및 private-only CAS release는 변경하지 않는다.

소유 쓰기 범위는 native-durable-queue.ts/test.ts 및 이 계획/완료 로그다. root/gallery/recovery/cancellation/서버 연결은 Aristotle/부모 담당이며 읽기로만 kind 가정을 확인한다. source edit 없는 이전 bounded review는 추가 수행하지 않는다.

필수 fake-indexeddb의 서로 다른 연결로 databaseChange 대 commands/history/privateCanvas/upgrade의 양방향 경쟁을 확인한다. 실제 변경 request의 original counters/target/payload를 저장·재조회·reload하고 changed kind/operation/payload ACK를 거부한다. close/crash 후 활성 lease 동안 busy, 만료 후 original 요청만 재송신, 기존 token이 새 lease를 해제하지 못함, uncertain discard 차단과 exact ACK 해제를 확인한다. private CAS 소비 proof는 databaseChange를 계속 거부하며 guard를 실행하지 않는다. 알 수 없는 persisted kind는 storage unknown을 유지한다.

targeted queue 및 관련 fencing 테스트, web typecheck/root Prettier를 확인하고 이 논리 단위의 네 파일만 직접 커밋한다. 다른 agent 변경/등록 resource는 포함하지 않는다.
