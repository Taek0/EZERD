# 원격 main 갱신 계획

- 요청: 원격 main pull 및 변경사항 확인.
- 시작 상태: 로컬 main 396ba24, 작업 트리 clean. fetch 후 origin/main 1ac4d6d, 로컬 전용 문서 커밋 3개/원격 전용 97개.
- 로컬 문서 커밋을 보존하는 pull --rebase를 수행한다. 기존 HEAD는 별도 로컬 백업 브랜치로 보존한다.
- 원격의 PR #2 병합 이후 변경 및 전체 유입 범위를 확인한다. 성능/제품 별도 워크트리는 변경하지 않는다. push나 DB migration, 서버 재시작은 수행하지 않는다.
