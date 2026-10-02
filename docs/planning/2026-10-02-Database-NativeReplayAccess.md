# Native REST/MCP ACK 재생 접근 권한 계획

- 시작 HEAD `de644d4`. root AGENTS 및 [history 재생 원칙](2026-10-02-Database-NativeHistory.md)을 확인했다. 담당 범위는 NativeSyncService, McpNativeDocumentService, 새 native-replay-access integration 및 이 계획/결과 문서다. history 서비스·다른 agent 변경·메인 MCP 등록/기존 통합 테스트는 수정하지 않고 git add/commit도 하지 않는다.
- 기존 actor/fingerprint 불일치의 `sync.replay-mismatch` 409를 유지한다. read 권한이 남은 같은 actor의 같은 요청은 viewer 또는 archived workspace에서도 저장 ACK를 재생한다. read 권한 상실과 새 쓰기의 design 권한 부족은 403이다.
- NativeSync apply는 기존 writable transaction에서 read 확인 → replay 조회 → current project row UPDATE lock/replay 재확인 → 새 쓰기 design 확인 → 전체 입력/DB/baseline/후보 검증 순서로 변경한다. 읽기 전용 transaction에 row lock을 추가하지 않는다.
- MCP 명령도 같은 transaction에서 재생을 먼저 판단하고 fresh 명령 검증·baseline 발급·candidate 생성을 처리한다. 별도 findReplay/baseline 사이의 race에서 viewer/보관 상태로 바뀌어 기존 ACK가 차단되는 틈을 남기지 않는다. 현재 includeDocument 표시 및 fingerprint 규칙은 유지한다.
- 기존 저장 result는 구조 확인 뒤 원문 clone으로 반환하고 현재 프로젝트 상태나 신규 candidate를 이용해 덮어쓰지 않는다. cached replay에서 command/engine 검증·새 baseline 발급·event/ledger 쓰기를 하지 않는다.
- 실제 AppModule/configureApplication과 isolated 로컬 PostgreSQL에서 native REST operations, commands REST 및 실제 apply_native_project_changes MCP를 호출한다. actor viewer/workspace archive/같은·다른 fingerprint/read loss/새 쓰기/동시 재생과 전체 상태 불변을 검증한다. 신규 native 기능 gate는 조작하지 않는다.
- targeted format/typecheck/격리 테스트만 수행하고 main full QA 또는 다른 단위 완료로 계산하지 않는다. [결과](../work-log/2026-10-02-Database-NativeReplayAccess.md)에 등록·검증 및 제한을 기록한다.
