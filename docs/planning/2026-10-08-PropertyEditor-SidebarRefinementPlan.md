# 속성 사이드바 UI 정리 계획

- 담당: NativePropertyEditor.tsx, native-editor-format.tsx, NativePrimaryKeyControl.tsx, 관련 테스트와 신규 범위 CSS.
- 기존 SearchType으로 타입 검색을 제공하고 이름 → 타입 → 설명 → 기본 키 순서로 배치한다.
- 작은 편집 제목과 컬럼 현재 값 요약을 숨기거나 제거하고 DB 옵션 기본 접힘을 유지한다.
- MAIN 담당의 논리설계 context API가 준비되면 표시 조건에 연결하며 데이터와 validator는 유지한다.
- 공용 폼, SearchType 원본, NativeProjectView, NativeERDCanvas는 수정하지 않는다.
- 관련 테스트와 웹 타입 검사를 실행하고 변경 파일만 포맷한다. 사용자 지시에 따라 Git add/commit은 실행하지 않는다.
