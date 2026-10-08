# ENUM 및 히스토리 UI 개선 계획

- 범위: NativeEnumDialog.tsx, native-enum-dialog.css, NativeHistoryDialog.tsx, NativeHistoryControls.tsx, native-history-dialog.css 및 관련 테스트.
- ENUM: 생성·편집·삭제 상태와 선택 대상을 명시하고 공통 UI 토큰으로 입력줄, 목록, 삭제 영역을 정돈한다. 기존 NativeStructureEditor/NativeDeleteForm을 재사용해 validation과 저장 의미를 유지한다.
- 히스토리: 불러온 이력을 sequence 내림차순으로 표시하되 원본 페이지, nextSince cursor, undo/redo 의미는 유지한다. 팝오버와 목록 높이를 제한하고 내부 스크롤을 제공한다.
- 공용 NativeProjectView/advanced/property/canvas 파일은 수정하지 않는다. docs/EZERD.txt는 수정하지 않는다.
- 대상 파일에만 Prettier를 적용하고 관련 회귀 테스트 및 웹 타입 검사를 수행한다. Git add/commit은 오너가 순차 수행한다.
