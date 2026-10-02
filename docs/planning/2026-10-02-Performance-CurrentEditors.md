# 최신 편집기 성능 도구 호환

작성일: 2026-10-02

- main af943f2 병합 후 측정 전용 코드만 현재 모델과 편집기에 맞춘다. 제품 코드는 main 상태를 유지한다.
- v1 fixture는 공유 TABLES_VIEW_ID 배치를 사용하고 기존 데이터 생성은 historical 함수로 보존한다. fixtureVersion2/editorKind/documentSchemaVersion/viewId를 결과에 명시해 이전 결과와 직접 비교하지 못하게 한다.
- v2 Native 편집기는 PostgreSQL 합성 문서와 읽기·팬·줌 전용 별도 페이지로 연결한다. userId를 제공하지 않고 editable=false로 실제 API/DB·개인 draft 저장을 호출하지 않는다. Native 저장·협업·다른 DB 엔진은 완료로 주장하지 않는다.
- Native scene/wheel/type display를 계측하고 실제 Native 문서 계약과 scene 표시에 대한 테스트를 추가한다.
- pnpm check, 측정 빌드, 작은 계산/브라우저 smoke를 검증하고 원시1,449개 SHA-256을 재확인한다. DB 마이그레이션과 원격 push는 실행하지 않는다.
