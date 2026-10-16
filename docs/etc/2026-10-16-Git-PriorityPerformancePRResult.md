# 성능 lab 푸시 및 제품 PR 결과

- lab 원격: origin/codex/performance-lab. 측정 도구는 이 브랜치에 유지했다.
- 제품 PR: https://github.com/Taek0/EZERD/pull/13
- 제품 브랜치: codex/priority-performance, 최신 origin/main f318b8e 기반.
- 다섯 성능 개선과 회귀 테스트·관련 문서만 선별했고 lab 측정 도구·원시 결과는 제외했다.
- 제품 워크트리: D:/ChatGPT/ERD-priority-performance-pr. pnpm check 성공: 3,052 passed / 500 skipped. 최초 기존 font-cache timeout은 같은 명령 재실행으로 통과했다.
- GitHub에서 main 대상 OPEN/MERGEABLE 확인. CI 상태는 별도이며 자동 병합은 하지 않았다.
