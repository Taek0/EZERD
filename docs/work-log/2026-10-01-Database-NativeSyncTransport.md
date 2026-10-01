# C2e/C3 native 동기화 전송 계약 결과

- 기준: [계획](../planning/2026-10-01-Database-NativeSyncTransport.md), 시작 `28b387b`.
- native sync input/result/event와 v1/v2 reader를 별도 추가했다. `protocolVersion: 2`, DB/profile, revision을 필수화하고 native 문서·AST/용량 검사를 재사용한다. 기존 v1 input/result/event는 그대로다.
- baseline/candidate는 input context와, 반환 문서는 result context와 일치해야 한다. accepted nextBaseline은 result revision과 같고 rejected nextBaseline은 이전 revision을 유지할 수 있다.
- 원본 legacy 타입/기본값을 정규화하지 않는다. 계약 파싱은 신뢰할 수 있는 서버 비교/복구 정책을 대신하지 않는다. 실제 서버에서는 raw claim/fingerprint 확인과 잠긴 행/발급 baseline 문맥/기존 legacy 비교가 필요하다.
- 신규 4개 테스트에서 v1/v2 원본/fingerprint, 누락 revision/프로토콜/다른 DB/혼합 버전/actor 위조 거부, legacy 원본 보존, accepted/rejected baseline consistency와 native event reader를 확인했다.
- 최종 `pnpm check`: 포맷·전체 타입·테스트·빌드 통과, **720개 통과/44개 건너뜀**.
- live API/controller/DB 저장/UI를 v2로 전환하지 않았다. 기존 v1 endpoint가 새 native envelope를 거부하는 것을 계약 테스트로 확인했다. native 편집·삭제 cascade·clipboard/remap 및 실제 서버/화면 소비와 DDL 연결이 남았다.
