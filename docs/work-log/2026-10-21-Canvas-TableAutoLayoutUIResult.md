# 테이블 자동 배치 UI 결과

계획: [테이블 자동 배치 개선](../planning/2026-10-21-Canvas-TableAutoLayoutPlan.md)

- 테이블 배치 명시적 실행에서 측정된 표시 카드와 표시 모드에 맞는 관계만 Worker로 보낸다. 물리 모드에서는 물리 정보가 없는 관계를 제외한다. 도메인 개요는 기존 배치를 유지한다.
- 메모와 숨긴 카드는 이동 대상에서 제외한다. 표시는 유지하고 메모 아래 200 간격부터 테이블을 배치한다.
- 100개 저장 한도를 계산 전에 검사한다. 결과는 기존 saveCommands 한 번으로 저장해 한 번의 실행 취소를 유지한다. 관계선 고비용 정리는 자동 실행하지 않는다.
- Worker 응답은 입력 카드 ID·표시 화면·크기·개수와 유한한 좌표 범위를 검증한다. 취소, 문서·모드·화면·사용자·권한 변경, unmount, 30초 제한 및 예외 시 Worker와 이벤트 핸들러를 정리한다.
- 기존 우하단 토스트 스타일로 계산·취소·변경 중단·성공·실패를 알리고 계산 중에는 모드 이동과 중복 배치를 잠근다.

검증: web typecheck 통과. native-canvas-selection, native-table-auto-layout, native-relation-arrange-integration, NativeERDCanvas.lifecycle 총 4개 파일 23개 테스트 통과. StrictMode 재실행 후 시작, 한 번의 UI 저장, 모드 변경 후 늦게 도착한 결과 폐기, Worker 취소/timeout/잘못된 응답, 기존 배치의 한 번 실행 취소를 포함한다. 변경 파일만 Prettier 적용했다. 전체 검사와 커밋은 통합 작업에서 수행한다.
