# 테이블 배치·관계 탐색 제품 PR 결과

- codex/performance-lab 원격 push 완료. 측정 도구와 원본 입력은 제품 PR에 포함하지 않았다.
- PR: https://github.com/Taek0/EZERD/pull/14
- 대상 main, 브랜치 codex/table-layout-routing-performance, 기준 origin/main 880f9bc.
- 제품 워크트리 D:/ChatGPT/ERD-layout-routing-pr에서 pnpm check 통과: 3,090 passed / 500 skipped. 최초 기존 font-cache timeout은 동일 명령 재실행으로 통과했다.
- 모델·UI·회귀 테스트·관련 문서만 선별했다. 실행 서버 변경이나 main 병합은 수행하지 않았다.
