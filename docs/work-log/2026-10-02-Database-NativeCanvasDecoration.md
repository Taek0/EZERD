# Native 도메인 연결·공통 스타일·PNG 결과

- 작성일: 2026-10-02
- 계획: [NativeCanvasDecoration](../planning/2026-10-02-Database-NativeCanvasDecoration.md).
- 단위 상태: main 통합 검토용 ready. git add/commit, progress 수정, 전체 format/check/build 및 브라우저 QA는 수행하지 않았다.

## 실제 연결

- `packages/contracts/src/native-canvas-decoration.ts` 신규: 도메인 연결 생성·엄격 부분 patch·삭제, table/domain/shared note 색상 변경·초기화, table nullable/comment 표시 명령을 정의했다. ID trim/160자/예약 view ID, 빈 patch·임의 physical/소유권 필드, table 이외 display 옵션을 거부한다.
- `packages/contracts/src/native-editor-command.ts`: 새 명령을 기존 editor union과 native-edit 경유 public barrel에 연결했다. 별도 index 수정은 없다.
- `apps/server/src/mcp/native-canvas-decoration-candidate.ts` 신규 및 `mcp-native-document.service.ts` 작은 연결: 실제 renderer/SDK metadata가 같은 명령을 소비한다. 기존 shared model 관계·note helper와 native table/domain update helper를 사용한다. 생성 ID는 기존 전역 batch claims를 통과하며 ordinary locked sync의 권한·revision·retired ID·replay 정책을 유지한다. private note styling은 shared 명령에서 거부하고 관계 삭제는 해당 route metadata도 정리한다.
- `NativeDomainRelationEditor.tsx` 신규: 기존 NativeEditorForm으로 생성·부분 수정·revision 토큰 확인 후 삭제를 저장한다. LAN HTTP에서도 nativeDurableId를 사용하며 생성 form이 기존 관계 내용을 복사하지 않는다. overview 관계 선택과 부모 draft recovery의 initialAction/selectedId를 소비한다.
- `NativeCanvasStyleEditor.tsx`, `native-canvas-style.ts`, `NativeCanvasTableRows.tsx` 신규: 색상 설정·초기화, NULL/필수·comment 표시를 저장하고 source native type/default/generation 및 logical metadata를 표시한다. 변경된 필드만 명령으로 보낸다. readonly·pending·dirty/storage failure·ACK 보호는 기존 form/save 경로를 소비한다.
- `native-domain-lines.tsx` 신규: 기존 layoutDomainRelations geometry로 overview 연결 경로·방향·label을 표시하고 클릭/키보드 선택을 연결한다.
- `native-canvas-png.ts`, `NativeCanvasPngExport.tsx` 신규: 같은 native scene/card rows/공통 관계 geometry를 SVG로 구성하고 browser image/canvas의 실제 image/png encoder로 2x 다운로드한다. XML escape, 카드/관계 bounds, 120M pixel·32760 side 제한, async decode/blob 이후 actor/project/version/seq/revision/view/mode 문맥 보호를 적용한다. camera·private state를 공유 source에 합치지 않고 private view의 PNG는 비활성이다. readonly 공유 화면은 내보내기만 가능하다.
- `NativeERDCanvas.tsx`: 위 독립 컴포넌트 소비, 색상 및 comment/nullable row height와 FK anchor 연결만 추가했다. 부모 private/personalEditable 및 draft recovery 연결 변경을 보존했다. App/NativeProjectView, NativeSync/History/Upgrade, model 및 coverage/typeflags/index-policy는 수정하지 않았다.

## 변경 파일 및 검증

- 신규 tests/fixture: `apps/server/test/native-canvas-decoration.test.ts`, `native-canvas-decoration.integration.test.ts`, `apps/web/src/features/projects/native-canvas-decoration-test-fixtures.ts`, `native-canvas-decoration.test.ts`, `native-canvas-png.test.ts`.
- source alias targeted **42개 통과**: server candidate 8, domain/style UI 6, PNG 5, 기존 Canvas 23. 계약 경계, 3DB legacy/raw 불변, endpoint/ID claims, display merge/reset, readonly/pending/clean save, LAN crypto, 공통 geometry, XML escape·image encoder 호출·문맥 취소·크기 한도를 검증했다.
- disposable local `ezerd_qa_*` DB migrations 후 최신 source AppModule 실제 REST/MCP **6개 통과**. PostgreSQL/MySQL/SQLite 문맥의 관계 CRUD·style 저장/초기화·원문 보존, ACK 동일 replay, endpoint/physical injection/batch ID reuse 거부, persisted retired ID 거부, viewer 403, revision mismatch 409, 등록 MCP 도구의 두 명령군 실제 저장을 확인했다. QA용 opaque legacy 데이터는 격리 DB fixture로만 넣었으며 ordinary 신규 legacy 생성 권한을 변경하지 않았다. 실제 세 DB SQL 실행 검증과는 구분한다.
- 초기 통합 테스트에서 rejected ACK 필드와 revision conflict HTTP 형태를 잘못 기대한 두 assertion을 실제 계약의 reasonCode 및 409 database.context-changed로 수정했다. 이후 6개 모두 통과했다.
- 최신 source 별칭으로 담당 web 및 server renderer/candidate의 transitive noEmit typecheck 통과. 임시 alias/config 파일은 검증 후 제거했다. 변경 파일만 Prettier 적용/확인 및 diff whitespace 확인.
- 부모가 수정 중인 clipboard old physical gate 회귀 및 Singer/부모 Canvas 좁은 assertion은 별도로 변경하지 않았다. capabilities의 실제 활성 registry와 미검증 advanced 정책은 그대로 소비하며 fixture coverage 상태를 조작하지 않았다.

## 남은 한계·main 인계

- main 통합: 공통 domain relation model API를 CanvasDocument generic으로 바꿔 native source를 직접 받도록 했고 함수 bridge를 제거했다. Canvas의 초기 view/action selection interface는 archive 정책과 독립적인 type-only 파일로 분리했다. optional initial selection/개인 view 로딩 대기는 공통 widget의 인터페이스이며 archive writer/root 복구 policy 변경은 다음 커밋에서 분리한다. renderer/UI/PNG/기존 Canvas와 model5파일47개 및 shared/server build 통과.

- model의 upsertDomainRelation/removeDomainRelation 구현은 CanvasDocument만 읽지만 public 선언은 아직 v1 DesignDocument다. candidate helper는 함수 시그니처에 한정한 bridge를 사용한다. raw schemaVersion2 문서를 그대로 전달하고 native schema로 결과를 검증한다. model public API를 generic으로 확장하면 main이 bridge를 제거할 수 있다. 이 단위에서는 model/index를 변경하지 않았다.
- 실제 브라우저 PNG decode/픽셀/다운로드 및 style·관계 메뉴 상호작용 QA는 main이 수행해야 한다. PNG 테스트는 browser encoder API를 mock했으며 실제 PNG 픽셀 생성 증거로 주장하지 않는다. 긴 문장 wrapping, 고급 style/column width, private view PNG 등은 이번 작은 단위 범위에 포함하지 않았다.
- PNG는 저장된 shared source를 내보낸다. 미저장 drag/form 입력을 이미지에 합치지 않는다. DB physical gate/SQL export/전체 native 기능 완료를 주장하지 않는다.
- public barrel source 등록은 완료했다. main shared build가 최신 명령 타입을 dist로 발행한다. `NativeERDCanvas.tsx`에는 부모 recovery 변경도 함께 있으므로 main이 해당 hunk를 함께 확인해야 한다.
