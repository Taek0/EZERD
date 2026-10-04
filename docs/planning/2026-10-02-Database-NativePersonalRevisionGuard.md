# Native 개인 상태 DB 문맥 보호 계획

- 기존 개인 상태 version CAS에 native 프로젝트 DB revision/shared version/sequence를 결합한다. native REST PUT은 세 좌표가 모두 필요하며 project row lock 안에서 최신 문맥과 개인 version을 확인한다. v1의 기존 expectedVersion/state 호출은 유지한다.
- GET/PUT의 native 개인 snapshot은 databaseRevision을 포함한다. 개인 변경은 shared version/sequence/document/ledger를 바꾸지 않는다. MCP의 서버 계산 명령과 기존 operation replay 경로는 보존한다.
- fresh 누락/부분 입력/구문맥/권한·보관/경쟁/ACK 유실 뒤 CAS 상태와 원본을 실제 격리 API로 검증한다. 브라우저 소비는 NativePrivateCanvas 단위에서 연결하고 authoritative cancellation을 개인 PUT에 적용하지 않는다.
