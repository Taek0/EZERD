# 참조 및 카드 후속 자동저장 보완 결과

- [계획](../planning/2026-10-08-Canvas-ContinuationPlan.md)
- [이전 카드 결과](2026-10-08-Canvas-CardEditingResult.md)의 reference 후속 좌표 입력 위험을 이번 변경에서 보완했다.

## 구현

- NativeCanvasActions는 기존 참조에 update_node_layout을 생성한다. 최초 add ACK 후 문서 반영이 늦어도 승인된 노드 ID를 기억하여 add를 반복하지 않는다.
- 공유 화면은 명령의 nodeId, 개인 화면은 서버와 같은 addTableReference 모델 연산이 생성한 ID를 사용한다. 문서에서 참조가 관측되면 임시 기록을 해제하므로 이후 삭제된 참조를 잘못 갱신하지 않는다. 생성 실패는 기록하지 않는다.
- 기존 참조를 선택하면 실제 X/Y를 초기값으로 사용해 한 축만 수정할 때 나머지 좌표를 보존한다.
- NativeCanvasInlineCell의 자동저장 전용 경로는 active=false cleanup 이후에도 유효한 입력을 저장한다. unmount 뒤 UI 상태/포커스는 갱신하지 않는다.
- debounce 이전 unmount 및 저장 ACK 대기 중 추가한 입력을 배출한다. blur 즉시 저장 후 unmount에서도 같은 revision을 중복 제출하지 않는다.
- IME 조합, 타입 검색 문자열, busy/DB revision 불일치, 교체 셀의 더 최신 durable revision은 제출하지 않고 보존한다. 저장 실패 입력도 남기며 자동 재시도하지 않는다.
- 승인된 revision만 정리하므로 다른 탭이나 교체 셀의 최신 draft를 삭제하지 않는다.
- NativeCanvasInputForm 및 공유 hook은 수정하지 않았다. fresh() 승인값 유지 문제는 오너 분담에 따라 Nash 통합 범위다.

## 검증

- 관련 7개 파일 108개 테스트 통과: SearchType, NativeCanvasInlineCell, NativeERDCanvas.interaction, NativeCanvasTableRows, native-inline, NativeCanvasScene, NativeERDCanvas.marquee.
- 사용자 보고의 private=false 참조 테스트 실패는 공유 도메인 화면의 실제 placementView가 __tables__인 점을 반영하도록 fixture를 수정해 해결했다.
- 테스트 values 객체를 Record<string, string>으로 명시하여 TS2339를 해결한 후 전체 web tsc --noEmit 통과.
- 변경 코드·테스트 4개 파일만 Prettier 적용/검사, git diff --check 확인. 실제 브라우저 조작 없이 기존 컴포넌트 이벤트/hook 테스트로 검증했다.

## 오너 커밋 대상

- apps/web/src/features/projects/NativeERDCanvas.tsx
- apps/web/src/features/projects/NativeERDCanvas.interaction.test.ts
- apps/web/src/features/projects/NativeCanvasInlineCell.tsx
- apps/web/src/features/projects/NativeCanvasInlineCell.test.ts
- docs/planning/2026-10-08-Canvas-ContinuationPlan.md
- docs/work-log/2026-10-08-Canvas-ContinuationResult.md

오너의 Git index 경합 방지 조정 이후 git add/commit을 실행하지 않았다. 기존 커밋은 유지했다.
