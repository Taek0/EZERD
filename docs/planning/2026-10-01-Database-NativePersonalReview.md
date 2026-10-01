# C3 native 공통 캔버스의 personal/review 소비

- 시작 `bec3444`, 작업 트리 깨끗함. DB와 무관한 리뷰/개인 화면 경로가 v1 normalizer에 의존하므로 native 저장 활성화 전에 공통 소비로 연결한다.
- personal extract/merge/reconcile와 shared canvas selection/nodes를 SQL 필드와 무관한 구조로 일반화한다. 기존 v1 출력·개인 상태 schema는 유지한다. merge에서 이전 공유 문서의 legacy combined-view 항목도 제거해 사용자가 개인 화면을 삭제했을 때 옛 공유 private note가 되살아나지 않게 한다. 저장 원본을 삭제하지 않는다.
- version-aware current reader로 native 문맥/배치/예산을 확인한다. 리뷰 핀은 이 common canvas와 인증된 사용자 자신의 personal 행을 합친 객체/배치를 사용한다. 다른 사용자의 private 객체는 조회하지 않는다. personal GET/PUT는 사용자별 상태만 읽고 쓰며 project 문서/version/sequence를 변경하지 않는다.
- native personal 최종 merged 후보도 전체 구조·예산과 공통 정책(previous는 서버 current)으로 검사하고 shared diff가 있으면 차단한다. native index/check와 개인 엔티티 ID 충돌도 차단한다. MCP personal command 생성/갱신 helper는 아직 v1이므로 native 명령 쓰기는 명시 차단하고 JSON personal 상태 저장 경로만 연결한다.
- 의미 있는 generic/native merge·기존 private 제거·physical 데이터 보존 테스트, native 개인 camera/view/note 저장·리뷰 pin·비멤버/다른 사용자 격리·원본 불변을 격리 DB HTTP로 검증한다. native shared 설계 저장을 활성화하지 않는다.
