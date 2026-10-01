# C2h native 테이블 clipboard 소비 준비 결과

- [계획](../planning/2026-10-01-Database-NativeClipboard.md), [전체 진행](2026-10-01-Database-ImplementationProgress.md).
- contracts의 `ezerd/tables` formatVersion 2에 source DB/profile과 자급적인 native fragment를 추가했다. 기존 v1 reader는 별도로 원문 타입 alias를 보존하며 native paste에서 DB를 추측하지 않는다.
- 선택 테이블의 컬럼/key/index/check/필요 ENUM/내부 FK와 global 배치를 복사한다. 외부 FK 제외 목록을 돌려주고 domain/private view/메모/카메라는 복제하지 않는다. legacy 신규 복제와 누락 참조·잘못된 DB/모드를 차단한다.
- paste planner는 충돌 없는 entity/node ID, 목적 domain/좌표, AST·ENUM·FK 참조를 생성한다. ENUM은 schema/name/값 순서까지 동일할 때만 재사용한다. 이름 충돌은 DB별 case와 길이 제한 안에서 suffix로 해결한다. 원본/대상 입력은 변경하지 않는다.
- 조각뿐 아니라 전체 merged 후보의 구조·1.5 MB 문서·좌표 한도와 native write 정책을 검사한다. envelope는 UTF-8 기준 2 MB로 제한한다. 기존 unrelated legacy 문제는 previous 기반 복구 규칙으로 유지한다. 미검증 기능 때문에 현재 `canApply`는 false이며 live v1 clipboard/저장은 변경하지 않았다.
- 의미 있는 테스트 10개 통과: 세 DB 참조/배치 remap, 외부 FK 알림, private 제외, v1 alias 보존, 다른 DB/legacy 차단, ENUM 재사용과 PG 다바이트 식별자, MySQL 대소문자 충돌, SQLite STRICT, allocator/목적/좌표 오류, 기존 legacy 보존, UTF-8/전체 후보 용량.
- 전체 `pnpm check`: 753개 통과, 44개 건너뜀; 포맷/타입/빌드 통과. 마지막 SQLite fixture를 STRICT 정책에 맞춰 수정한 뒤 해당 테스트 10개를 다시 통과했다. 기존 Vite 큰 번들 경고는 유지된다. 이 단위는 순수 계약/helper이므로 실제 제품 paste/DB 실행 검증으로 보고하지 않는다.

다음은 native 편집 후보/공통 화면 어댑터 및 서버 최종 후보·업그레이드/import/history 소비다. 실제 기능 연결·DDL·SQL 실행·브라우저 QA는 여전히 남아 있다.
