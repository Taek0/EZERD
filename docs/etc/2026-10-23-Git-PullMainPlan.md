# 원격 main 반영 계획

- 작업 트리는 깨끗하다. fetch 결과 로컬 전용 5개, 원격 전용 2개 커밋이다.
- 로컬 HEAD a621162와 원격 squash 병합 0e901fd(PR #15)의 tree hash가 c21ee17bc16dcf23e20108504157d541a86027d3로 동일하다. 로컬 커밋들은 origin/codex/single-page-pdf-export에도 보존되어 있다.
- 이미 병합된 5개 커밋은 재적용하지 않고 origin/main 3eef432(PR #16 포함)으로 로컬 main을 맞춘다.
