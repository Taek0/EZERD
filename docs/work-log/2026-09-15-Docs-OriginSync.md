# 원격 문서 구성 동기화

- 로컬 docs/planning 및 docs/work-log의 문서 구성과 docs/README.md 안내를 원격에 반영한다.
- 기존 문서 이름은 유지하고 새 동기화 계획·기록만 날짜 기반 이름으로 작성했다.
- 루트 README의 링크와 버전 문서 생성 스크립트의 출력 경로·상대 링크를 맞췄다.
- 로컬에서 이미 삭제된 EZERD.txt를 가리키던 문서 안내 행을 제거했다.
- README와 전체 문서의 상대 링크 존재 여부, 버전 문서 생성 스크립트의 Node 문법 검사와 Prettier 검사를 통과했다.
- origin/main 기반 별도 작업 공간에 문서 스냅샷을 구성한다. 로컬에만 있는 기능 커밋과 진행 중 코드 변경은 push에 포함하지 않는다.
- 최종 원격 반영 여부는 push 성공 및 origin/main의 docs Git tree 비교로 확인한다.