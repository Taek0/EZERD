# Canvas interaction/layout 결과

## 변경

- 일반 속성 영역의 상단 카드 표시 그룹을 제거했다. 기존 property 색상/옵션과 명시적 style draft 복구 경로는 유지했다.
- 컬럼 입력 우클릭도 기존 컬럼 app context menu로 전달한다. 편집 중 키보드 context-menu 동작은 가로채지 않는다.
- H/V는 window에서 처리하여 캔버스 밖 포커스에서도 전환한다. 실제 입력/편집 필드, IME/keyCode 229, 오버레이, modifier, 이미 처리된 키, 드래그를 제외한다. Escape 후 포커스가 남은 정적 inline span은 전환을 허용한다. 기존 과도한 data-inline-cell guard 실패를 테스트로 재현 후 제거했다.
- 배율 버튼은 100% 기준 고정 너비와 tabular 숫자를 사용한다. sidebar resize 강조선은 pin과 같은 2px이다. 색상 선택 CSS는 수정하지 않았다.
- toolbar는 기존 createObject 경로를 이미 사용한다. 새 테이블의 강제 논리 이름 초기값을 제거하여 빈 이름을 유지했다. MAIN 소유 toolbar/ProjectView 파일은 수정하지 않았다.
- MAIN save의 durable enqueue 성공 직후 create preview/선택 계약을 연결했다. optimisticSourceDocument prop으로 신규 table inline lookup에도 preview를 사용하며 snapshot은 원본 기준을 유지한다. table은 ACK 후 재선택하지 않는다. private 뷰 생성은 폼 대신 전체 테이블 뷰로 이동해 공유 blank table을 만든다.
- 생성 테이블이 다중 도메인 필터 밖에 놓이면 필터를 해제한다. 단일 도메인 소유권과 필터는 유지한다. private→TABLES navigate는 기존 필터를 해제한다.

## 배치 성능 및 동기화

- preserve/preservePlacements는 최신 draftRef와 화면 state를 즉시 갱신한다.
- native-placement-persistence.ts가 archive 호출만 120ms quiet window, 최대 1000ms로 합친다. archive 내부와 서버 payload/immutable intent를 변경하지 않는다.
- pointerup의 savePlacement는 먼저 동기 flush한 뒤 최종 배치만 제출한다. 중간 pointermove에서는 서버 요청이 없다.
- 선택 변경, 뷰/actor/project/database revision 전환 cleanup, blur, pointer cancel/lost capture, visibilitychange, pagehide에서도 flush한다.
- quota 실패는 최신 pending draft를 메모리에 보존하고 storage/export 오류 상태를 유지한다. flush 실패 시 서버 제출을 하지 않는다. 다음 flush에서 재시도한다.
- 공유 ACK 대기 중 다음 드래그 허용 경로는 유지했다. 제출된 요청을 병합/수정하지 않는다.
- private 경로의 personalBusy/personalPending/privateQueueState 잠금은 기존 CAS 계약을 유지한다. 이를 해제하려면 개인 배치 큐에서 expected personal version 재검증, 최신 로컬 placement overlay 유지, 실패 시 revision별 복구가 함께 필요하므로 이번 변경에서는 잠금을 제거하지 않았다.
- 따라서 private ACK 대기 중 연속 이동 무지연을 보장하지 않는다. shared 브라우저 800ms 지연 실측은 별도 오너 검증이며 이 기록의 성능 증거는 컴포넌트/helper 카운트 테스트다.

## 검증

- 최종 Vitest 9파일 172개 통과: NativeERDCanvas.interaction/marquee/main, NativeCanvasTableRows, NativeCanvasScene, NativeCanvasInlineCell, canvas-tool-shortcuts, native-placement-persistence, native-canvas-decoration.
- 100회 move: 매 이동 화면 좌표 갱신, 중간 archive store 0회/서버 요청 0회, 마지막 savePlacement에서 archive store 1회/서버 요청 1회. archive store 내부의 실제 localStorage 기록 수는 기존 구현을 따른다.
- 연속 이동 최대 1초 checkpoint, quiet window 최종 기록, quota 실패 후 최신값 재시도 검증.
- ACK 대기 중 같은 객체/다른 객체 추가 드래그 및 이전 요청 불변 검증.
- 빈 테이블 toolbar 생성, 입력 우클릭 app 메뉴, 입력/IME/처리된 키 단축키 보호 검증.
- MAIN preview helper를 사용한 ACK 전 카드/선택/sharedSource lookup, snapshot 불변, ACK 후 후속 사용자 선택 보존을 검증했다.
- 생성 시 단일 도메인 필터 유지/다중 도메인 필터로 숨는 신규 미지정 테이블의 필터 해제를 검증했다. private 생성은 코드 경로를 확인했으며 개인 CAS busy 보호가 걸린 상태에는 기존 시작 제한이 남는다.
- decoration의 기존 카드 표시 문자열 기대만 새 UI에 맞추고 readonly/no-submit/원래 스타일/문서 불변 검증은 유지했다. 명시적 style recovery가 조회 전용 권한을 유지하는 테스트를 추가했다.
- MAIN의 autosave quiet window 750ms 변경에 맞춰 NativeCanvasInlineCell 테스트의 대기 시간을 갱신했다.
- 최종 웹 전체 tsc --noEmit 통과. 중간 다른 작업 영역 오류는 통합 수정 후 해소됐다.
- 샌드박스 Vitest는 임시 모듈 캐시 ENOENT로 실패하여 정상 환경에서 재실행했다. 브라우저 실측 FPS/시각 QA는 수행하지 않았다.
- 변경 파일만 Prettier 적용/검사. Git add/commit, 전체 format 미실행.

## 담당 파일

- apps/web/src/features/projects/NativeERDCanvas.tsx
- apps/web/src/features/projects/NativeCanvasTableRows.tsx
- apps/web/src/features/projects/native-project-view.css
- apps/web/src/features/projects/native-placement-persistence.ts
- apps/web/src/features/projects/native-placement-persistence.test.ts
- apps/web/src/features/projects/NativeERDCanvas.interaction.test.ts
- apps/web/src/features/projects/NativeCanvasInlineCell.test.ts
- apps/web/src/features/projects/native-canvas-decoration.test.ts

[계획](../planning/2026-10-08-Canvas-InteractionLayoutPlan.md)

소스 freeze: 2026-10-08. 추가 범위 확장 없이 MAIN preview 연계와 오너의 별도 브라우저 QA를 따른다. Git add/commit은 수행하지 않았다.
