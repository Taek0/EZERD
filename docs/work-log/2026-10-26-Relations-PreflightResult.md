# 관계 자동 정리 클라이언트 사전 검증 결과

[구현 계획](../planning/2026-10-26-Relations-PreflightImplementationPlan.md)의 2단계를 구현했다. 메뉴와 controller 시작, Worker 결과 수신 및 저장 직전에 같은 로컬 preflight를 사용한다. 편집 가능 범위·사용자·뷰, 현재 문서 관계와 양 끝 테이블, 현재 뷰의 표시 배치, 중복/누락, 좌표·크기·개수 제한을 검증한다. 원본 layout.nodes가 없어도 현재 문서에 테이블이 있고 표시 배치가 생성되어 있으면 기존 저장 보정을 허용한다.

busy/recoveryWaiting/미저장 배치/stale/storageError는 별도 ready 값으로 전달한다. ready는 구조 signature에 포함하지 않으며 이미 제출한 저장·ACK·offline 취소 복구를 무효화하지 않는다. 저장 전에는 다시 준비 상태를 확인한다. 현재 테이블·메모 이동 보정과 서버 권한/충돌 보호, 경로 동등성 비교는 유지했다.

검증: controller와 canvas lifecycle 집중 테스트, web TypeScript 검사. 시작 전 삭제/오래된 endpoint/권한/준비 상태/잘못된 배치·bounds·개수에서 Worker 미생성, 늦은 결과 저장 차단, 생성 배치 허용, 저장 중 busy 전환 뒤 ACK/취소 복구 유지, 저장소 읽기 실패를 회귀 검사했다. 기존 no-op ACK 및 오프라인 복구 검사도 포함한다.
