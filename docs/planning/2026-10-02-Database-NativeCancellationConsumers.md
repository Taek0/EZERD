# Native 요청 취소 MCP·웹 소비 계획

- 기존 pending payload와 operation/group/client/actor를 그대로 사용해 전용 서버 취소 확정 API를 호출한다. 로컬 삭제나 lookup 404를 확정으로 사용하지 않는다.
- 같은 IDB row/송신 lease/actor 고정 아래에서 동작한다. 이미 accepted였으면 해당 ACK만 소비하고 입력을 matching revision으로 정리한다. cancelled/rejected이면 pending만 해제해 사용자가 다시 검토할 입력을 보존한다.
- native command/history/upgrade의 UI에서 요청이 불명확하거나 미적용일 때 명시 취소를 제공한다. scope 변경 뒤 옛 응답으로 현재 화면을 이동하지 않는다.
- MCP는 원문 request를 받아 전체 cancellation 계약을 검증하고 SDK output에서 과거 raw ACK를 정규화하지 않는다. 실제 도구 호출과 late-request 보호 및 Node IDB 소비·권한/actor 검증을 확인한다.
