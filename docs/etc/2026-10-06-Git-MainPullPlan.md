# 원격 main 갱신 및 변경 확인 계획

- 요청: 원격 main을 내려받고 변경사항을 확인한다.
- 시작 상태: 로컬 main `8390e9e`, 작업 트리 깨끗함. 원격은 `origin` (`https://github.com/Taek0/EZERD`).
- origin/main을 fetch한 후 ahead/behind와 변경 범위를 확인한다. fast-forward가 가능하면 로컬 main을 갱신한다.
- UI·캔버스·컴포넌트 및 DB native 구현에 영향을 주는 변경을 살펴보고 결과를 기록한다.
- 원격 변경과 사용자 데이터를 보존하며 docs/EZERD.txt는 수정하지 않는다.
