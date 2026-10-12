# 패널 너비 조절·컬럼 펼침 성능 개선 계획

- 기준: performance-lab f9853fa. 핀/탐색 너비는 매 pointermove마다 NativeProjectView state를 갱신하고, 컬럼 펼침은 selectedColumnId를 모든 카드 행에 전달하는 경로를 확인했다.
- 기존 동작을 같은 synthetic fixture에서 계측한 뒤 비교한다. 원시 결과는 artifacts/performance에 보존한다.
- 드래그 미리보기는 rAF당 CSS 변수/ARIA를 갱신하고 React 폭 state는 종료 시 확정한다. 키보드, clamp, 마지막 좌표, cancel/lost capture/unmount 및 저장 선호값을 보존한다.
- 선택 컬럼 ID는 소유 테이블에만 전달해 다른 카드의 memo 경계를 유지한다. 펼침/닫힘 애니메이션과 입력 복구는 유지한다.
- focused 회귀 테스트, 전체 검사, fixture 브라우저 비교를 수행한다. main/실제 사용자 문서는 수정하지 않는다.
- apple-design의 즉각적 입력 반응·중단 가능한 모션 원칙을 참고하되, 기존 world will-change:auto 수정은 보존한다.
