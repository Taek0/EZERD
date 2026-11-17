# 고스트 드래그 UI 적용 결과

[구현 계획](../planning/2026-10-27-Canvas-GhostDragImplementationPlan.md)에 따라 테이블 포인터 드래그를 단순 고스트 프리뷰와 드롭 후 Worker 계산으로 연결했다.

- 포인터 이동은 시작 시 확보한 그룹 경계와 줌을 사용하여 RAF transform만 변경한다. 원본 카드, 관계선, 초안은 유지한다. 제목·색상·크기만 표시하며 world GPU 강제 승격과 관성은 추가하지 않았다.
- 최종 pointerup 좌표로 장면 입력을 준비하고 Worker 결과를 캐시에 설치한 뒤 명시적 최종 nodesJSON/commands를 기존 초안·저장 경로에 전달한다. 서버 ACK 전에 고스트를 해제한다.
- 다중 선택·생성된 참조·100개 한도·클릭의 기존 4-world-unit 판정을 유지한다. 0 이동은 Worker와 저장을 실행하지 않는다.
- Escape, drag 중 capture 취소, 사용자/뷰/문서/권한/저장 기준/카메라 변경과 unmount는 프리뷰와 Worker를 폐기한다. drop 후 의도적 capture 해제는 Worker를 유지한다. 취소 후 늦은 RAF는 새로운 세션을 변경하지 않는다.
- 휠은 고스트 중 차단하고 다른 카메라 변경은 작업을 취소한다. 미저장 초안 및 저장 오류가 있는 상태는 새 드래그를 시작하지 않는다.

실 React/jsdom 회귀 9개를 통과했다. 이동 중 Worker·초안·저장 없음, 최종 좌표의 단일 저장, 미완료 서버 ACK와 무관한 프리뷰 해제, Worker 이후 메인 relationGeometry 호출 없음, Escape/권한/capture/오류 취소, reader-generated 카드, 선택 그룹 상대 위치, 휠 및 도구 모음 줌을 검증했다. 기존 interaction/lifecycle 58개도 통과했다. 전체 포맷·타입·제품 검사와 실제 성능 복제본 확인은 루트 작업에서 수행한다.

## 통합 검토 보완

- 고스트가 없을 때 scope 정리가 불필요한 React commit을 만들지 않도록 표시 상태를 구분했다. 기존 팬 100샘플/1commit 회귀를 유지한다.
- 고스트 제목은 기존 테이블 header 팔레트와 노트의 대비 색상을 사용한다.
- 프로젝트 version 및 저장 오류/준비 상태 변화도 계산을 취소한다. window blur는 진행 중 drag만 취소하고 이미 놓은 계산은 유지한다.
- 최종 ghost/lifecycle 집중 검사 23개 통과. 실제 browser 및 전체 검사 결과는 통합 기록을 따른다.
