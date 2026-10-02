# MySQL physical 제약 정책 구현·실행 evidence

기준 `9657dd8`, 2026-10-02. [계획](../planning/2026-10-02-Database-MySQLPhysicalConstraints.md)에 따른 독립 단위다. 신규 mysql-physical-policy.ts/tests 및 QA script, literals.ts/tests의 charset facts만 구현했다. validation/index/compiler/UI/queue 및 docs/EZERD.txt는 수정하지 않는다. git add/commit/full check는 main 담당이다.

## 모델 API와 main 연결

- `inspectMysqlPhysicalDocument(document, environment?)` → `{ engineSupported, usable:false, coverage:false, issues, budgets }`. 각 issue는 `code/objectId/path/cause/category/params/severity`다. `cause`는 fingerprint 전 원본이며 기존 collect의 add에 전달한다. caller가 read/write/export의 previous-cause 보존·availability 검사를 그대로 적용한다. 별도 export gate 승격을 하지 않는다.
- `effectiveMysqlCharacters(tableOptions, columnOptions?)` → 알려진 effective `charset/collation/maxBytesPerCharacter` 또는 명시 invalid/environment. CHARSET만 있으면 그 charset의 default collation, COLLATE만 있으면 해당 charset, 둘 다 없으면 table pair를 상속한다. 둘이 충돌하면 invalid. 모두 생략된 table은 profile의 utf8mb4/utf8mb4_0900_ai_ci 가정이다. 실제 실행 DB의 기본값이 다른 경우 반드시 명시 옵션/metadata를 연결해야 한다.
- main 요청의 중앙 API `mysqlEffectiveColumnTextOptions(table, column?)`는 모델 객체 또는 physical options 객체를 받는다. 성공 결과는 `{engineSupported:true,usable:false,coverage:false,charset,collation,collationKnown:true,byteWidth}`이고 실패 결과는 `{engineSupported:false,usable:false,coverage:false,collationKnown:false,code,category}`다. `MysqlEffectiveColumnTextOptions`는 discriminated union이다. 기존 effectiveMysqlCharacters와 같은 단일 해석 함수를 사용한다. `mysqlCharacterPresets`에는 검증한5개 charset의 defaultCollation/maxBytes/collations가 있다.
- `mysqlStringMetrics(value, charset?)` → code point 수, 실제 encodedBytes, declaration lengthUnits. binary textual input은 UTF8 bytes로 길이를 센다. NUL/unpaired surrogate는 거부한다. 미검증 charset은 environment로 반환한다.
- `mysqlDeclaredColumnBytes(column, characterDecision)` 및 `mysqlDecimalStorageBytes(precision?,scale?)` → SQL layer 선언 budget 공식. exact는 실제 InnoDB 저장 bytes가 아니다.
- `NativeLiteralFacts.charset?:string`를 추가했다. MySQL CHAR/VARCHAR/TEXT/ENUM/SET string default는 effective charset을 전달한 `literalDecision(...,{charset})`를 사용한다. TEXT는 encoded bytes 한도, CHAR/VARCHAR는 charset에 맞는 선언 길이 단위를 사용한다. none/null과 특수 literal 지원 구분은 기존대로 유지한다. PostgreSQL/SQLite literal 로직은 보존한다.

main collect 연결 예:

```ts
if (doc.database.kind === 'mysql') {
  const physical = inspectMysqlPhysicalDocument(doc);
  for (const i of physical.issues)
    add(i.code, i.objectId, i.path, i.cause, i.category, i.params, i.severity);
}
const chars = mysqlEffectiveColumnTextOptions(table, column);
// chars.engineSupported === false이면 해당 character issue로 차단한다.
// 성공한 MySQL 문맥에서 literal/expression terminal/type-key facts에 전달한다.
literalDecision(context, type, defaultValue, { ...existingFacts, charset: chars.charset });
```

public index export와 default/expression terminal의 facts 연결은 main 담당이다. 이미 있는 keyEligibility charset facts에도 같은 effective 해석 결과를 사용해야 collation-only/charset-only 상속이 일치한다. validation.ts의 단순 `column.charset ?? table.charset` 조합만으로 COLLATE-only를 해석하면 latin1_bin을 UTF8MB4로 계산하는 차이가 생긴다.

DDL도 중앙 결과의 charset/collation을 명시하면 실행 DB charset 및 utf8mb4 default-collation 설정 변화에 독립적으로 preset을 고정할 수 있다. table COLLATE-only가 latin1_bin/ascii_bin 등일 때 UTF8MB4를 무조건 추가하면 충돌하므로 table의 중앙 해석 결과를 먼저 사용한다. column CHARSET-only는 table collation을 추가하면 안 된다. binary charset의 CHAR/VARCHAR/TEXT는 BINARY/VARBINARY/BLOB으로 바뀌어 metadata charset/collation은 NULL이며 helper의 binary/binary는 그 byte 비교 문맥을 나타낸다. `collationKnown:true`는 검증된 preset 의미이며 원격 환경 조회 완료 의미가 아니다.

기존 invalid row의 cause는 comment/name/onUpdate 변경과 컬럼 배열 재정렬에 의존하지 않는다. 실제 type/nullable/primary/generated storage/character context의 변경은 cause에 반영한다. helper는 AST 구조/참조 검증을 대체하지 않는다.

## 실제 서버와 격리 조건

공식 MySQL8.4.11, x86_64, innodb_page_size=16384, innodb_default_row_format=dynamic, innodb_strict_mode=1, lower_case_table_names=0, server charset=utf8mb4, collation=utf8mb4_0900_ai_ci였다. 기본 sql_mode는 ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION. fixture session은 STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES 및 SET NAMES utf8mb4다. compiled DDL이 제공하는 strict mode도 유지한다.

스크립트는 container ID `032eb46e01d610cd0bfbad6127cff0ff47a3c3be648f0a67f3de101d3ecbc282`, label `ezerd.qa=native-ddl-20261002`, running, NetworkMode/Networks=none, 포트/bind/VolumesFrom 없음, official image version8.4.11을 실행 전 inspect 검증한다. mount는 정확히 하나인 작업 소유 익명 volume `b64d418edfbd16b0ba710dfb9d9c65b4034dbf59b3da1967756602d88cbfb1d1`→/var/lib/mysql(local,RW)만 허용한다. 다른 volume/mount/network/port는 거부한다. require_escalated exec는 이 전용 컨테이너와 UUID 임시 `ezerd_constraints_…` DB의 CREATE/DDL/INSERT/SELECT/finally DROP에만 사용했다. 사용자 DB와 다른 컨테이너/volume은 변경하지 않는다. 최종 container/volume 정리는 main 담당이다.

재실행: `pnpm --filter @ezerd/model build` 이후 `pnpm --filter @ezerd/server exec tsx scripts/verify-native-mysql-constraints.ts`. 표준 출력 JSON의 evidence/charsetEvidence에 전체 fixture 결과와 metadata를 출력한다. `--charset-only`는 charset 부분 재현용이며 전체 검증은 인자 없이 실행한다.

## Charset와 문자 보존 evidence

installed charset max bytes는 ascii=1,binary=1,latin1=1,utf8mb3=3,utf8mb4=4다. 검증 범위의 collation은 다음 10개다.

| charset | collation | padding |
| --- | --- | --- |
| ascii | ascii_general_ci, ascii_bin | PAD SPACE |
| binary | binary | NO PAD |
| latin1 | latin1_swedish_ci, latin1_bin | PAD SPACE |
| utf8mb3 | utf8mb3_general_ci, utf8mb3_bin | PAD SPACE |
| utf8mb4 | utf8mb4_bin | PAD SPACE |
| utf8mb4 | utf8mb4_0900_ai_ci, utf8mb4_0900_bin | NO PAD |

4개 CI collation 각각에서 printable ASCII 95문자의 WEIGHT_STRING을 조회했다. 동등 클래스는 각69개이며 ASCII 대소문자 folding과 일치했다. 비ASCII/제어문자 다중 label의 CI 동등성은 JavaScript lower-case로 추정하지 않고 `mysql.value-list-collation-unverified`로 차단한다. `_bin`에서는 case/Unicode를 구분한다.

| 실제 fixture | 엔진 관측 | 정책 |
| --- | --- | --- |
| VARCHAR ascii default é | CREATE ERROR1067 | charset-value-invalid |
| VARCHAR utf8mb3 default 😀 | CREATE ERROR1067 | charset-value-invalid |
| VARCHAR utf8mb4 default 😀 | INSERT/SELECT HEX=F09F9880, 4bytes/1character | 허용 |
| VARCHAR latin1 é, € | HEX=E9,80, 각1byte | 허용 |
| VARCHAR latin1 한, U0080 | CREATE ERROR1067 | 거부 |
| binary VARCHAR(1)/(2) default é | (1) ERROR1067, (2) HEX=C3A9 | byte 길이1 거부/2 허용 |
| utf8mb4 CHAR(1) default 😀 | INSERT/SELECT 4bytes/1character | 허용 |
| utf8mb4 CHAR(255) default é×255/256 | 255는510bytes 보존,256은 ERROR1067 | 문자 길이 기준 |
| binary CHAR(1)/(2) default é | (1) ERROR1067,(2)2bytes 보존, metadata BINARY | byte 기준/alias 경고 |
| latin1 TINYTEXT default é×255/256 | 둘 다 CREATE 가능;255 INSERT 성공,256 INSERT ERROR1406 | encoded byte 기준255 허용/256 거부 |
| utf8mb4 TINYTEXT default 한×85/86 | CREATE 가능;255bytes 성공,258bytes INSERT ERROR1406 | encoded byte 기준 |
| utf8mb3 TINYTEXT default 😀 | CREATE 가능, INSERT ERROR1366 | 표현 불가 거부 |
| utf8mb4 ENUM/SET 한×255/256 | 255chars/765bytes 보존;256 CREATE 거부 | label 길이255 |
| utf8mb4 ENUM/SET 😀×255 | 255chars/1020bytes 보존 | 허용 |
| binary ENUM/SET ASCII×255/é×128 | 255bytes 보존;256bytes 거부 | byte 길이 기준 |
| utf8mb3 ENUM/SET 😀, ascii ENUM/SET é | CREATE/INSERT 수락하나 SELECT HEX=3F | value-list-unrepresentable 차단 |
| CI ENUM/SET a,A 또는 e,é | strict CREATE 중복 거부 | ASCII duplicate 또는 비ASCII CI unsupported |
| utf8mb4_bin ENUM/SET a,A 또는 e,é | 별도 label 보존 | 허용 |
| ENUM/SET label `a ` | CREATE 수락, stored HEX=61 | trailing-space unsupported |

latin1은 Windows cp1252다. 1..255의 모든 비NUL byte를 대응 Unicode로 만든 뒤 utf8mb4→latin1 CONVERT/HEX 결과가 `01..FF`와 완전히 일치함을 실제 서버에서 검증했다. 따라서 ASCII1..127,A0..FF 및 cp1252의80..9F 대응32개 code point를 지원한다. 이32개는 €/U0081/‚/ƒ/„/…/†/‡/ˆ/‰/Š/‹/Œ/U008D/Ž/U008F/U0090/‘/’/“/”/•/–/—/˜/™/š/›/œ/U009D/ž/Ÿ다. U0080 및 임의 다른 Unicode는 거부한다. NUL은 MySQL 변환 가능 여부와 별개로 기존 native literal 정책에서 거부한다.

## 선언 byte budget과 경계 evidence

SQL layer 최대65535bytes는 max encoded declaration+VARCHAR/VARBINARY length prefix+logical nullable bitmap의 합으로 계산한다. nullable bitmap은 PK의 암묵 NOT NULL을 반영한 선언 컬럼 수의 ceil(n/8)이며 VIRTUAL도 포함한다. 이는 물리 저장 bitmap 추정이 아니다. BIT의 SQL 선언 budget은 각 컬럼 ceil(bits/8)이며 여러 BIT 컬럼을 하나의 bitmap처럼 합치지 않는다.

| SQL layer 공식/타입 | 검증 값 |
| --- | --- |
| tinyint/smallint/mediumint/int/bigint | 1/2/3/4/8 |
| float/double/date/year | 4/8/3/1 |
| decimal(p,s) | 정수·소수 부분 각각9digits→4bytes, remainder0..8→0,1,1,2,2,3,3,4,4 |
| time/datetime/timestamp | base3/5/4 + ceil(fsp/2), fsp0..6 |
| bit(n) | ceil(n/8) |
| CHAR/BINARY | 선언 길이×charset max width / binary byte 길이 |
| VARCHAR/VARBINARY | 위 최대bytes + prefix(<=255이면1,그외2) |
| ENUM | label count<=255이면1,그외2 |
| SET | count<=32이면 ceil(count/8),33..64이면8 |
| TINYTEXT/TINYBLOB | SQL reference budget9 |
| TEXT/BLOB | SQL reference budget10 |
| MEDIUMTEXT/MEDIUMBLOB | SQL reference budget11 |
| LONGTEXT/LONGBLOB/JSON/모든8 spatial타입 | SQL reference budget12 |

위 reference 값은 x86_64 서버에서 SQL row 선언 거부 경계를 실측한 값이다. payload 실제 size나 InnoDB overflow pointer/inline prefix 계산으로 일반화하지 않는다.

기본 MySQL catalog의37타입 모두에 대해 column을 추가하고 latin1 NOT NULL VARCHAR padding을 맞춰 총65535bytes에서는 순수 `compileNativeDatabaseDDL` CREATE 성공, padding1byte 확대한 총65536bytes에서는 controlled ALTER 거부와 정책 거부를 확인한다. invalid fixture는 arbitrary SQL 입력/컴파일 SQL 텍스트 치환이 아니다.

추가 parameter/charset 조합49개: decimal(1,0),(9,0),(10,2),(65,30); time/datetime/timestamp fsp1..6(18개); bit7/8/9/63/64; ENUM255/256; SET8/9/24/32/33/64; CHAR/VARCHAR 각각 utf8mb4 길이63/64/255,utf8mb3 길이85/86,ascii255,binary255(14개). 총86개 조합의172개 성공/거부 경계다.

| raw 선언 fixture | 실제 결과 |
| --- | --- |
| utf8mb4 VARCHAR16383/16384/65535 | 16383 성공,나머지 ERROR1074 |
| latin1 NOT NULL VARCHAR65532/65533/65534/65535 | 앞2개 성공,뒤2개 ERROR1118 |
| latin1 NULL VARCHAR65531/65532/65533 | 앞2개 성공,65533 ERROR1118 |
| latin1 VARCHAR32765+32766 NOT NULL / NULL | NOT NULL 총65535 성공,NULL bitmap으로 ERROR1118 |
| latin1 CHAR255 ×31/32/33 | 31개 성공,32/33 ERROR1118(>8126),SQL65535와 별도 InnoDB record 한도 |
| latin1 VARCHAR65532 + BIT1 ×1/8/9 | 1개만 성공,8/9는 ERROR1118 |
| reference10타입 + padding65520/65521/65522 | 위9/10/11/12bytes SQL reference budget과 일치 |

fixedInlineMin은 검증된 단일byte CHAR/BINARY와 fixed scalar의 하한만 사용한다. profile record limit8126을 이미 넘으면 invalid,7900초과 근처는 정확한 layout을 추정하지 않고 경고한다. 다중byte CHAR/variable/off-page/hidden MVCC/header 등을 합쳐 임의 InnoDB row의 정확한 사용bytes를 주장하지 않는다.

## COMMENT Unicode evidence

column1024/table2048은 UTF8 bytes가 아니라 code point 한도다. ASCII/한/😀 각각1024,1025,2048,2049를 실제 CREATE와 metadata의 CHAR_LENGTH/OCTET_LENGTH/첫 문자 HEX로 확인했다(24 fixtures).

| 값 | 컬럼/테이블 한도 내 실제 metadata | 한도 초과 |
| --- | --- | --- |
| ASCII×1024/2048 | 1024/2048chars,1024/2048bytes,HEX78 | CREATE 거부 |
| 한×1024/2048 | 1024/2048chars,3072/6144bytes,HEXED959C | CREATE 거부 |
| 😀×1024/2048 | CREATE 성공하나 ?×1024/2048로 저장,HEX3F | CREATE 거부 |

supplementary/unpaired/NUL comment는 `mysql.comment-unrepresentable` unsupported로 보존 실패를 차단한다. table/column charset을 바꿔도 COMMENT가 해당 열 charset의 payload처럼 저장된다고 가정하지 않는다.

## 명시적으로 남긴 한계

- VIRTUAL은 아래 후속 실행으로 generic blocker를 제거했다. 알려진 선언 타입은 min=0,max=검증한 선언 byte의 보수적 상한,exact=false,fixedInlineMin=0이며 SQL logical-row nullable bitmap에 포함한다. legacy/unresolved 타입만 max=null 및 column-byte-budget-unverified다. STORED는 선언 타입 크기만 계산하며 AST/참조/함수 legality는 별도 validator다.
- 알려진5charset/10collation 이외는 environment로 차단한다. installed 목록을 전달하면 누락 항목도 차단한다. 목록 없이 설치 상태를 검증했다고 주장하지 않는다.
- pageSize16384/DYNAMIC 이외는 environment-unverified, x86_64 이외는 reference-layout-unverified다. 미제공 환경은 profile-assumed warning이고 lower_case_table_names!=0은 identifier-case-environment warning이다. 다른 SQL mode/DB 기본charset 조합은 이 profile의 실행 증거가 아니다.
- 모든 InnoDB inline row/header/모든 column 조합/모든charset collation algorithm/모든 ENUM65535 boundary/모든 TEXT4GiB literal를 검증했다는 주장을 하지 않는다. 큰 TEXT는 packet/memory 조건도 필요하며 여기서는 선언 byte/charset 길이와 대표 default 경계만 검증했다.
- unknown charset을 literal facts에서 UTF8MB4로 대체하지 않는다. effective 해석 실패는 blocker를 유지한다. 입력 typedText에 임의 cast/typeID를 부여하지 않는다.
- helper의 engineSupported는 이 정책이 확인한 제약 결과다. 실제 DB 전체 기능 지원, 제품 end-to-end usable/coverage는 계속 false다.

## 검증 결과

- 실제 전체 QA: PASS, exit0, row/comment/budget244건(수락132/거부112) + charset59건 =303건. 37개 기본 타입 및49개 추가조합의172개 경계 중86개65535 CREATE 성공,86개65536 ALTER 거부 모두 ERROR1118이다. profile/type/nullable/charset 계산과 실제 엔진 경계가 일치했다. 마지막의 UUID 임시 DB DROP까지 exit0이다.
- 중앙 API 추가 이후 charset QA: `--charset-only` PASS, exit0,62건. 기존59건과 새3개 preset(utf8mb3,latin1,binary)의 CHARSET-only metadata를 확인했다. 따라서 확인한 서로 다른 fixture는306건이다. binary VARBINARY metadata가 NULL/NULL인 것까지 확인했다. 중앙 API는 같은 resolver를 사용하는 wrapper이며 row 계산식은 이 후속 변경에서 바꾸지 않았다.
- targeted: 중앙 API 단계5파일562 tests passed. VIRTUAL/hidden-column 후속 단계는 같은5파일576 tests passed(물리 정책58 tests 포함). 계획된 중앙 API5preset/inheritance/unknown/충돌, unsupported CI Unicode/byte-aware default, stable previous-cause 및 VIRTUAL upper-bound/count 등을 포함한다.
- `pnpm --filter @ezerd/model build`와 `pnpm exec tsc -p apps/server/tsconfig.tools.json --noEmit` 통과.
- 담당5개 TypeScript 파일의 root Prettier check 통과. docs는 root .prettierignore의 docs/**/*.md 규칙으로 포맷 대상에서 제외했다. scope 내 tracked literal diff의 whitespace check 통과. 전체 git staging/commit/full check는 수행하지 않았다.

실제37개 catalog baseline: tinyint/smallint/mediumint/int/bigint/decimal/float/double/bit/date/datetime/timestamp/time/year/char/varchar/binary/varbinary/tinytext/text/mediumtext/longtext/tinyblob/blob/mediumblob/longblob/enum/set/json/geometry/point/linestring/polygon/multipoint/multilinestring/multipolygon/geometrycollection. 각 항목에 성공/ERROR1118 경계를 각각 실행했다. script의 evidence 이름은 `mysql:<type>-byte-boundary-0|1`다.

실행 summary:

```json
{
  "mysqlVersion": "8.4.11",
  "fullResult": "PASS",
  "fullRowCases": 244,
  "fullCharsetCases": 59,
  "declaredByteBoundaryCases": 172,
  "declaredByteBoundaryRejectionCodes": ["ERROR 1118"],
  "centralApiCharsetResult": "PASS",
  "centralApiCharsetCases": 62,
  "generatedFollowUpCases": 26,
  "distinctCases": 332,
  "targetedTestsPassed": 576,
  "productUsable": false,
  "productCoverage": false
}
```

## VIRTUAL·functional hidden-column 후속 검증 및 확정 정책

main의 C7 기본 VIRTUAL 지원 요청에 따라 기존 blanket unsupported를 제거했다. `--generated-only` 실제 MySQL8.4.11 QA26건이 PASS/exit0이며 small typed VIRTUAL은 순수 compileNativeDatabaseDDL CREATE와 INSERT/SELECT HEX roundtrip까지 확인했다. 새 public API의 이름·기존 반환 필드·usable/coverage false는 유지한다. MysqlTableBudget에는 declaredColumns/virtualColumns/functionalHiddenColumns/totalColumns/functionalHiddenMaxBytes를 추가했다.

| 실행 fixture | 실제 CREATE/roundtrip |
| --- | --- |
| latin1 stored64+VIRTUAL64, utf8mb4 stored64+VIRTUAL64 | CREATE 성공, generated HEX78, typed compiled DDL도 성공 |
| latin1 stored40000+VIRTUAL40000 | ERROR1118 |
| latin1 VIRTUAL VARCHAR65533 NOT NULL /65534 | 앞 성공,뒤 ERROR1118 |
| latin1 VIRTUAL VARCHAR65532 NULL /65533 | 앞 성공,뒤 ERROR1118(virtual nullable SQL bitmap 포함) |
| latin1 stored32765+VIRTUAL32766 /stored32766+VIRTUAL32766 | 앞 성공,뒤 ERROR1118 |
| latin1 VIRTUAL32765+VIRTUAL32766 /VIRTUAL32766+VIRTUAL32766 | 앞 성공,뒤 ERROR1118 |
| utf8mb4 VIRTUAL VARCHAR16384 | ERROR1074: 단일 선언 한도는 VIRTUAL도 적용 |
| utf8mb4 stored12000+VIRTUAL12000 | ERROR1118 |
| stored INT +VIRTUAL CHAR255×33 | CREATE/INSERT 성공,HEX78; virtual은 stored fixed-row 크기를 소비하지 않음 |
| TINYINT 일반1017/1018 | 1017 성공,1018 ERROR1117 |
| TINYINT 일반1+VIRTUAL1016/1017 | 총1017 성공,총1018 ERROR1117 |
| 일반1016/1017+functional part1 | 총1017 성공,총1018 ERROR1117 |
| 일반1015/1016+functional parts2 | 총1017 성공,총1018 ERROR1117 |
| utf8mb4 VARCHAR768/769 full-length key | 3072bytes 성공,3076bytes ERROR1071 |
| latin1 VARCHAR62457 + INDEX(LENGTH(v)) | CREATE 성공,정책의 보수적 upper budget도65535이하 |
| latin1 VARCHAR65533 + INDEX(LENGTH(v)) | ERROR1118: 숨김 컬럼도 logical-row 제한을 소비 |

VIRTUAL의 declared upper bound가65535를 넘으면 `mysql.row-byte-upper-bound-exceeded` unsupported로 차단한다. 정확한 일반 column minimum만으로 넘으면 기존 row-byte-limit-exceeded invalid다. 모든 VIRTUAL의 물리 layout을 exact라고 주장하지 않으며 small legal virtual을 존재만으로 차단하지 않는다. 검사된 선언의 max가 null이 아닌 한 상한 내 문서는 이 물리 정책에서 허용한다. AST/generation legality는 main validator가 별도로 판단한다.

모든 실제 생성 대상 column(VIRTUAL 포함)과 각 non-column MySQL index part의 hidden column을 합해1017을 넘으면 `mysql.column-count-exceeded` invalid다. logical scope는 제외한다. hidden 결과 타입을 임의 cast로 믿지 않는다. 16KiB profile의 **합법적인 full-length functional btree part**는3072-byte InnoDB key 한도를 만족해야 하므로 각 hidden column의 SQL 선언 budget을 최대3074bytes(최대 key payload3072+prefix2) 및 nullable1bit로 보수적으로 예약한다. 물리 stored row에는 더하지 않는다. 이 상한 때문에 실제로 더 작은 numeric 결과도 큰 near-limit row에서는 unsupported가 될 수 있으며 미검증 조합의 안전한 차단이다. 실제 index expression의 결과 타입·허용함수·fulltext/spatial 제한·key width 자체는 main index validator의 별도 검사이며 이 계산이 index 기능을 승격하지 않는다.

QA 중 넓은 LOWER/CAST 결과는 BLOB/TEXT로 추론되어 ERROR3757로 거부될 수 있는 것을 관측했다. 이를 성공한 functional datatype로 승격하지 않았으며, 최종 key-width 상한 evidence는 일반 full-length key3072 경계와 공식 InnoDB 제한을 사용한다. 제품 NativeExpression에 CAST 지원을 추가하지 않았다. 전문 QA의 임시 DB는 실패 run에서도 finally DROP했고 최종26건 PASS run도 DROP까지 exit0이다.

후속 공식 근거: [Generated columns](https://dev.mysql.com/doc/refman/8.4/en/create-table-generated-columns.html), [Functional hidden columns](https://dev.mysql.com/doc/refman/8.4/en/create-index.html), [InnoDB limits](https://dev.mysql.com/doc/refman/8.4/en/innodb-limits.html). 이 후속 결과가 이전 VIRTUAL unknown 정책을 대체한다. staging/commit은 main 담당으로 남겼다.

## 공식 근거

## main 통합 검증

- 공통 validator에 원인 fingerprint를 보존하여 행·선언·환경·문자셋 오류/경고를 연결했다. literal/default, PK/UNIQUE bytes, FK(ENUM 포함), FULLTEXT charset/collation과 복합 btree prefix bytes도 같은 effective character 정책을 소비한다. 함수 인덱스의 미검증 복합 길이는 보수적으로 차단한다.
- DDL은 table의 effective charset/collation을 모두 명시하고 column 명시 CHARSET/COLLATE도 독립적인 effective pair로 출력한다. 실제8.4.11에서 latin1_bin/ascii_bin/utf8mb4_bin table과 charset-only utf8mb4 column의 metadata 및 emoji default/row HEX를 확인했다. 기존37개 타입·advanced FULLTEXT/SPATIAL/functional fixture도 통과했다. Unicode ENUM/SET fixture는 명시 utf8mb4_bin을 사용하여 미검증 CI 비교를 우회하지 않는다.
- 최종 model/literal/key/validation/DDL5파일578개, shared build 및 server/runtime/tools typecheck 통과. 신규 policy는 public model export로 연결했다. 제품 usable/coverage 활성화와 브라우저/전체 QA는 후속이다.

[Row limits](https://dev.mysql.com/doc/refman/8.4/en/column-count-limit.html), [Storage requirements](https://dev.mysql.com/doc/refman/8.4/en/storage-requirements.html), [CREATE TABLE COMMENT](https://dev.mysql.com/doc/refman/8.4/en/create-table.html), [Table charset](https://dev.mysql.com/doc/refman/8.4/en/charset-table.html), [Column charset](https://dev.mysql.com/doc/refman/8.4/en/charset-column.html), [String syntax](https://dev.mysql.com/doc/refman/8.4/en/string-type-syntax.html), [latin1/cp1252](https://dev.mysql.com/doc/refman/8.4/en/charset-we-sets.html), [binary charset](https://dev.mysql.com/doc/refman/8.4/en/charset-binary-set.html), [ENUM](https://dev.mysql.com/doc/refman/8.4/en/enum.html), [SET](https://dev.mysql.com/doc/refman/8.4/en/set.html). 표의 수치·손실·거부 결과는 문서의 일반식과 구분한 이 컨테이너 실행 관측이다.
