# 성능 lab main 병합 결과

작성일: 2026-10-02

- 로컬 main af943f2를 codex/performance-lab에 병합했다. 원본 main과 DB는 변경하지 않았다.
- 유일한 충돌 docs/README.md는 최신3분류 안내와 성능 작업 위치/도구 링크를 함께 유지했다. AGENTS의 최신 지침과 lab 격리 규칙은 자동 병합됐다.
- lab 전용인 기존 격리 계획/결과2개를 docs/etc로 옮기고 README 참조를 갱신했다. 제품 성능 기록은 planning/work-log에 유지한다.
- 측정 도구/설정/원시 결과는 보존했다. 데이터 모델과 편집기의 큰 변경에 따른 어댑터 호환성은 별도 제품 작업으로 검증·수정한다.
- 복구 브랜치 codex/performance-lab-before-main-20261002를 보존한다. 원격 push와 실제 DB 마이그레이션은 수행하지 않는다.
