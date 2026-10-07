# PR6 이후 저배율 표시 이상 추가 기록

- PR6은 origin/main 8f142c2에 병합됐고 로컬 main에도 반영됐다. localhost:3001 HTML은 수정 CSS index-2VUnDHIW.css를 제공한다.
- 사용자는 버튼 없이 손 도구 커서만 움직여도 아직 깨지지 않은 영역이 함께 깨진다고 추가로 확인했다. 좌표 점프 수정으로 이 현상이 해결됐다고 주장하지 않는다.
- 실제 Chrome을 요청받아 inventory를 여러 번 새로 조회하고 실행 환경을 초기화했다. 도구에는 IAB와 MCP Apps만 나타났고, cua.getTab({url:'http://localhost:3001/'},{browser:'chrome'})은 Browser is not available: chrome을 반환했다. 사용자가 연결했다고 알려준 사실과 도구가 현재 접근 가능한 상태를 구분한다. 실제 사용자 탭은 조회/조작하지 못했다.
- 실제 NativeERDCanvas 이벤트 핸들러 회귀 테스트를 추가했다. 10% 배율, 손 도구, 드래그 시작 전 hover와 정상 pointerup 후 buttons=0 이동이 카메라를 바꾸지 않음을 검증했다. 해당 파일 12개 테스트 통과. 이는 실제 브라우저 CSS hover/paint 검증을 대체하지 않는다.
- fixture에 36개 객체 및 1x/4x/8x 좌표 간격 옵션을 준비했고 성능 타입 검사/빌드는 통과했다. 실제 넓은 장면 브라우저 비교는 아직 실행하지 않았다.
- 새로운 제품 동작 변경/기본 main 변경/원격 push는 수행하지 않았다. 다음 단계는 접근 가능한 실제 Chrome 탭에서 buttons=0, 카메라 불변, hover 대상·pseudo 상태 및 원본 픽셀을 같은 시점에 비교하는 것이다.

[계획](../planning/2026-10-07-Performance-PostScrollVisualIssue.md)
