# 캔버스 카드 감사 후속 복원

- 기준: [전체 복원 계획](2026-10-06-Canvas-CompleteParityRestoration.md), [항목별 감사](../work-log/2026-10-06-Canvas-ParityAudit.md), 카드 표현 복원 커밋 `1faeda8`.
- S07: 원본 `prepareExportContent()`와 같이 PNG에서 컬럼 추가·도메인 열기 등 동작 버튼의 glyph를 제외하고 모델의 키·NULL·텍스트와 footer 배경은 유지한다.
- S08: 실제 keyed `.native-scene-entry`에 원본 `domain-enter` 240ms 효과를 연결한다. reduced motion에서는 진입 animation을 끈다.
- Scene/rows에 부모 소유 `NativeEditorContext`와 구조 편집 요청을 전달한다. 인라인 에이전트가 소유한 `NativeCanvasInlineCell`, `NativeCanvasInlineEditor`, `native-inline-edit`는 수정하지 않는다.
- 원본 컬럼 ContextMenu의 컬럼 추가·속성·PK·삭제·PK 연결과 연결된 관계 접근을 복원하되 저장·확인·DB capability·busy guard는 부모 Native 경로에 남긴다. 테이블 header/blank/node 메뉴는 부모가 소유한다.
- 부모가 전달하는 callback/context의 변경도 Scene memo에 반영한다. 네이티브 데이터 및 scope를 보존하며 v1 투영을 추가하지 않는다.
- 담당 파일의 scoped 테스트·타입검사·Prettier만 실행한다. 사용자 결정에 따라 브라우저 QA와 전체 check는 제외한다. 결과를 기존 [카드 결과 기록](../work-log/2026-10-06-Canvas-CardVisualParity.md)에 갱신하고 독립 커밋한다.
