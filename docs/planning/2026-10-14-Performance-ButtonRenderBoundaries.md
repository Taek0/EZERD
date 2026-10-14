# 버튼 응답성 개선 구현 계획

- 기준 제품 코드 main 1fa6b08와 동등한 lab에서 구현한다. main 고유 변경은 보존한다.
- 1단계: NativeCanvasTableRows에 React 기본 shallow memo 경계를 적용한다. 콜백/문서/권한 상태를 무시하는 비교 함수는 만들지 않는다. 기존 메뉴·인라인 편집 회귀를 유지한다.
- 2단계: 접힌 탐색 컬럼 목록은 열 때 마운트하고 닫힘 CSS transition 완료 후 해제한다. 재열기, reduced motion, 포커스 이동, 검색 자동 펼침을 검증한다. 기존 모션을 유지한다.
- 실험용 대조 plugin은 끄고 실제 제품 구현으로 이전 버튼 fixture를 다시 측정한다. 전체 검사 후 제품 커밋만 로컬 main에 선별 반영한다. 원격 push는 하지 않는다.
