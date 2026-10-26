# 경로 의미 비교와 무변경 저장 3단계 결과

[계획](../planning/2026-10-26-Relations-PreflightImplementationPlan.md)의 3단계로 JSON 직렬화 비교를 명시적인 경로 필드 비교로 바꿨다.

- relationId/viewId/offset, bend 좌표, 양쪽 anchor 면/비율, waypoint 개수·순서·좌표를 정확히 비교한다. 필드 선언 순서와 optional undefined 표현은 무시하되 반올림이나 오차 허용은 추가하지 않는다.
- waypoint 누락(자동 경로)과 빈 배열(명시 경로)은 다르게 취급한다. 저장 경로의 부재와 명시 offset 0 경로도 충돌 감지에서는 구분한다. diff/undo에서만 기존 암묵적 offset 0 동등성을 유지한다.
- batch 필터와 기존 persist의 빈 routes 저장 생략을 유지한다. 모두 동일하면 save/대기열/undo marker 생성이 없다. 일부만 변경되면 해당 경로만 command에 남는다.
- controller, relation arrange integration, canvas lifecycle 세 파일 49개 테스트 통과. 필드 순서가 바뀐 snapshot, 정확한 미세 좌표/anchor 변화, waypoint 순서·누락/빈 배열, 혼합 batch, 계산 중 경로 삭제 충돌을 검사했다. 기존 한 번의 undo·ACK·복구 검사도 통과했다.

제품 저장 프로토콜과 서버 identity 보호는 변경하지 않았다. 전체 통합 검사는 별도 기록한다.
