# 로컬 우선 컬럼 편집 브라우저 검증

- 쓰기 차단된 127.0.0.1:4180 fixture에서 모의 서버 응답을 gate로 보류했다. 실제 서버 문서에는 쓰지 않았다.
- 첫 이름 명령이 큐에 보관된 후 ACK 전 DOM에 반영됐다(beforeAck=true).
- 첫 요청 대기 중 두 번째 이름을 보관했고, 첫 ACK 반영 후에도 두 번째 이름이 유지됐다(afterEarlierAck=true). 20ms DOM 샘플에서 이전 값으로 되돌아가는 사례는 없었다(neverReverted=true; 픽셀 단위 보장은 아님).
- 실제 카드의 컬럼 추가 버튼을 클릭했고 ACK 전 새 행이 나타났다(addBeforeAck=true). 최종 ACK 후 행은 한 개, 큐는 비었고 sequence=3으로 확인했다.
- raw: artifacts/performance/2026-10-14-local-first/browser.json. 계측 도구 커밋 3c9e023, 제품 fbbc0d5 기준. 후속 오프라인/권한 표시 보완은 단위 회귀와 최종 main 전체 검사로 검증했다.
- 이 단계는 기존 전송·초안 내구성 구조를 유지한 공통 화면 투영이다. 키 입력마다 모든 canvas를 즉시 갱신하거나 모든 명령을 로컬 처리하도록 바꾼 것은 아니다.

[계획](../planning/2026-10-14-Performance-LocalFirstColumns.md)
