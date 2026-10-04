# 활성화된 signed integer C8 변환의 양성 검증

2026-10-02. catalog/core activation은 부모 범위다. 담당 변경은 conversion-rules.test.ts, conversion.test.ts, project-database.service.test.ts, project-database.integration.test.ts와 이 계획/작업 기록이다. production helper/service/queue/DDL/validator는 수정하지 않으며 commit은 부모가 담당한다.

현재 PostgreSQL18→MySQL8.4와 역방향의 signed16/32/64 registry 세 규칙은 실제 엔진 검증과 양쪽 readiness를 충족한다. 과거 전체 coverage=false 기대를 positive usable/canApply로 바꾼다. 단순 기대값 교체를 넘어서 원문·객체 ID·논리/개인 metadata·sourceMap·원본 불변·왕복 타입을 검증한다. unsigned/alias/array/default/installed collation/constraint/SQLite 등 미검증 매핑은 계속 차단한다.

실제 localhost 전용 UUID QA DB에서 3폭×양방향 성공6건과 같은 방향 rollback6건, 총12 신규 핵심 조합을 실행한다. 기존 replay/role/concurrency/row-lock 검증도 nonempty integer로 전환해 source audit, version/sequence/DB revision, baseline reset, field versions, WS after commit, 기존 ACK 원문 재생 및 fresh 권한 거부를 확인한다. rollback은 프로젝트/문서/operation ledger/audit/baseline/field version을 비교하고 notify가 없는지 확인한다.

scripts/test-isolated.ts의 localhost 검증·UUID DB 생성/migration/finally DROP을 사용한다. root shared build가 최신 activation을 포함하는지 확인하고 targeted model/server tests, 해당 패키지 typecheck, 지정 파일 Prettier를 수행한다. 이전 엔진 폭 evidence를 재사용하되 PostgreSQL에 MySQL SQL을 실행했다고 주장하지 않는다. 이 unit의 실제 DB 검증 대상은 conversion 서비스의 durable transaction이다.
