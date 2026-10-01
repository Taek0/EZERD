# C3 native 읽기 preview와 공통 캔버스 결과

- [계획](../planning/2026-10-01-Database-NativeReadPreview.md). SQL/타입을 다루지 않는 기존 canvas 알고리즘을 v1/native 공통 구조로 일반화했다. 기존 v1 출력과 alias 정규화는 유지한다.
- native 생성 node ID에만 160자 계약 한도를 지키는 prefix와 기존 deterministic collision suffix를 적용한다. 객체 ID 자체는 바꾸지 않는다. 공유 domain 메모/route는 기존 global canvas 정책을 사용하고 private view/카메라는 보존한다.
- 서버 `readNativeProjectDocument`는 exact rawSource, 구조 reader 결과(stored), canonical native preview를 별개로 반환한다. preview를 수정해도 source/stored를 변경하지 않는다. v1 migration은 프로젝트 kind/profile만 전달하고 revision을 document.database에 섞지 않는다.
- PostgreSQL v1 알려진 alias는 의미를 유지해 native로 읽고, MySQL/SQLite v1 타입/default/schema 원문은 legacy로 유지한다. native context가 프로젝트와 다르면 raw/stored를 보존한 unavailable 상태를 반환한다. migration/canvas 확장 후 native 문서 예산·구조 실패도 원본 읽기를 잃게 하지 않는다.
- read 모드 진단을 계산하며 미검증 기능을 활성화하지 않는다. GET 저장/업그레이드/새 baseline을 수행하지 않는다. live API/저장은 여전히 v1이다.
- 새 reader 테스트 9개와 기존 table-canvas 테스트 합계 12개 통과: 세 DB 원문/문맥, 공유 메모·route 좌표/private 보존, native AST/index/check와 snapshot 분리, 긴 ID 충돌·멱등성, v1 결과, 확장 용량 초과, 잘못된 원본/DB 문맥.
- 전체 `pnpm check`: 794개 통과/44개 건너뜀, 포맷·타입·빌드 통과. 공통 v1 canvas 소비에 영향이 있어 격리 PostgreSQL autosync 통합 8개를 실행해 모두 통과했다. 임시 DB의 migration/API/WS를 검증하고 runner가 정리했다. 기존 Vite 큰 번들·runner child-process shell 경고는 유지된다.

다음은 versioned 조회/업그레이드/import/history·SyncService/MCP/web의 실제 소비 연결이다. native readonly 준비 결과만으로 저장을 활성화하지 않는다. 실제 native DB 실행·브라우저/UI·DDL 검증과 전체 명세 구현은 미완료다.
