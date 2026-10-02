# C6 native literal·key 정책 구현 및 실행 evidence

- 계획: [NativeLiteralKeyPolicy](../planning/2026-10-02-Database-NativeLiteralKeyPolicy.md). 기준 HEAD `79ae574`.
- 상태: 담당 모델 정책·validator·targeted QA 및 PG65/MySQL37 실제 선언·PK/UNIQUE 검증 단위 **ready**. 소유 익명 volume 후속 승인으로 MySQL 실행까지 완료했다. 제품 전체 C6나 모든 literal parser의 완료를 의미하지 않는다.
- 담당 변경만 수행했다. model index/catalog/features/native-document/contracts/DDL compiler/UI/server sync, `docs/EZERD.txt`, 다른 agent 변경은 수정하지 않았다. git add/commit/full check는 main 담당이다.

## 모델 API와 연결 요청

`literalDecision(context, type, defaultValue, facts?)`는 `allowed`, `usable: false`, `coverage: false`, `code/category`, 허용한 제한 `format`을 반환한다. facts는 nullable/primary/strict/enumValues다. `none`과 nullable non-PK의 `null` 지원을 특수 literal parser 지원과 구분한다. 표현 AST는 `default.expression-validation-required`로 별도 검증을 요구하며 임의 타입 cast를 승인하지 않는다.

`inspectNativeLiteralToken(literal)`는 AST 공통 number/binary/JSON/boolean/문자 token 형식을 검사한다. AST의 `typedText`에는 타입 ID가 없으므로 `literal.target-type-required`로 거부한다. 리터럴을 포함하는 식의 구조/참조와 전체 식의 결과 타입·환경 검증은 별개다. 기존 구조/참조 검증은 유지했다.

`keyEligibility(context, type, facts?)`는 `primaryAllowed/uniqueAllowed`, `usable: false/coverage: false`, 이유·조건과 알려진 MySQL string/binary의 `estimatedBytes`를 반환한다. facts는 charset/generation이다. SQLite generated PK와 MySQL virtual generated PK는 금지하고 UNIQUE는 별도로 판정한다. PK/UNIQUE와 PG column btree index에서 validator가 같은 정책을 소비한다.

**main 연결 확인:** main이 model database/index에 위 3개 함수와 `NativeLiteralDecision/NativeLiteralFacts/NativeKeyEligibility/NativeKeyFacts`의 공개 export를 연결했다. QA script의 정책 helper import를 `@ezerd/model` public API로 전환하고 build/tools typecheck 및 실제 MySQL 실행으로 확인했다. UI/MCP는 engine allowed flags와 product usable를 구분해 소비한다. 이번 단위에 DDL compiler 수정은 필요하지 않았다. 공통 DDL fixture만 기존 방식대로 dist 내부 모듈에서 읽는다.

## 구현 정책과 정확한 한계

| 필드/종류 | 구현 | 남은 범위 |
| --- | --- | --- |
| 정수/unsigned/BOOLEAN alias | 문자열 정수 token·부호·8/16/24/32/64bit 폭 | SQL 문자열 평가 없음 |
| numeric/decimal | 지수 token·임의 정밀도 문자열 자리수·엔진 반올림 carry·PG 음수 scale/scale>precision·MySQL 기본(10,0) | NaN/Infinity special 입력 미지원 |
| real/double/float | finite 값, float32 범위, overflow/underflow 거부 | special NaN/Infinity 미지원 |
| string/binary/bit | literal kind, Unicode scalar/NUL, 문자 길이·hex 짝수 바이트·고정/가변 bit 폭·MySQL bit 정수 범위 | MySQL TEXT byte 길이는 utf8 기준 보수적 검사; charset별 표현 가능 문자는 별도 미구현 |
| JSON | JSON token 문법, jsonb/MySQL decoded Unicode/NUL·비유한 값 거부, PG json token 보존; 원문 숫자 token으로 jsonb numeric 자릿수·scale와 MySQL exponent underflow 검증 | 모든 DB의 JSON 자원 한도·정밀 숫자 저장 형식 parser 전체 완료 아님 |
| UUID | canonical 8-4-4-4-12 hex typedText | 엔진의 다른 UUID 입력 별칭 미지원 |
| date/time/timestamp | ISO 연월일·윤년·시분초·fraction precision, timezone 타입에 명시 offset, MySQL TIME 838h·YEAR 0/1901~2155 | BC/Infinity/24:00/상대 날짜/시간대 이름 입력 미지원; MySQL TIMESTAMP literal은 session zone/epoch 환경 미검증으로 차단 |
| interval | PG day + HH:MM:SS 제한 형식·day 폭·fraction precision | YEAR/MONTH와 DAY TO SECOND 외 fields literal은 명시 unsupported |
| PG geometry | 7종의 정형 숫자 입력, finite 좌표·line의 A/B·circle 반지름 검사 | 일반 엔진 입력 문법 전체, MySQL WKT/SRID literal 변환은 미지원 |
| network | IPv4/IPv6, prefix 32/128, CIDR host bits, canonical MAC 6/8 byte | IPv4 shorthand/IPv4-mapped IPv6/다른 MAC 표기 미지원 |
| range | int4/int8/date의 제한 unquoted bounds·empty·무한 bound·순서·정수 canonical overflow 검사; numrange unbounded/empty | finite numrange 정확 decimal bound 정렬과 timestamp bounds 미지원; timestamp range는 empty만 가능 |
| OID/LSN | unsigned 32bit typedText OID, 32bit/32bit hex LSN | reg*는 이름·숫자 모두 실제 존재 환경 미검증으로 차단 |
| XML/jsonpath/search/snapshot/multirange | none/null 분리 지원; 특수 literal은 명시 unsupported | 각 전용 parser 미구현 |
| money | locale 환경 미검증으로 특수 literal 차단 | locale-aware parser 미구현 |
| SQLite | 일반 affinity 보존, STRICT 저장 literal kind/정수 폭/finite float/typedText 금지 | 일반 affinity를 길이·precision 강제로 표시하지 않음 |
| MySQL 직접 key bytes | 알려진 charset bytes-per-character, string/binary 단일 및 복합 합계 3072 초과 차단 | 16KB page/default row format 전제; 복합 numeric/temporal/ENUM overhead 전체 계산·다른 page size·모든 charset 미검증 |
| PG direct keys | 기본 builtin btree 없는 12종 차단, JSONB/LSN/search/range/OID 등은 기본 키 허용 | 크기 의존 btree entry, 사용자 opclass, array element 연산자의 전체 실행 QA는 미완료 |
| AST defaults/check/index/generated | token 형식·typedText 타입 ID 부재 차단, 기존 구조/참조 유지, root literal default 타입 검사 | 전체 AST 결과 타입 inference와 식 내부 타입별 의미 검증은 별도 후속 단위 |

원본 legacy 보존 규칙은 변경하지 않았다. read/export는 진단하고 write는 trusted previous의 code/objectId/path/관련 원인 fingerprint가 같은 기존 오류만 유지한다. invalid 값 변경·복제·잘못된 환경/생성/타입 조건 변경은 신규 오류로 거부한다. SQL 문자열 실행이나 텍스트 타입 치환으로 정책을 보충하지 않았다. product export는 여전히 readiness false다.

## 검증 실행

- `pnpm --filter @ezerd/model build`: 통과. 이 build가 model source typecheck를 포함한다.
- `pnpm --filter @ezerd/server exec tsc -p tsconfig.tools.json --noEmit`: 통과.
- targeted Vitest 8개 파일 **568개 통과**: literals, key-policy, validation, ddl, editing, native-sync, migration, conversion. conversion은 다른 agent 파일을 읽기만 했다.
- 담당 TS 6개 파일만 루트 Prettier로 포맷했다. docs는 루트 prettierignore 대상으로 코드 포맷에서 제외한다. 최종 check 결과는 아래에 기록한다.
- 최종 담당 TS 6개 파일 Prettier check와 model source typecheck 모두 통과했다. 새 parser/정책/QA 수정 후 model build 및 QA tools typecheck, 같은 targeted 568개 테스트를 재확인했다.
- `pnpm --filter @ezerd/server exec tsx scripts/verify-native-literal-key.ts --postgresql --sqlite`: PASS.
- PG 설정 URL hostname은 localhost/127.0.0.1/[::1]만 수용하며 credential URL은 출력하지 않는다. 버전 **18.6 (Debian 18.6-1.pgdg13+2)**. UUID 전용 schema에서 BEGIN/SAVEPOINT 및 최종 ROLLBACK, ISO DateStyle/UTC/IntervalStyle 고정.
- SQLite **3.53.1**, node:sqlite `:memory:`. catalog 23개 기본/PK/UNIQUE 선언과 STRICT blob default 00FF 왕복·문자 오입력 거부 통과.
- PG 고급 literal **20종**을 pure compiler의 실제 default CREATE→DEFAULT INSERT→text SELECT로 왕복했다. 각 잘못된 값은 정책 거부·compiler SQL 공백과 parameterized INSERT 실제 엔진 거부를 확인했다: `postgresql:uuid`, `postgresql:date`, `postgresql:interval`, `postgresql:point`, `postgresql:line`, `postgresql:lseg`, `postgresql:box`, `postgresql:path`, `postgresql:polygon`, `postgresql:circle`, `postgresql:inet`, `postgresql:cidr`, `postgresql:macaddr`, `postgresql:macaddr8`, `postgresql:int4range`, `postgresql:int8range`, `postgresql:daterange`, `postgresql:oid`, `postgresql:pg_lsn`, `postgresql:bit`.
- PG65 선언 모두 성공. PK/UNIQUE 각각 53 허용·12 거부(42704), 모델 정책과 모두 일치했다.
- 추가 PG 실제 경계 QA 5개도 통과: numeric(3,2) 9.994→9.99 / 9.995 거부, numeric(2,-3) 99499→99000 / 99500 거부, numeric(2,4) 0.00994→0.0099 / 0.00995 거부, smallint 32767 / 32768 거부, jsonb 숫자 1e2→100 / 1e-20000 거부. 실패값은 모델 거부·compiler SQL 공백·parameterized INSERT DB 거부가 일치했다. 총 PG literal fixture 25개, SQLite STRICT blob 1개다.
- 후속 MySQL37/11literal 실행까지 PASS. 수정 후 public API model build, QA tools typecheck, 동일 targeted 568개 및 담당 TS Prettier check가 통과했다. main은 git add/commit/full check와 최종 QA 컨테이너·소유 익명 volume 정리를 담당한다.

## PostgreSQL65 실행 evidence

기본 선언은 순수 compiler+fixture 결과를 실행했다. 각 key probe는 같은 테이블의 ALTER ADD PRIMARY KEY/UNIQUE를 SAVEPOINT 뒤 실행하고 ROLLBACK TO SAVEPOINT하여 독립 비교했다. 표의 불가는 해당 타입의 기본 컬럼 선언 불가를 의미하지 않는다.

| 타입 ID | 기본 선언 | PRIMARY KEY | UNIQUE | 거부 SQLSTATE |
| --- | --- | --- | --- | --- |
| `postgresql:smallint` | 확인 | 허용 | 허용 | — |
| `postgresql:integer` | 확인 | 허용 | 허용 | — |
| `postgresql:bigint` | 확인 | 허용 | 허용 | — |
| `postgresql:numeric` | 확인 | 허용 | 허용 | — |
| `postgresql:real` | 확인 | 허용 | 허용 | — |
| `postgresql:double precision` | 확인 | 허용 | 허용 | — |
| `postgresql:char` | 확인 | 허용 | 허용 | — |
| `postgresql:varchar` | 확인 | 허용 | 허용 | — |
| `postgresql:text` | 확인 | 허용 | 허용 | — |
| `postgresql:bytea` | 확인 | 허용 | 허용 | — |
| `postgresql:boolean` | 확인 | 허용 | 허용 | — |
| `postgresql:date` | 확인 | 허용 | 허용 | — |
| `postgresql:time` | 확인 | 허용 | 허용 | — |
| `postgresql:timetz` | 확인 | 허용 | 허용 | — |
| `postgresql:timestamp` | 확인 | 허용 | 허용 | — |
| `postgresql:timestamptz` | 확인 | 허용 | 허용 | — |
| `postgresql:interval` | 확인 | 허용 | 허용 | — |
| `postgresql:uuid` | 확인 | 허용 | 허용 | — |
| `postgresql:json` | 확인 | 불가 | 불가 | 42704 |
| `postgresql:jsonb` | 확인 | 허용 | 허용 | — |
| `postgresql:jsonpath` | 확인 | 불가 | 불가 | 42704 |
| `postgresql:xml` | 확인 | 불가 | 불가 | 42704 |
| `postgresql:bit` | 확인 | 허용 | 허용 | — |
| `postgresql:bit varying` | 확인 | 허용 | 허용 | — |
| `postgresql:money` | 확인 | 허용 | 허용 | — |
| `postgresql:point` | 확인 | 불가 | 불가 | 42704 |
| `postgresql:line` | 확인 | 불가 | 불가 | 42704 |
| `postgresql:lseg` | 확인 | 불가 | 불가 | 42704 |
| `postgresql:box` | 확인 | 불가 | 불가 | 42704 |
| `postgresql:path` | 확인 | 불가 | 불가 | 42704 |
| `postgresql:polygon` | 확인 | 불가 | 불가 | 42704 |
| `postgresql:circle` | 확인 | 불가 | 불가 | 42704 |
| `postgresql:inet` | 확인 | 허용 | 허용 | — |
| `postgresql:cidr` | 확인 | 허용 | 허용 | — |
| `postgresql:macaddr` | 확인 | 허용 | 허용 | — |
| `postgresql:macaddr8` | 확인 | 허용 | 허용 | — |
| `postgresql:tsvector` | 확인 | 허용 | 허용 | — |
| `postgresql:tsquery` | 확인 | 허용 | 허용 | — |
| `postgresql:int4range` | 확인 | 허용 | 허용 | — |
| `postgresql:int8range` | 확인 | 허용 | 허용 | — |
| `postgresql:numrange` | 확인 | 허용 | 허용 | — |
| `postgresql:tsrange` | 확인 | 허용 | 허용 | — |
| `postgresql:tstzrange` | 확인 | 허용 | 허용 | — |
| `postgresql:daterange` | 확인 | 허용 | 허용 | — |
| `postgresql:int4multirange` | 확인 | 허용 | 허용 | — |
| `postgresql:int8multirange` | 확인 | 허용 | 허용 | — |
| `postgresql:nummultirange` | 확인 | 허용 | 허용 | — |
| `postgresql:tsmultirange` | 확인 | 허용 | 허용 | — |
| `postgresql:tstzmultirange` | 확인 | 허용 | 허용 | — |
| `postgresql:datemultirange` | 확인 | 허용 | 허용 | — |
| `postgresql:oid` | 확인 | 허용 | 허용 | — |
| `postgresql:regclass` | 확인 | 허용 | 허용 | — |
| `postgresql:regcollation` | 확인 | 허용 | 허용 | — |
| `postgresql:regconfig` | 확인 | 허용 | 허용 | — |
| `postgresql:regdictionary` | 확인 | 허용 | 허용 | — |
| `postgresql:regnamespace` | 확인 | 허용 | 허용 | — |
| `postgresql:regoper` | 확인 | 허용 | 허용 | — |
| `postgresql:regoperator` | 확인 | 허용 | 허용 | — |
| `postgresql:regproc` | 확인 | 허용 | 허용 | — |
| `postgresql:regprocedure` | 확인 | 허용 | 허용 | — |
| `postgresql:regrole` | 확인 | 허용 | 허용 | — |
| `postgresql:regtype` | 확인 | 허용 | 허용 | — |
| `postgresql:pg_lsn` | 확인 | 허용 | 허용 | — |
| `postgresql:pg_snapshot` | 확인 | 불가 | 불가 | 42704 |
| `postgresql:txid_snapshot` | 확인 | 불가 | 불가 | 42704 |

## MySQL37 실제 실행 evidence 및 소유 익명 volume 승인

초기 inspect의 volume 발견으로 실행을 보류했으나, 후속 사용자 지시에서 official MySQL Dockerfile VOLUME이 자동 생성한 **이 작업 소유 익명 volume만 사용 가능**함을 확인·승인했다. 새로운 컨테이너/volume을 만들거나 삭제하지 않았다.

최종 guard는 다음 정확한 조합만 허용한다.

- 컨테이너 이름 `ezerd-native-ddl-qa-20261002`, ID `032eb46e01d610cd0bfbad6127cff0ff47a3c3be648f0a67f3de101d3ecbc282`, running 상태.
- label `ezerd.qa=native-ddl-20261002`, image `mysql:8.4`, 공식 manifest version `8.4.11`.
- network `none`만 존재, HostConfig.PortBindings/NetworkSettings.Ports 빈 객체, user bind/VolumesFrom 없음.
- mount는 정확히 1개: Type `volume`, Name `b64d418edfbd16b0ba710dfb9d9c65b4034dbf59b3da1967756602d88cbfb1d1`, Destination `/var/lib/mysql`, Driver `local`, RW true. 다른 mount나 다른 익명 volume은 거부한다.
- docker exec 대상은 inspect 이후에도 **이 고정 containerID**로 제한한다. UUID 전용 `ezerd_literal_*` DB만 생성하고 finally DROP DATABASE로 정리한다.

`pnpm --filter @ezerd/server exec tsx scripts/verify-native-literal-key.ts --mysql37`을 **require_escalated, 위 containerID와 UUID QA DB 범위로 한정**해 실행했다. `--mysql`도 같은 검증의 호환 flag다. 실제 서버 버전 **8.4.11**, InnoDB page size **16384** 확인. strict SQL mode·UTC·utf8mb4 DB로 고정했다. compiler/fixture는 pure API를 사용하고 product export false를 매번 확인한다.

- 기본 선언 **37/37 성공**.
- PRIMARY KEY/UNIQUE 각각 **20 허용,17 거부**, 순수 모델 정책과 모든 결과 일치.
- TEXT/BLOB 8종은 ERROR1170(prefix 요구), JSON은 ERROR3152, geometry 8종은 ERROR3728로 직접 key 거부. 해당 컬럼의 기본 선언은 모두 성공했다.
- literal fixture **11개** 실제 default CREATE→INSERT→SELECT 왕복, 잘못된 값은 정책 거부·compiler SQL 공백·실제 DB INSERT 거부가 일치: `mysql:date`, `mysql:datetime`, `mysql:time`, `mysql:year`, `mysql:bigint-boundary`, `mysql:decimal-boundary`, `mysql:bit-boundary`, `mysql:varbinary-boundary`, `mysql:set-boundary`, `mysql:json-boundary`, `mysql:tinytext-boundary`.
- 시간 fixture: DATE 윤년, DATETIME, TIME 838:59:59, YEAR2155; 잘못된 날짜/TIME839h/YEAR2156 거부.
- 경계 fixture: BIGINT UNSIGNED 최대18446744073709551615와 +1 거부; DECIMAL(3,2)9.994→9.99 및9.995 overflow 거부; BIT(2)3/4; VARBINARY(2)00FF/3bytes; SET a,b/미등록 c; JSON UTF8 한글/깨진 JSON; TINYTEXT UTF8 255bytes/258bytes.
- 각 성공 key probe는 즉시 DROP PRIMARY KEY/INDEX k하여 다음 probe와 분리했다. 최종 run은 finally DROP DATABASE까지 성공했고 컨테이너와 소유 익명 volume은 main의 모든 후속 작업 뒤 `docker rm -fv` exact-container 정리 대상으로 남겼다.

| 타입 ID | 기본 선언 | PRIMARY KEY | UNIQUE | 거부 MySQL 오류 |
| --- | --- | --- | --- | --- |
| `mysql:tinyint` | 확인 | 허용 | 허용 | — |
| `mysql:smallint` | 확인 | 허용 | 허용 | — |
| `mysql:mediumint` | 확인 | 허용 | 허용 | — |
| `mysql:int` | 확인 | 허용 | 허용 | — |
| `mysql:bigint` | 확인 | 허용 | 허용 | — |
| `mysql:decimal` | 확인 | 허용 | 허용 | — |
| `mysql:float` | 확인 | 허용 | 허용 | — |
| `mysql:double` | 확인 | 허용 | 허용 | — |
| `mysql:bit` | 확인 | 허용 | 허용 | — |
| `mysql:date` | 확인 | 허용 | 허용 | — |
| `mysql:datetime` | 확인 | 허용 | 허용 | — |
| `mysql:timestamp` | 확인 | 허용 | 허용 | — |
| `mysql:time` | 확인 | 허용 | 허용 | — |
| `mysql:year` | 확인 | 허용 | 허용 | — |
| `mysql:char` | 확인 | 허용 | 허용 | — |
| `mysql:varchar` | 확인 | 허용 | 허용 | — |
| `mysql:binary` | 확인 | 허용 | 허용 | — |
| `mysql:varbinary` | 확인 | 허용 | 허용 | — |
| `mysql:tinytext` | 확인 | 불가 | 불가 | ERROR 1170 |
| `mysql:text` | 확인 | 불가 | 불가 | ERROR 1170 |
| `mysql:mediumtext` | 확인 | 불가 | 불가 | ERROR 1170 |
| `mysql:longtext` | 확인 | 불가 | 불가 | ERROR 1170 |
| `mysql:tinyblob` | 확인 | 불가 | 불가 | ERROR 1170 |
| `mysql:blob` | 확인 | 불가 | 불가 | ERROR 1170 |
| `mysql:mediumblob` | 확인 | 불가 | 불가 | ERROR 1170 |
| `mysql:longblob` | 확인 | 불가 | 불가 | ERROR 1170 |
| `mysql:enum` | 확인 | 허용 | 허용 | — |
| `mysql:set` | 확인 | 허용 | 허용 | — |
| `mysql:json` | 확인 | 불가 | 불가 | ERROR 3152 |
| `mysql:geometry` | 확인 | 불가 | 불가 | ERROR 3728 |
| `mysql:point` | 확인 | 불가 | 불가 | ERROR 3728 |
| `mysql:linestring` | 확인 | 불가 | 불가 | ERROR 3728 |
| `mysql:polygon` | 확인 | 불가 | 불가 | ERROR 3728 |
| `mysql:multipoint` | 확인 | 불가 | 불가 | ERROR 3728 |
| `mysql:multilinestring` | 확인 | 불가 | 불가 | ERROR 3728 |
| `mysql:multipolygon` | 확인 | 불가 | 불가 | ERROR 3728 |
| `mysql:geometrycollection` | 확인 | 불가 | 불가 | ERROR 3728 |

## 참고 근거

- PG default opclass/연산자 조건: [Index interfaces](https://www.postgresql.org/docs/18/xindex.html), [Btree](https://www.postgresql.org/docs/18/btree.html). 실제 기본 constraint 허용 판정은 위 PostgreSQL18.6 실행 결과를 기준으로 했다.
- 고급 타입 입력: [Geometry](https://www.postgresql.org/docs/18/datatype-geometric.html), [OID](https://www.postgresql.org/docs/18/datatype-oid.html), [Range](https://www.postgresql.org/docs/18/rangetypes.html), [Date/time](https://www.postgresql.org/docs/18/datatype-datetime.html).
- MySQL 기본값과 직접 key 조건: [Data type defaults](https://dev.mysql.com/doc/refman/8.4/en/data-type-defaults.html), [CREATE TABLE](https://dev.mysql.com/doc/refman/8.4/en/create-table.html). 위 실제 MySQL8.4.11 실행 결과를 evidence로 기록하며 제품 usable/coverage는 false를 유지한다.

