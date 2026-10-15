# 비동기 편집 통합 및 원격 반영 계획

- 시작 시 로컬 main과 origin/main은 393ea4e이며 작업 디렉터리는 깨끗하다.
- performance-lab에서 검증한 제품 계획·구조 편집 투영·경량 ACK·변경 버전 일괄 저장 커밋을 main으로 cherry-pick한다.
- 실측 도구와 원시 결과는 lab에 유지한다. main에서 전체 검사를 실행하고 결과 기록을 커밋한 다음 origin/main에 일반 push한다.
- 원격이 진행된 경우 먼저 변경 범위를 확인하고 통합한다. force push는 사용하지 않는다.
