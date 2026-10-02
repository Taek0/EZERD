# 성능 워크트리 main 동기화 계획

작성일: 2026-10-02

- lab 기준 efe296f, 반영 대상 로컬 main af943f2. 원격보다 앞선2개 커밋은 기록 문서이며 함께 반영한다. 기본 D:/ChatGPT/ERD는 변경하지 않는다.
- 복구 브랜치 codex/performance-lab-before-main-20261002와 원시 결과1,449개 파일의 SHA-256 manifest를 .cache/main-sync-artifacts-20261002.json에 보존했다.
- main을 lab에 merge하여 이력과 측정 도구를 유지한다. AGENTS/문서 충돌은 최신3분류 지침과 격리 작업 원칙을 함께 보존한다.
- 제품 코드가 main과 동일한지, 측정 fixture와 API가 현재 모델에서 동작하는지 확인한다. 필요한 제품 측정 어댑터 수정은 별도 planning/work-log에 기록한다.
- 의존성·단위·타입·빌드 및 최소 계산/화면 준비를 검증한다. 실제 DB 마이그레이션·운영 서버 조작·원격 push는 하지 않는다.
- 기존 결과는 덮어쓰지 않고 이전 코드의 기록으로 유지한다. 현재 Native/legacy 구분과 측정 가능 범위를 명시한다.
