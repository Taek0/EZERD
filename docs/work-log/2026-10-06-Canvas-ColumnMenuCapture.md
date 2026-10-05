# 컬럼 키보드 메뉴의 부모 capture 충돌 해소

- 최종 call-site 확인에서 Root의 ContextMenu/Shift+F10 capture가 컬럼 전용 메뉴보다 먼저 처리되는 것을 확인했다.
- data-column-id 내부 키보드 메뉴는 Root가 가로채지 않고 원본 컬럼 context capture로 넘긴다. 입력/IME/권한 guard와 일반 카드/빈 화면 메뉴는 유지한다.
- NativeERDCanvas/NativeCanvasTableRows 집중 회귀 43개 및 웹 타입 검사 통과. 브라우저 검증은 사용자 결정에 따라 제외했다.
