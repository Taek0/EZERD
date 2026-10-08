# 권한을 유지하는 Native 공유 조회 캐시

- `getNativeQueryState`는 매 호출 접근 권한과 프로젝트 head를 확인한다. 캐시 hit에서는 문서 본문을 다시 읽지 않는다.
- 캐시 키는 프로젝트·공간·생성/갱신 시각·version·sequence·DB revision/kind/profile을 포함한다. 최대 32개 및 JSON 환산 16 MiB로 제한한다.
- 개인 상태와 상세 preview/DB 진단은 캐시하지 않는다. 원본 검증 후 복제·동결해 큰 숫자, 공백 및 legacy 원문을 보존한다.
- 기존 repeatable-read 읽기 트랜잭션으로 head와 본문이 서로 다른 시점에 섞이지 않도록 한다.
- 권한 재검증·버전 변경·메모리 한도·잘못된 입력·원본 보존·동시 head 변경 등 테스트 11개를 통과했다.
