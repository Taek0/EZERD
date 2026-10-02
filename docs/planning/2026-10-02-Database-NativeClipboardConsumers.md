# Native clipboard 실제 소비 계획

- 작성일: 2026-10-02
- 기준: C2 `native-clipboard` 준비 helper/모델 remap 및 native editor command·locked renderer·durable queue.
- 범위: 새 web `native-clipboard.tsx/helper/tests`, NativeERDCanvas 메뉴/테스트, contracts native-editor-command/clipboard 및 테스트, MCP native renderer/metadata 및 전용 단위·실제 API/MCP 테스트. 모델/validation/typeflags/index-policy, NativeSync/History/Upgrade 및 다른 병렬 파일은 수정하지 않는다. public index는 기존 native-edit export를 소비한다.

## 정책과 구현

1. copy는 snapshot.sourceDocument의 sharedDocument와 공통 canonical table layout helper만 소비한다. 개인 views/camera/note/다른 actor 상태를 fragment로 가져오지 않는다. 테이블 선택과 부분 FK 생략 내역/객체 수를 검토한다.
2. 신규 paste_native_clipboard는 strict format2 envelope/context/목적 domain/좌표/명시 fresh UUID 목록을 받는다. sourceProjectId는 optional provenance로 기존 읽기 형식과 호환되며 권한 또는 privileged previous를 부여하지 않는다.
3. fragment는 모든 참조 의존성을 포함해야 한다. 이번 bounded live 경로는 기존 ENUM 포함 외부 객체 자동 bind를 하지 않고 전부 fresh ID로 복제한다. C2 planNativeTablePaste와 모델 remap을 공통 사용하며 legacy는 logical scope에도 신규 복제하지 않는다. 기존 준비 helper의 자동 ENUM 재사용은 옵션으로 유지하되 live에서는 끈다.
4. 같은 DB/profile만 허용한다. envelope UTF-8 2MB 및 최종 native 문서 1.5MB/객체·AST·layout 한도, ordinary validation/coveragefalse, server retired IDs와 batch claims를 그대로 적용한다. UI는 진단을 표시하고 미검증 물리 기능을 활성화하지 않는다.
5. copy/paste는 native JSON이며 SQL/v1 projection을 사용하지 않는다. LAN Clipboard API가 없거나 거절되면 manual textarea를 제공한다. paste input은 actor/project/revision draft와 matching ACK 흐름을 소비하고 review 시 고정 remap을 보관한다. local textarea field 크기 제한은 분할 draft로 envelope 한도를 보존한다. onSave/IDB await 전후 actor pin과 기존 pending/readonly 문맥을 유지한다.
6. 실제 renderer에 명령을 연결하고 SDK metadata에 type을 등록한다. replay-before-validate/locked baseline·최종 ordinary candidate 정책을 변경하지 않는다. helper 테스트만으로 actual write 완료를 주장하지 않는다.

## 검증

- source alias targeted 계약/helper/UI/renderer 테스트: self-contained FK/index/check/AST/ENUM remap, legacy/foreign DB/외부 borrowed refs/strict injection/size/ID collision, readonly 메뉴와 LAN fallback, draft/ACK/actor pin.
- 가능한 격리 DB에서 실제 REST command/MCP 정상 logical paste 및 legacy/foreign DB/retired/batch 재사용 거부를 검증한다. 생산 DB가 아닌 disposable 로컬 QA만 사용한다.
- 변경 파일만 Prettier/typecheck. 전체 format/check/build와 git add/commit은 하지 않는다. browser 최종 QA와 커밋은 main 담당이다.
