# Canvas interaction/layout 계획

- 속성 상단 카드 표시 그룹은 일반 선택에서 제거하고 기존 property 색상/옵션 및 명시적 복구 경로는 유지한다.
- 컬럼 이름/타입 우클릭을 기존 컬럼 메뉴로 전달한다. 키보드 입력 및 IME는 보호한다.
- H/V 도구 전환을 캔버스 포커스 밖에서도 지원하고 입력·오버레이·드래그 중에는 무시한다.
- 배율 버튼 너비와 sidebar resize 표시선을 native 전용 CSS로 고정한다.
- ACK 지연과 로컬 배치 이동 사이의 busy 조건을 검토한다. 서버 payload는 변경하지 않는다.
- NativeProjectView/NativeCanvasToolbar는 수정하지 않는다. Git add/commit과 전체 포맷을 실행하지 않는다.
- 관련 Vitest 및 웹 타입 검사를 수행한다.
