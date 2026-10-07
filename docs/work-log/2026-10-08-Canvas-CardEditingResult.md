# 카드 인라인 편집 개선 결과

- [계획](../planning/2026-10-08-Canvas-CardEditingPlan.md)
- SearchType의 표시 입력과 DB 선택 ID를 분리했다. 검색어를 재렌더링·복구 시 유지하고 카드 옵션을 메모이제이션했다. 표시에는 SQL label을 쓰며 postgresql: 등 prefix가 있는 값은 명령 ID로만 보존한다.
- 카드 이름·설명은 공유 use-native-autosave hook으로 300ms debounce 저장한다. 편집을 닫지 않고 후속 입력을 받으며 IME 조합 중에는 지연한다. 변경 취소로 원래 값이 된 경우에도 다음 타이핑이 동작한다.
- 타입 검색어는 로컬 draft에만 보관한다. 실제 타입 옵션 선택만 기존 nativeInlineTypeCommand를 통해 DB 검증 후 저장한다.
- 카드 +는 빈 컬럼을 즉시 표시하고 add_column을 보낸다. createNativeColumn으로 PostgreSQL/MySQL/SQLite 기본 타입·파라미터·scope 계약을 유지한다. 이름 셀 포커스를 연결하고 실패 시 임시 행을 제거한다. HTTP LAN에서도 nativeDurableId를 사용한다.
- 배치 입력 초기화 번역·버튼·처리기를 제거했다.
- 금지된 파일과 공유 native-editor-policy.ts는 수정하지 않았다. 공유 hook은 다른 워커 소유이며 이 커밋에 포함하지 않는다.

## 검증

- 카드·검색 관련 7개 파일 95개 테스트 통과: SearchType, NativeCanvasInlineCell, NativeERDCanvas.interaction, NativeCanvasTableRows, native-inline, NativeCanvasScene, NativeERDCanvas.marquee.
- 중간 web TypeScript 검사 통과. 최종 재검사에서는 동시 작업 중인 native-editor-autosave.test.ts:135의 union narrowing, native-export-state.test.ts:98/142의 누락 import 오류가 발생했다. 카드 변경 파일의 오류는 없다.
- NativeERDCanvas.test.ts를 포함한 확장 실행: 99건 중 96건 통과, 3건 실패. 다른 워커의 자동저장 전환으로 제거된 수동 submit 버튼을 기대하는 테스트(227/598/658행)이며 이 작업에서는 수정하지 않았다.
- 변경 파일만 Prettier 적용/검사. 전체 format은 실행하지 않았다.
- 브라우저 실제 DOM 조작은 수행하지 않았으며 기존 컴포넌트 이벤트·hook 테스트 방식으로 검증했다.

## 복구폼 통합 시 확인할 사항

- NativeCanvasActions note/view는 각각 upsert_note/upsert_combined_view를 사용한다. 서버·모델은 기존 ID를 갱신하므로 add 중복은 없다.
- 현재 NativeCanvasInputForm 저장 성공 경로의 fresh()는 생성폼의 빈 initial로 되돌아갈 위험이 있다. 승인된 입력을 다음 before/values로 유지할 필요를 이 채팅에 보고했다(Nash/오너 통합 대상). 이 파일은 수정 금지 범위다.
- reference 작업은 후속 좌표 입력도 add_table_reference를 생성한다. 이미 생성된 참조에 대해서는 update_node_layout으로 전환하는 보완이 필요하다.
