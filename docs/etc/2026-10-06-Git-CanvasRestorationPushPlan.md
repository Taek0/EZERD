# 캔버스 복원 커밋 원격 반영 계획

- 요청: 진행된 작업을 원격 main에 push한다.
- 제품 기준점: `a134c60aa01b1d7afde98b45d56aed349a04be04`. 요청 시점의 로컬 main 전용 커밋은 21개이며 작업 트리는 깨끗하다.
- 원격 기준점: `eff2f6a3aadce24865a16651e51054fd9960e361`. 최신 fetch에서 원격 전용 커밋은 없어 일반 fast-forward push 대상이다.
- 방법: 계획을 독립 커밋하고 격리 checkout의 frozen lockfile·공개 예시 환경에서 전체 포맷/타입/테스트/빌드를 검증한다. 제품 기준점 보존과 원격 HEAD를 확인한다.
- 보존: `docs/EZERD.txt`, 실행 중인 localhost 앱·DB, 다른 브랜치와 작업 중 발생하는 별도 변경은 이번 push 과정에서 수정하지 않는다. force push·이력 재작성은 하지 않는다.
- 완료: 확인한 반영·검증 결과를 별도 커밋·push하고 원래 main에 새 커밋이 없으면 fast-forward로 맞춘다. 검증 worktree는 보관한다.
