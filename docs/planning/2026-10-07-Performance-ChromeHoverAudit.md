# 실제 Chrome hover 표시 이상 조사 계획

- 재설치된 Chrome 확장에서 localhost:3001 사용자 탭을 claim하여 DOM 읽기에 성공했다. 사용자 문서는 조회와 로컬 카메라/도구 조작만 허용하며 저장/수정하지 않는다.
- 현재 실제 문서는 10% 배율, 50개 카드(테이블 36개 및 기타 객체), 118개 관계선 SVG path, surface overflow:clip 및 scrollLeft/Top=0이다.
- 사용자에게 버튼 없는 hover 재현을 요청하고, 전후 camera·카드 style/rect·row count·SVG path·부모 레이어 상태를 비교한다.
- 도구 screenshot과 사용자가 보는 화면의 동일성도 확인한다. 고정된 과거 캡처를 현재 상태로 해석하지 않는다.

## 실제 문서 비교 결과와 수정 계획

- 실제 Chrome에서 손 도구의 버튼 없는 이동 전후 camera/카드 style·rect·row count/SVG path/패널·surface rect가 모두 동일한 상태로 가로 띠 손상을 캡처했다.
- 사용자 확인: 실제 문서 복제 화면에서 content-visibility 강제 visible이어도 발생. 새로고침 후 world의 will-change:transform만 해제하면 발생하지 않음.
- 15% 이하에서 world의 will-change 힌트를 auto로 바꾸고 일반 배율은 기존 transform 힌트를 유지한다. 카메라 계산과 카드/관계선 DOM은 변경하지 않는다.
- 역방향 토글 비교 및 수정본에서 10/15%와 일반 배율 전환을 검증한다. Chromium 내부 결함이나 드라이버 원인까지 확정한 것으로 표현하지 않는다.

## 확대·축소 왕복 결과에 따른 범위 수정

- 사용자 확인: 15% 이하에서만 자동 해제하는 후보는 진단 토글을 끄고 새로고침한 뒤 확대·축소를 반복하면 재발했다. 토글로 모든 배율에서 힌트를 해제한 상태는 정상이다.
- 따라서 Native world에는 배율과 관계없이 willChange:auto를 적용한다. generic/legacy canvas CSS나 GPU 설정은 변경하지 않는다. 배율 왕복에서도 힌트를 다시 적용하지 않는 회귀 테스트를 유지한다.
