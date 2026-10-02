# Native orphan/cross-tab draft 복구 계획

- LegacyImport 독립 단위의 구현/검증/결과 기록을 완료한 후 시작한다. 사용자 지시대로 git add/commit하지 않는다. 최초 범위는 NativeProjectView 제외였으며, archive 단위 ready 후 사용자 승인으로 root의 panel/form 선택 최소 연결까지 확장되었다.
- 담당은 native-editor-draft/native-save의 draft 저장·조회·ACK 소비, 새 native-draft-archive helper/테스트, 새 NativeDraftRecoveryPanel/테스트와 이 계획/동명 work-log다. 필요 시 기존 memory draft helper의 조회 API만 추가한다. pending queue/서버/계약/MCP/다른 UI 구현은 보존한다.
- LocalStorage의 actor/project/object 공유 key에 새 입력을 덮어쓰지 않는다. 각 document runtime의 cryptographic writer ID와 고유 entry ID로 원문 draft를 보관하고 writer 전용 head를 사용한다. snapshots는 text/before/expected/revision을 보존한다. legacy 공유 key는 삭제/덮어쓰기 없이 별도 복구 대상으로 다룬다.
- 현재 writer 입력만 일반 form API에서 읽는다. 다른 writer/legacy 입력은 자동 rebase/전송하지 않고 명시 panel에서 원문 확인·다운로드·복구 사본 생성·snapshot 폐기를 처리한다. 사본의 원본 revision/expected는 보관하고 기존 stale/context/actor 검사는 유지한다. 삭제된 object/닫힌 form도 actor/project 전체 archive 조회로 접근한다.
- ACK는 actor/project/operation 및 실제 stage에서 캡처한 정확한 archive snapshot에만 적용한다. property draft도 원문/expected 일치를 확인하고 newer/다른 writer 입력을 지우지 않는다. wire pending/DTO는 변경하지 않는다. quota/읽기/삭제 오류는 입력을 memory에 남기고 실패를 드러낸다.
- exported Draft API 및 기존 ACK matching/actor/clipboard/form/private/export 회귀와 two-writer 경합·closed/orphan/corrupt/storage 실패·panel 명시 행동을 targeted 테스트한다. TS/Prettier도 담당 파일만 검사한다. 실제 브라우저 two-tab 검증은 가능한 범위와 main 연결 전 제한을 구분한다.
- 기존 project-ddl-export의 local guard는 공유 key 조회만으로 draft 여부를 판단했다. 저장 정책 전환에 필요한 최소 연결로 명시 storage의 memory dirty/failure와 legacy 원문의 writer별 명시 dismissal을 확인한다. export 자체/API는 변경하지 않는다.
- 확장 범위: NativeProjectView의 live currentTransferUserId + root 세대 검사, 복구 epoch key remount, 새 native-draft-recovery-target 및 root/form 연결 tests. Structure/Advanced/Domain/Canvas/CanvasStyle/DomainRelation은 초기 action/target 선택 props만 최소 추가하며 동시 agent 변경을 보존한다. source category/property와 실제 producer key별 supported 범위를 work-log에 기록한다.
- 삭제된 대상/이미 생성된 ID/지원하지 않는 clipboard·unknown key는 복구 사본을 만들기 전에 차단하고 다운로드/명시 폐기로 남긴다. 개인 view가 아직 로드되지 않았으면 shared fallback form으로 복구하지 않고 원문을 보존하며 대기한다. canPersonalEdit과 actor-before-stage의 기존 동작을 보존한다.
- 부모 QA의 LAN crypto 두 테스트는 exact random draw 횟수 대신 실제 getRandomValues 인자/반환 bytes, UUID 형식/고유성, randomUUID/subtle 없는 환경과 미전송 상태를 확인한다. NativeERDCanvas.test는 해당 테스트 한 부분만 수정한다.
