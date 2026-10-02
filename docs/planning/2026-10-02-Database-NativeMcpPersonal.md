# C3/C4 native MCP 개인 캔버스 명령 연결

- 시작 `5166d59`, 작업 트리 깨끗함. 공유 설계 쓰기와 구분해 이미 native JSON 저장을 지원하는 PersonalStateService에 실제 MCP 명령 소비를 연결한다.
- 공통 메모/viewport/배치/테이블 참조/함께 보기/관계 route 함수의 입력을 필요한 공통 구조만 사용하는 generic CanvasDocument로 바꾼다. native physical payload를 v1에 투영하지 않고 type/default/generation/index/check를 그대로 유지한다. 기존 v1 ID/배치 동작은 유지한다.
- native의 긴 객체·뷰 ID로 만드는 node ID는 한도 안에서 충돌 없이 생성하고 objectId/viewId는 그대로 둔다. 전역 신규 객체 ID 검사는 native index/check도 포함한다.
- MCP apply_personal_changes의 v1 전용 guard를 제거하고 version-preserving generic callback을 사용한다. 실제 허용 범위는 기존 personal 명령으로 제한한다. shared 변경·문맥 변경·native 생성 기능은 이 경로로 허용하지 않는다.
- PersonalStateService의 row lock/expectedVersion/idempotency/권한/전체 후보·용량·write policy 및 사용자 격리를 유지한다. MCP 안내에서 native 개인 상태 지원과 shared native 쓰기 제한을 정확히 구분한다.
- 함께 보기 생성에 canonical shared table placement fallback을 추가한다. MCP 개인 읽기/배치 진단은 인증된 personal snapshot의 view ID를 명시해 개인 node/note/route를 사용하고, 일반 shared/domain alias 읽기는 기존 canonical 좌표를 유지한다. 기존 전체 MCP 통합에서 확인된 개인 route 누락도 같은 소비 경로에서 검증한다.
- generic 모델의 v1 회귀·native payload 유지·긴 ID/충돌 테스트와 세 DB 실제 MCP 개인 명령·재생·오류/사용자 격리·공유 원본/version/sequence/baseline/operation 보호를 격리 PostgreSQL에서 확인한다. 전체 check·작업 기록·독립 커밋을 완료한다.
