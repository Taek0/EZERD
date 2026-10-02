# Native ERD와 공유 캔버스 결과

- 작성일: 2026-10-02
- 계획: [Native canvas 계획](../planning/2026-10-02-Database-NativeCanvas.md).
- 기준 HEAD: `2709412`.
- 인계 범위: 작은 shared ERD 소비 단위와 private 저장 준비. 아래 미연결 의존성 때문에 전체 canvas 기능 완료를 주장하지 않는다. add/commit/fullcheck 및 실제 HTTP/MCP/browser QA는 main이 수행한다.

## 실제 연결한 범위

- `NativeERDCanvas.tsx/css/test`: native 테이블/컬럼/PK·UNIQUE 및 FK 선을 직접 표시한다. namespace/type/default/generated는 model native display를 소비하며 원본 필드를 v1으로 바꾸지 않는다. 기존 generic card 최소 크기와 relation geometry를 사용한다. 물리 FK는 첫 참조 컬럼 row에 anchor를 잡고 저장된 route/anchors/waypoints를 유지한다.
- `NativeProjectView.tsx` content에 ERD를 연결했다. 테이블/컬럼 선택은 기존 property editor로 이동한다. main의 함수형 `projectActions` prop과 header 렌더는 보존했다.
- shared `update_node_layout`, `add/remove_table_reference`, note 생성/부분 patch/삭제 및 route 명령을 웹/MCP 공통 native 계약과 서버 candidate에 연결했다. 기존 generic model helper를 소비하고 최종 locked sync에서 context/reference/legacy/retired ID 정책을 유지한다. viewport/combined view는 shared 명령에서 받지 않는다.
- preview에만 있는 canonical 노드는 rawSource에 실제 참조를 추가하여 배치를 저장한다. 새 참조는 durable command에 fresh node ID를 보관해 삭제한 노드 ID를 재사용하지 않는다. 기존 raw 배치가 있으면 raw node ID를 사용한다.
- 드래그 입력은 매 변경마다 native editor draft에 먼저 보관하고 pointer up에 저장한다. 키보드 방향키 이동은 draft로 보관하고 Enter/배치 저장으로 적용한다. stale version/sequence/databaseRevision 및 private version은 자동 덮어쓰지 않으며 현재 좌표와 입력을 표시한 뒤 명시 비교 또는 초기화를 요구한다.
- 미확인 shared 요청은 기존 native pending/operation ID/replay/ACK 경로를 그대로 사용한다. before와 입력 revision을 분리하여 늦은 ACK가 다른 탭의 새 입력을 지우지 않도록 한다.

## 개인 상태 분리와 준비

- 기존 REST personal snapshot을 별도로 조회하고 해당 사용자의 combined views/nodes/notes/routes/viewports만 merge한다. 개인 화면을 아직 조회하지 못한 동안 raw stored private view를 다른 사용자의 개인 화면으로 노출하지 않는다.
- private helper는 combined view 생성/수정/삭제, 메모, 참조, 배치와 카메라를 native payload 보존 상태로 처리한다. shared 노드/메모 변경을 private helper에서 거부한다. shared route에서도 private view와 viewport 명령을 거부한다.
- 개인 PUT 전에 user/project별 immutable pending(`ezerd.native.canvas.personal:`)을 기록한다. GET의 personal version과 정확한 state로 ACK 유실을 확인하며, 확인 불가인 경우 context/project version/sequence/personal version/before가 모두 같을 때만 PUT 재시도를 준비한다. 이미 확인된 성공은 archived/새 DB 문맥에서도 조회만으로 정리할 수 있다. 조회 이후 인증 사용자가 바뀌어도 다른 사용자 토큰으로 PUT하지 않도록 시작 시 Authorization을 고정한다.
- PUT body는 `expectedDatabaseRevision`을 포함한다. **현재 개인 REST 계약에는 이 필드가 없으므로 private 쓰기 UI를 비활성으로 유지한다.** main이 strict 입력과 transaction 내 revision 검사를 연결하고 실제 QA를 수행해야 private UI를 활성화할 수 있다. 단위 테스트의 성공 PUT은 mock transport 검증이며 실제 HTTP 성공 증거가 아니다.
- zoom/좌표/크기 범위는 구조 계약을 기준으로 잡는다. 공통 wheel helper를 사용하되 native 계약의 최대 zoom 4를 legacy canvas의 2 제한으로 축소하지 않는다. readonly의 pan/zoom은 로컬 조회 상태로만 바뀐다.

## 사용자 추가 지시: export storage failure 보호

- 사용자 요청으로 `NativePropertyEditor.tsx`와 `native-editor-form.tsx`도 수정했다. basic/form dirty 및 storageError를 main의 `useNativeExportBlocker(userId, projectId, dirty, storageFailure)`에 등록한다. 기본 form의 초기 storage read 실패도 숨기지 않는다.
- ERD의 공유 미저장 배치와 공유 입력 저장 실패를 같은 hook에 등록한다. pointer input은 저장 실패해도 로컬 값을 보존하고 export blocker를 유지한다. shared canvas action form도 독립적으로 등록한다. 후속 브라우저 피드백에 따라 로컬 카메라·개인 pending·private view 입력은 공유 물리 문서 blocker에서 제외한다.
- tests는 basic form 저장소 읽기 실패(새 값은 clean, 실제 draft 없음), structured dirty 입력 및 actor/project scope, canvas form storage failure를 mock hook 호출로 검증한다. 실제 버튼 클릭·quota 실패·편집기 전환의 browser QA는 아직 수행하지 않았다.
- main에 추가 통합 사항을 알렸다: 개인 pending의 별도 키는 `ezerd.native.canvas.personal:${JSON.stringify([userId, projectId])}`이다. 사용자 후속 지시에 따라 공유 물리 문서 export에는 개인 상태를 차단 근거로 사용하지 않는다. 현재 hook의 unmount cleanup은 토큰을 삭제하므로 공유 저장 실패 입력이 있는 편집기를 전환할 때 차단을 유지할 정책은 main 확인이 필요하다. hook 구현/공유 메뉴는 이 담당자가 수정하지 않았다.

## 검증과 미완료

- 메인 통합: 최신 전체 check 1443개 통과/139개 건너뜀, 실제 versioned HTTP 34개 통과. 세 DB shared 테이블 참조 생성·메모 생성/부분 수정/삭제·노드 좌표 저장을 실제 ACK로 확인하고 물리 타입/default 원본을 보존했다.
- 실제 브라우저에서 native MySQL의 2개 테이블·PK·FK SVG와 선택 가능한 노드/속성 화면을 확인했다. DDL/JSON 공유 메뉴 및 form dirty/error gate와 함께 main 1개 회귀를 확인했다. 개인 저장/resize/clipboard/전체 도메인 lifecycle 활성화 QA를 완료로 계산하지 않는다.

- 최신 contracts/model 소스를 직접 alias한 대상 Vitest 6개 파일: 최종 **57개 통과**. 기존 native-save/조회/형식 UI 회귀와 새 canvas/command/export hook 등록 검증을 포함한다.
- 최신 소스 기준 web/server typecheck 최종 통과. 해당 단위의 exactOptional 및 자기 타입 참조 오류를 정리했다. 변경 코드 10개 파일의 Prettier 적용/확인 및 기존 수정 파일 `git diff --check`도 통과했다. 임시 Vitest/tsconfig는 실행 완료 후 제거했다.
- 실제 HTTP/MCP/browser QA, 대규모 ERD 성능/접근성/드래그 시각 QA는 main 통합 후 남아 있다. 기존 coverage/완료 fixture 상태는 바꾸지 않았다.
- **미연결 model API**: `addNativeDomain`/`updateNativeDomain`/`removeNativeDomain` 및 `moveNativeTableDomain`. 현재 v1 전용 도메인 helper나 `updateNativeTable`의 소유권 보호를 cast/직접 필드 변경으로 우회하지 않았다. 도메인 화면 조회는 연결했지만 생성·삭제·소유권 이동은 미구현으로 표시한다.
- combined view를 공유 sync에 섞지 않는다. 현 정책에서 shared view는 built-in/domain 화면이고 사용자 combined view는 personal이다. 신규 공유 combined view 모델은 구현하지 않았다.
- 전체 canvas, history/undo, clipboard, 고급 route/style/resize, 다중 선택 및 private REST 활성화가 완료됐다는 주장은 하지 않는다. main은 위 의존성을 별도 단위로 완성하고 fullcheck/독립 commit을 수행한다.

## 후속 브라우저 피드백 반영

- table 형식의 원시 namespace/options JSON을 스키마·엔진·charset/collation·SQLite mode의 의미 있는 현재 값으로 교체했다. MySQL의 기존 `public` namespace 원문은 그대로 보존하며 UI에 `스키마: public · 엔진: InnoDB`로 표시한다. stale form 비교에서도 내부 `*JSON` 보관 필드를 표시하지 않는다.
- 개인 저장 안내는 `개인 화면 저장은 아직 지원하지 않습니다. 이 프로젝트에서는 공유 캔버스를 사용해 주세요.`로 바꿨다. 사용자 UI에 내부 DB revision 연결 사유를 노출하지 않는다.
- 변경 없는 `NativeEditorForm` 저장 버튼을 비활성화하고 submit guard도 추가했다. 실제 변경 입력은 저장할 수 있다.
- 로컬 zoom/pan과 private pending/placement는 공유 export hook의 dirty 근거에서 제외했다. 공유 source의 미저장 배치 및 공유 입력 storage failure만 차단하며, 개인 form도 shared 여부로 범위를 제한한다.
- 최종 대상 6개 테스트 파일 **61개 통과**, 최신 contracts/model 소스 참조 웹 typecheck 통과, 수정 코드 5개 파일 Prettier/차이 공백 확인 통과. 표시 개선, 원본 보존, clean/dirty 저장 버튼 및 개인 카메라/공유 입력 blocker 범위를 회귀 검증했다.
- 실제 브라우저 재확인·C5 SQL 다운로드/DB 실행 QA와 DDL dialog key 중복 수정은 main 담당이다. 이 단위는 App/DDL dialog를 수정하지 않았다.
