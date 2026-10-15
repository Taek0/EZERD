# 로컬 렌더 비용 개선 main 반영 계획

- main 시작 기준 3473dbb, 기존 미커밋 변경 없음.
- performance-lab에서 검증한 PK preview 재사용과 회귀 테스트·제품 문서만 cherry-pick한다.
- 계측 도구/원시 자료는 lab에 남긴다. main에서 전체 검사를 통과한 뒤 결과를 기록한다.
- 이 작업에서는 원격 push 없이 로컬 main에서 검토할 수 있게 유지한다.
