# 기존 자동 배치 알고리즘의 Native 연결 준비

- 계획: [CompleteParityRestoration](../planning/2026-10-06-Canvas-CompleteParityRestoration.md).
- 기존 Canvas의 관계 기반 자동 배치를 Native에서 재사용하도록 autoLayoutView 입력을 필요한 구조(domains/views/relations/notes/layout/객체 ID)로 한정하고 입력 문서 타입을 그대로 반환한다.
- Native 데이터를 v1 타입으로 변환하지 않으며 DB 타입·프로필·다른 보기와 원문은 보존한다. 알고리즘과 기존 간격·결정적 순서는 유지한다.
- layout/direct-table-canvas 회귀 14개 통과, model build 통과. 실제 Native 메뉴/저장 연결과 브라우저 검증은 다음 단위에서 진행한다.
