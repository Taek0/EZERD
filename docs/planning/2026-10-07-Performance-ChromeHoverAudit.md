# 실제 Chrome hover 표시 이상 조사 계획

- 재설치된 Chrome 확장에서 localhost:3001 사용자 탭을 claim하여 DOM 읽기에 성공했다. 사용자 문서는 조회와 로컬 카메라/도구 조작만 허용하며 저장/수정하지 않는다.
- 현재 실제 문서는 10% 배율, 50개 카드(테이블 36개 및 기타 객체), 118개 관계선 SVG path, surface overflow:clip 및 scrollLeft/Top=0이다.
- 사용자에게 버튼 없는 hover 재현을 요청하고, 전후 camera·카드 style/rect·row count·SVG path·부모 레이어 상태를 비교한다.
- 도구 screenshot과 사용자가 보는 화면의 동일성도 확인한다. 고정된 과거 캡처를 현재 상태로 해석하지 않는다.
