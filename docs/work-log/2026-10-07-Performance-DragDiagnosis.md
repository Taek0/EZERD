# 캔버스 드래그 경로 검증 결과

## 확인한 사실

대상은 main `3623b0b` 및 2026-10-07 조사 중의 로컬 수정본이다. main 파일은 수정하지 않았다. 검증은 실제 NativeERDCanvas.tsx를 TypeScript AST로 읽어 pointer handler 본문을 추출하고 상태 setter 감시 함수와 함께 실행했다. 전체 React 렌더, 브라우저 프레임 또는 사용자가 체감한 멈춤 시간의 측정은 아니다.

- 100개 노드 중 선택 대상이 동일하게 유지되는 이동 이벤트 120회를 실행했다.
- 사각형 상태 갱신 120회, 선택 배열 갱신 120회, 그중 선택 내용이 이전과 같은 갱신 120회를 확인했다. 교차 판정 대상 방문은 12,000회다.
- selectedObjectIds 새 배열이 visibleSelection 및 memo NativeCanvasScene으로 전달된다. 따라서 선택 결과가 같아도 scene memo를 무효화하는 경로가 있다. 내부 테이블 행의 실제 렌더 횟수는 이 검증으로 측정하지 않았다.
- 기존 커밋은 lostpointercapture 이후 marqueeGesture가 남았고 추가 pointermove에서도 상태가 갱신됐다.
- 조사 중 main에 별도로 추가된 종료 처리 수정본은 lostpointercapture 후 marquee를 해제했고 추가 move 갱신도 없었다. 이 변경은 다른 진행 작업이므로 이 조사에서 수정·커밋하지 않았다. 반복 선택 갱신은 수정본에서도 동일했다.

## 테이블 자체 이동 경로

NativeCanvasScene의 pointermove는 매번 preserve를 호출한다. preserve는 이동 명령 및 draft를 생성하고 JSON 직렬화, setDraft, storeNativeEditorDraft를 실행한다. 그룹 이동 역시 preservePlacements에서 초안을 저장한다. 따라서 영역 선택 외에도 이동 경로에 이벤트마다 초안 저장·상태 갱신이 존재한다. 저장 비용과 scene/관계선 재계산의 실제 소요 비중은 아직 계측하지 않았다.

## 검증 경계와 다음 순서

localhost:3001 응답을 확인했으나 검증 브라우저는 로그인 화면이었다. 계정 생성/인증/실제 문서 변경은 수행하지 않았다. 사용자 환경의 FPS, 지연 ms, 특정 OS 원인이나 무한 렌더 루프는 확인한 것으로 주장하지 않는다.

1. 동일 선택 결과의 상태 갱신을 생략하고 영역 사각형 표시를 scene 렌더와 분리한다.
2. 이동 계산을 프레임당 한 번으로 묶고 pointerup/cancel/capture loss의 마지막 상태 처리를 보장한다.
3. 테이블 이동의 화면 미리보기와 durable draft 저장 빈도를 분리하되 복구 보장을 유지한다.
4. 실제 편집기 fixture에서 영역 선택/단일 이동/그룹 이동 각각의 React 시간, frame 간격, 저장 횟수를 비교한다. content-visibility 선택 예외 변경은 브라우저 paint 계측 후 판단한다.

검증 스크립트는 lab `.cache/drag-handler-probe.mjs`, 원시는 `artifacts/performance/2026-10-07-drag-diagnosis/handler-probe-{baseline,working}.json`에 보존했다(Git 제외). 원시에는 실행 소스 SHA-256을 기록했다.

[조사 계획](../planning/2026-10-07-Performance-DragDiagnosis.md)
