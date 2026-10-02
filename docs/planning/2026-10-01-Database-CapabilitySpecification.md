# 프로젝트 DB별 타입·기능 구현 명세

## 작업 범위

- 요청: 기존 [기능 집합 설계](2026-10-01-Database-CapabilityDesign.md)를 실제 구현 가능한 명세로 구체화한다.
- 산출물: 지원 프로필, 타입·기능 명세, 데이터 모델, 검증/동기화 계약, UI 흐름, 기존 데이터 처리, DB 변경 절차, 구현 단계와 완료 기준.
- 이번 작업에서는 제품 코드를 변경하지 않는다. `docs/EZERD.txt`는 수정하지 않는다.
- 조사 대상은 현재 모델·계약·서버·MCP·편집기 코드 및 PostgreSQL/MySQL/SQLite 공식 자료다.
- 타입·기능 지원표: [DB별 지원 명세](2026-10-01-Database-TypeFeatureMatrix.md).
- 결과 기록: `docs/work-log/2026-10-01-Database-CapabilitySpecification.md`.
- 후속 사용자 지시: `Worker 1 - Sol` 채팅(`01a0f2c6-98c0-7492-8259-2ff01242370b`, local)의 진행 중 작업이 최종 완료되면 이 계획을 바탕으로 제품 구현을 진행한다. 완료 확인 전에는 제품 코드를 변경하지 않는다.

## 1. 설계 결정

이 문서는 이번 요청에 따라 선택한 구현 기준안이다. 미확정 결정을 반복하는 대신 기본 동작을 정한다. 사용자 요청은 설계 구체화이므로 아래 API·모델·DB 마이그레이션은 아직 구현되지 않았다.

| 결정 | 명세 |
| --- | --- |
| 설계 기준 | 프로젝트가 선택한 DB의 native 타입·기능을 사용한다. 다른 DB 타입으로 export 단계에서 자동 치환하지 않는다 |
| 전체 정의 | 지원 DB별 컬럼용 기본 타입 및 ERD 기능의 합집합을 `packages/model`에서 관리한다 |
| 활성 집합 | 선택 DB/프로필 + 테이블 모드 + 객체 조건 + 구현/실행 검증 완료 상태로 계산한다 |
| 지원 프로필 | `postgresql-18-v1`, `mysql-8.4-innodb-v1`, `sqlite-3.45-v1`; SQLite STRICT는 테이블 옵션 |
| 데이터 형식 | 문서 `schemaVersion: 2`, JSON 전송 `formatVersion: 2`; v1 읽기·가져오기 어댑터 유지 |
| 타입 저장 | DB를 포함한 타입 ID, DB별 구조화된 파라미터. 표시명/별칭은 저장 ID와 분리 |
| 생성 옵션 | serial/identity/AUTO_INCREMENT/AUTOINCREMENT/generated를 타입 문자열·기본값에서 분리 |
| 검증 | 구조, DB 적합성, 편집 중 미완성, DDL 실행 가능성을 구분 |
| DB 변경 | 빈 물리 설계는 바로 변경; 기존 설계는 진단 후 검증된 변환 계획만 원자 적용. 첫 출시는 비어 있지 않은 설계의 DB 변경 적용을 차단하고 진단 제공 |
| 기존 비호환 문서 | 원본을 유지하며 열기·안전한 편집·복구를 허용. 신규 비호환 기능 사용과 DDL은 차단 |
| 내보내기 | 서버에서 DB 설정·문서를 같은 스냅샷으로 조회하고 프로젝트 전체 물리 객체 출력 |

`v1` 프로필은 규칙 변경으로 과거 설계 의미가 바뀌지 않도록 고정한다. DB 제품 버전, 제품 카탈로그 버전, 문서 버전, DB 설정 변경 번호는 서로 다른 개념이다. PostgreSQL 실행 QA는 저장소의 `postgres:18.6` 환경을 참고한다. MySQL/SQLite의 exact 실행 버전은 구현 첫 검증에서 고정해 기록한다. 임의의 모든 상위 버전 호환을 보장하지 않는다.

## 2. 공통 정책 인터페이스

모델 패키지의 정책은 Node/브라우저에서 실행 가능한 순수 함수로 둔다. DB 연결·React·Nest·Zod와 독립시키고 계약 패키지는 이 정의를 이용해 구조 스키마를 만든다. 아래 코드는 API 설계 스케치다.

```ts
type DatabaseKind = 'postgresql' | 'mysql' | 'sqlite';
type Availability = 'specified' | 'implemented' | 'verified';
type ValidationMode = 'read' | 'write' | 'export';

interface DatabaseContext {
  kind: DatabaseKind;
  profileId: DatabaseProfileId;
}

interface DatabaseIssue {
  code: string;
  category: 'unsupported' | 'invalid' | 'incomplete' | 'environment';
  severity: 'error' | 'warning';
  objectId: string | null;
  path: string;
  params: Record<string, string | number | boolean>;
}

getDatabaseProfile(context: DatabaseContext): DatabaseProfile;
listColumnTypes(context: DatabaseContext, table: TableV2): TypeChoice[];
getColumnOptions(context: DatabaseContext, column: ColumnV2): ColumnOptionSpec;
checkFeature(context: DatabaseContext, featureId: FeatureId,
  document: DesignDocumentV2, objectId: string): FeatureDecision;
validateDatabaseDocument(document: DesignDocumentV2, context: DatabaseContext,
  options: { mode: ValidationMode; previous?: DesignDocumentV2 }): DatabaseIssue[];
exportDdl(document: DesignDocumentV2, context: DatabaseContext): DdlExport;
```

`TypeDefinition`은 타입별 파라미터 구조, 별칭 resolver, 허용 옵션, 기본값 parser/printer, 키/FK·인덱스 적합성 함수, 구현 상태와 검증 fixture ID를 가진다. `FeatureDefinition`은 `supported: boolean`에 그치지 않고 객체·타입·키·식 문맥에서 이유가 있는 허용/거부 결정을 반환한다.

카탈로그에는 엔진이 제공하는 기능을 모두 명세하되 미완료 기능을 선택 가능으로 노출하지 않는다. 필요한 UI·서버·DDL 경로의 검증 fixture가 없으면 CI에서 `verified`로 활성화할 수 없게 한다. 카탈로그와 지원표는 같은 데이터에서 생성·비교하도록 구현한다.

## 3. 문서 v2와 프로젝트 설정

### 3.1 프로젝트와 문서의 일관성

- 프로젝트 행의 `databaseKind`는 권한/쓰기 문맥의 기준이다. `databaseProfileId`, `databaseRevision`(0부터 증가)을 프로젝트 저장/조회 계약에 추가한다.
- v2 문서에 `database: { kind, profileId }`를 넣어 독립 JSON/클립보드에서도 타입 해석이 가능하게 한다. 프로젝트 행과 문서의 설정은 항상 같아야 한다.
- 일반 설계 변경에서 `/database`와 `/schemaVersion` 쓰기를 금지한다. 설정/업그레이드 서비스만 프로젝트와 문서를 함께 수정한다.
- 서버는 클라이언트가 보낸 DB 종류를 믿지 않고 잠근 프로젝트 행과 비교한다. 설정 불일치는 거부한다.
- 새 물리 타입은 타입 ID에 DB가 있으므로 문서 전체 DB 설정과 개별 타입의 DB가 같은지 검증한다. 레거시 보존 분기는 예외 읽기/복구 경로다.

DB 마이그레이션은 프로젝트 프로필/변경 번호 열과 JSON 기본 문서 형식을 위한 한 단위가 필요하다. 카탈로그 자체는 DB 테이블에 저장하지 않는다. 개인 화면 설정에는 DB 설정을 중복 보관하지 않는다.

### 3.2 타입과 옵션

다음은 분기 구조의 예시이며 실제 TypeScript/Zod 정의는 타입 카탈로그의 정확한 파라미터 스키마를 사용한다.

```ts
type ColumnTypeV2 =
  | { kind: 'builtin'; database: 'postgresql'; typeId: PostgresTypeId;
      parameters: PostgresTypeParameters; array?: { dimensions: number } }
  | { kind: 'projectEnum'; database: 'postgresql'; enumId: string;
      array?: { dimensions: number } }
  | { kind: 'builtin'; database: 'mysql'; typeId: MysqlTypeId;
      parameters: MysqlTypeParameters }
  | { kind: 'valueList'; database: 'mysql'; typeId: 'mysql:enum' | 'mysql:set';
      values: string[] }
  | { kind: 'builtin'; database: 'sqlite'; typeId: SqliteTypeId;
      parameters: SqliteTypeParameters }
  | { kind: 'declared'; database: 'sqlite'; name: string;
      numericArguments: string[] }
  | { kind: 'untyped'; database: 'sqlite' }
  | { kind: 'legacy'; source: 'document-v1'; original: LegacyPhysicalType };
```

`PostgresTypeParameters` 등은 거대한 임의 레코드 대신 typeId별로 구분되는 구조로 정의한다. 예: numeric은 precision/scale, varchar는 length, interval은 fields/precision을 가진다. MySQL unsigned는 정수 타입의 옵션으로 정의한다. 무관한 필드를 받아 저장한 뒤 무시하지 않는다. 타입 이름과 임의 SQL 조각은 서로 다른 입력이다.

일반 SQLite 사용자 선언은 안전한 typeName 인용과 검증된 숫자 인자만 출력하는 별도 경로로 둔다. 세미콜론/제약/주석을 섞는 문자열 출력은 허용하지 않는다. `PRAGMA table_info` 및 affinity 테스트로 선언 보존을 확인한다. STRICT에서 이 경로는 사용할 수 없다.

컬럼의 `physical`은 기존 이름·nullable·comment에 `type`, `generation`, `defaultValue` 및 DB별 옵션을 둔다.

| 필드 | 구조 |
| --- | --- |
| generation | none / PG serial / PG identity(always,byDefault) / MySQL autoIncrement / SQLite autoIncrement / computed(stored,virtual,expression) |
| defaultValue | none / null / typedLiteral / builtinExpression / legacyExpression |
| typedLiteral | 문자열/정수·소수 토큰/논리/이진/JSON/타입별 텍스트 표현. 정수·소수는 JS number 대신 문자열로 보관 |
| builtinExpression | DB별 허용 함수 ID와 구조화된 인자. 함수명 문자열 임의 삽입 금지 |
| column options | PG collation, MySQL charset/collation/onUpdate/SRID 등 DB별 허용 분기 |

SQLite의 INTEGER 단일 PK는 명시 AUTOINCREMENT가 없어도 rowid 자동 할당 동작이 있다. 이 동작은 `effectiveGeneration(type, key, tableOptions)`에서 파생해 UI에 표시하고, 명시 AUTOINCREMENT와 구분한다. 생성 옵션 없음만으로 자동 할당을 끌 수 있다고 표시하지 않는다. FK 컬럼 자동 생성은 원소 타입·부호·문자셋 등을 복사하되 모든 DB에서 원본의 생성/기본값/onUpdate를 제거한다.

새 기본값 입력은 구조화 UI 또는 지원되는 DB별 제한 parser를 사용한다. 타입 이름만 바뀌어 의미가 바뀌면 기본값/생성 옵션 제거 예정 내용을 보여 주고 한 변경 작업으로 적용한다. 기존 기본값을 임의로 새 타입에 유지하거나 자동 변환하지 않는다.

### 3.3 테이블·제약·인덱스

- 테이블 namespace는 `postgresSchema(name)` / `mysqlCurrentDatabase` / `sqliteMain`으로 분기한다. MySQL DB 생성/다중 DB, SQLite ATTACH는 이번 native 범위에 포함하지 않는다.
- SQLite는 테이블 옵션으로 `strict`, `withoutRowid`를 가진다. STRICT를 프로젝트 전체 단일 모드로 취급하지 않는다.
- 기존 PK/UNIQUE는 `keys`를 유지하고 FK는 `tableRelations`를 유지한다. native DB의 이름·NULL·부호·참조 키 정책을 적용한다. 옵션 추가는 DB별 분기로 보관한다.
- `enums`는 PG 독립 ENUM 정의로 유지한다. MySQL ENUM/SET은 컬럼 값 목록이다. SQLite ENUM을 native 후보로 만들지 않으며 CHECK 기능에서 값 제한을 표현한다.
- `indexes`와 `checks`를 ID가 있는 문서 컬렉션으로 추가한다. 각각 tableId, name, scope 및 DB별 명세를 가진다. 인덱스에는 순서 있는 컬럼/식, 접근 방식, predicate/include 등을 지원 상태에 따라 둔다.
- CHECK/generated/index 식은 컬럼 ID를 참조하는 제한 AST로 저장한다. SQL 렌더링은 현재 컬럼명을 ID에서 찾는다. 함수는 DB별 허용·불변성/결정성 정책을 적용한다. 원시 SQL 전체 파서를 첫 범위에 넣지 않는다.
- 새 컬렉션은 전역 ID 유일성, 용량 제한, 공유 diff·의존성, copy/paste ID remap, 삭제 정리, undo/restore, MCP 조회/변경에 모두 등록한다. 컬렉션을 추가하고 DDL에만 붙이는 구현은 완료로 보지 않는다.
- 초기 제품 한도: indexes 10,000개, checks 10,000개, 컬럼당 값 목록 1,000개(SET은 DB 최대 64개 적용), 전체 문서 1.5 MB/전송 2 MB는 유지한다. 확장된 표현 때문에 한도 초과가 나면 정확한 경로와 이유를 반환한다.

## 4. 검증 기준과 오류 계약

### 4.1 검증 단계

| 단계 | 내용 | 저장/DDL |
| --- | --- | --- |
| 구조 | 알려진 형식/버전, 필드/union, 크기, ID/필수 참조 | 깨진 구조는 쓰기 거부 |
| DB 적합성 | 타입·옵션·조합·프로필·native 기능의 허용 | 신규 unsupported/invalid 사용은 쓰기 거부 |
| 작성 중 미완성 | 이름 미입력, 컬럼 없는 테이블, 작성 중 FK/식 | 기존 편집 흐름에 필요한 제한 초안 저장 허용, DDL 오류 |
| DDL 가능성 | 전체 식/타입/참조·이름 충돌·DB 한도 및 출력 지원 | 오류 하나라도 있으면 SQL 전체 비움 |
| 실행 환경 | collation/함수/등록 객체 등 외부 전제 | 지원 프로필 안에서 확정하거나 의존성 경고/차단 |

초안이라는 이유로 잘못된 옵션을 허용하지 않는다. 예: 빈 테이블은 저장할 수 있지만 SQLite 컬럼에 PG 배열 옵션을 신규 추가하는 것은 거부한다. 타입이 변경되어 FK가 일시적으로 불일치하면 `incomplete`로 안내할 수 있으나 지원 불가 FK 동작/컬럼 옵션은 명확히 차단한다.

기존 문서의 오류는 `previous`와 비교해 복구 편집을 허용한다. 판정 키는 ruleCode + objectId + path + 오류를 유발한 관련 필드 fingerprint다. 단순 오류 개수 비교는 금지한다. 신규 오류, 기존 오류를 다른 객체로 복제하거나 원인 필드를 바꾸면서 여전히 잘못된 상태를 만드는 쓰기는 거부한다. 레이아웃/설명 수정 및 오류 원인의 해소는 허용한다. 삭제로 남는 필수 참조는 구조 단계에서 검사한다.

### 4.2 오류 결과

서버·MCP·화면은 동일한 `issues[]`를 사용하고 message는 번역 계층에서 생성한다. 코드 예:

```text
database.context-changed
database.profile-unsupported
type.not-supported
type.option-not-supported
type.parameter-out-of-range
generation.key-required
foreign-key.action-not-supported
legacy.type-unresolved
legacy.default-unresolved
ddl.incomplete-model
```

API validation 응답은 `422` + `{ code: 'database.validation-failed', issues }`를 권고한다. 버전/DB 설정 변경 충돌은 `409`. 기존 sync의 accepted/rejected 결과는 유지하되 `reasonCode`, `issues`, 최신 databaseRevision/context를 추가한다. HTTP/WS/MCP에서 문자열 reason만 읽는 기존 경로와의 호환을 제공한다.

MCP의 부분 patch도 입력 일부만 검사하지 않고 후보 최종 문서를 검사한다. 서버 SyncService의 프로젝트 행 lock 및 구조 검증 직후를 DB 적합성 검증의 공통 위치로 삼고, REST/import/DB 설정 변경도 같은 함수를 부른다. restore/undo 역시 현재 DB 정책을 우회하지 않는다.

## 5. 동기화와 DB 설정 변경

### 5.1 설정 변경 번호

- `databaseRevision`은 DB 종류/프로필 또는 문서 형식 업그레이드로 타입 해석 문맥이 바뀔 때만 증가한다. 일반 이름/설계 변경과 구분한다.
- sync input/baseline/result/head와 MCP apply에 이 번호 및 프로필을 전달한다. v2 쓰기에는 누락을 허용하지 않는다.
- 신규 작업은 잠근 행의 번호와 비교하고 불일치하면 `database.context-changed`로 거부한다. 기존 동일 operationId의 동일 요청 재생은 기존 idempotency 결과를 유지한다.
- 오프라인 큐/실행 취소/복원은 생성 당시 문맥을 보관한다. DB 변경 뒤 예전 작업을 새 정책으로 조용히 재해석하거나 자동 재전송하지 않고 최신 설계 재조회·미적용 변경 복구 안내를 제공한다.
- DB 변경 서비스도 SyncService와 같은 프로젝트 row lock을 사용한다. 일반 metadata PATCH에서 databaseKind/profile 변경을 직접 적용하는 경로를 닫는다.
- `databaseKind`, profile, revision을 sync head 및 프로젝트 조회에 포함한다. DB 변경 후 WS 알림은 commit 이후 보내고 polling에서도 갱신을 발견할 수 있게 한다. 단순 WorkspaceEvents의 accessChanged 이벤트만으로 처리하지 않는다.

### 5.2 DB 변경 API

| API | 입력 | 동작 |
| --- | --- | --- |
| POST `/api/projects/:id/database/preview` | expectedVersion, expectedSequence, targetKind/profile | 현재 snapshot에서 호환성/변환 가능 항목·차단 사유를 읽기 전용 계산 |
| POST `/api/projects/:id/database/change` | operationId, expectedVersion, expectedSequence, expectedDatabaseRevision, targetKind/profile | 권한 확인 후 row lock, 서버에서 재검사하고 project+document 원자 변경 |

preview 결과는 적용 권한이나 최신 상태 보증이 아니다. apply는 검사 결과를 다시 계산한다. client가 보낸 임의 변환된 문서를 신뢰하지 않는다. `manageProject` 권한으로 설정 변경을 허용하되 실제 물리 설계 변환이 포함되면 `design` 권한도 확인한다. 보관 프로젝트 변경은 기존 정책처럼 차단한다.

물리 설계가 비었다는 조건은 단순 `tables.length===0`이 아니라 물리 테이블/컬럼/키/FK/ENUM/index/check 및 미해결 legacy 정의가 모두 없는 상태다. 논리 도메인·메모·레이아웃은 유지한다.

첫 구현은 빈 물리 설계만 변경 적용을 허용한다. 설계가 있으면 preview는 제공하되 적용은 `database.conversion-required`로 차단한다. 다음 단위에서 검증된 타입·옵션 매핑과 손실 없는 변환 계획을 추가한다. 손실 가능 항목은 자동 적용하지 않으며 복제/수동 수정 흐름을 별도로 설계한다. 기존 문서의 복구와 일반 DB 간 변환을 같은 어댑터로 혼동하지 않는다.

DB 변환 적용은 operationId로 재생 가능하게 하고 감사 이력에 대상/원본 DB, revision, 실제 변환 요약을 기록한다. document가 변경되는 경우 syncSequence/필드 버전/이력도 같은 트랜잭션에서 갱신하고 이전 baseline을 무효화한다. idempotency와 최대 문서·변경 수 검사도 유지한다.

## 6. v1 데이터와 전송 형식 호환

### 6.1 읽기 및 업그레이드

- v1 stored/transfer/clipboard/history를 별도 구조 스키마로 읽는다. 새 PG·MySQL·SQLite 규칙으로 v1 파싱을 실패시키지 않는다.
- PostgreSQL 표시 v1의 알려진 타입·파라미터는 DB 의미를 유지해 v2로 변환하고 serial은 생성 옵션으로 분리한다. 미확인 타입/기본값은 legacy 분기로 보존한다.
- MySQL/SQLite 표시 v1 문서는 과거 편집기가 PG 기준이었다는 점을 반영한다. 문자열 `integer`만 보고 MySQL int나 SQLite INTEGER PK로 바꾸지 않는다. 원본 타입/기본값/스키마를 보존한 legacy 진단을 제공한다.
- GET은 저장 문서를 자동 덮어쓰지 않는다. 읽기 어댑터의 canonical preview와 저장 원본을 구분한다. 편집 시작 시 `POST /api/projects/:id/document/upgrade`에서 expectedVersion/sequence/revision 및 operationId로 v2 업그레이드를 처리한다.
- upgrade는 design 권한, 프로젝트 row lock, idempotency, 문서 예산, snapshot/이력, baseline reset을 갖춘 별도 원자 작업이다. 과거 DB 표시 자체를 임의로 바꾸지 않는다. legacy 포함 v2는 복구 편집만 제한 허용한다.
- migration 진단 목록은 서버에서 문서·정책으로 다시 계산한다. client가 기존 오류라고 주장하는 arbitrary legacy 입력은 받지 않는다.
- 동기화 raw diff/fingerprint는 원본 형식에서 먼저 검사한다. 정규화/변환을 이용해 위조된 before/after를 숨기지 못하게 한다. 프로토콜/문서 업그레이드 전에 큐를 flush하고 미적용 변경은 따로 보존한다.

기존 unknown 타입은 신규 입력 후보에 추가하지 않고 현재 값 + 문제 표시로만 보여 준다. legacy 분기는 v1 upgrade/검증된 import만 생성할 수 있다. 일반 REST/MCP/clipboard 신규 쓰기는 legacy를 새 객체에 복제할 수 없다. 기존 객체의 legacy 원본은 안전한 필드만 유지/정상 타입으로 교체/삭제할 수 있다.

### 6.2 JSON·클립보드·이력

- 새 JSON export는 formatVersion 2와 v2 document/database를 포함한다. project metadata와 document.database 불일치는 import 거부한다. v1 export로 낮추는 기능은 새 기능 표현 손실 때문에 제공하지 않는다.
- v1 import는 원본 DB 표시를 유지하며 서버 migration과 진단을 거친다. native v2 import는 전체 구조/DB 검증을 통과해야 한다. 미완성 설계와 문서의 원본 legacy 문제는 정책에 따라 보존 가능하다.
- schemaVersion 2를 모르는 클라이언트는 편집·새 쓰기를 차단하고 갱신 안내를 받는다. 임의 필드 무시 후 v1로 재저장하는 것은 금지한다.
- 새 clipboard envelope는 formatVersion 2, sourceDatabase/profile, 문서 fragment를 포함한다. 같은 DB/profile이라도 대상 테이블 모드에 맞춰 전체 검사한다. 다른 DB paste는 명시적 변환기가 마련되기 전 차단한다.
- indexes/checks/default AST/ENUM 참조는 복사·복원에서 ID를 remap한다. 보이지 않는/생성용 객체를 빠뜨리지 않는다.
- 과거 baseline/history/deletionSnapshot/result는 저장 형식을 유지한다. 읽기 어댑터로 표시하고 v1 snapshot을 v2에 복원할 때 현재 context로 검사한다. 옛 accepted 작업 재생은 같은 응답을 유지하고 새로운 문서 쓰기는 별도 v2 작업으로 처리한다.

## 7. UI 및 MCP 흐름

- ProjectGallery는 DB 선택 변경 전에 preview를 호출한다. 첫 구현의 비어 있지 않은 설계는 차단 사유와 affected 객체를 보여 준다. 빈 프로젝트 변경은 기존 빠른 선택 흐름을 유지한다.
- App이 DatabaseContext를 Canvas→TableEditor/Inspector/Enum/Relation 도구로 전달한다. 프로젝트별 정책 hook 또는 context를 한 번 구성하고 매 컴포넌트에서 분기 목록을 하드코딩하지 않는다.
- column-type-options/typeParameterEnabled/column-defaults/type-display는 공통 카탈로그를 사용한다. 인라인 편집과 우측 inspector가 같은 목록/옵션을 제공한다.
- 현재 프로젝트 DB에서 구현 완료 타입만 검색 가능하다. 미등록/legacy 값은 현재 값 표시와 수정 진단으로 유지한다.
- 적용 조건이 없는 기능은 메뉴에서 숨기거나 비활성 이유를 짧게 표시한다. 예: MySQL 프로젝트에서는 PG 독립 ENUM 관리창 대신 컬럼 ENUM/SET 값 편집을 제공한다.
- DB 설정 변경을 수신하면 편집 상태와 메뉴를 새 정책으로 갱신한다. 포커스 중 이전 정책의 입력은 자동 강제 저장하지 않고 새 상태에서 검증한다.
- 진단은 objectId/path로 테이블·컬럼·키·관계·ENUM/index/check 편집 위치로 이동한다. 모델 메시지는 번역 코드/params로 제공한다.
- MCP에 `get_project_database_capabilities(projectId)` 읽기 도구를 추가해 실제 타입 ID·파라미터·지원 기능을 조회하게 한다. 프로젝트 요약에 context/revision을 포함하고 변경 도구는 해당 revision을 요구한다.
- MCP schema는 전체 지원 DB의 구조 합집합으로 제공하되 후보 최종 문서는 서버의 project context로 검증한다. tools description에 현재 설계/DDL이 PG 고정이라는 기존 설명을 교체한다.

## 8. DDL 생성과 실제 실행 검증

공유 메뉴는 `프로젝트 내보내기` → `DDL 내보내기` → `고화질 PNG`. 결과에는 DB 종류와 프로필을 표시하고 `<프로젝트명>.<db>.sql` 파일명 및 UTF-8 출력 규칙을 사용한다.

실행 순서:

1. 자동 저장 및 durable queue/pending/conflict/storageFailure 상태를 확인한다. prepareToLeave만으로 서버 공유 저장 완료를 가정하지 않는다.
2. 기존 조회 API에서 최신 project/context/revision/document를 일관된 snapshot으로 받는다.
3. document 전체에서 물리 객체를 수집하고 공통 및 DB별 export 검증을 수행한다. 뷰/도메인/선택 상태로 필터링하지 않는다.
4. native dialect가 스키마/ENUM/테이블/키/FK/index/check/generated/comment를 지원 정책대로 출력한다. 오류가 있으면 부분 SQL 파일을 내려받지 않는다.
5. 환경 의존 경고/SQLite의 설명 주석 같은 차이를 결과 화면에 안내한다. 확인 중 DB/revision/document version이 달라지면 재생성한다.

PG/MySQL은 FK를 테이블 생성 뒤 붙이고 SQLite는 CREATE TABLE에 FK를 포함한다. 인덱스/키와 FK의 의존 순서, generated column 참조, cycle 및 복합 키를 DB별로 검사한다. SQL은 기본적으로 새 설계 객체 생성용이며 기존 DB를 맞추는 migration을 계산하지 않는다.

기존 exportPostgres는 v1 호환 진입점으로 유지하거나 명시 deprecated 후 v2 어댑터로 연결한다. 이전 SQL fixture는 PG native 의미가 바뀌지 않는지 확인한다. 첫 구현에서 데이터 타입·기본값을 텍스트 치환해 다른 방언으로 바꾸지 않는다.

QA는 타입 단위 fixture + 기능 조합 fixture로 구성한다. 각 타입의 기본 선언/리터럴 roundtrip과 키/기본값 지원 가능한 조합을 실제 DB에서 실행한다. PostgreSQL은 rollback 가능한 임시 스키마, MySQL은 전용 임시 DB cleanup, SQLite는 메모리/임시 파일을 사용한다. 프로파일의 SQL mode·FK 활성·콜레이션 전제를 고정한다.

## 9. 코드 변경 위치와 구현 단위

| 단위 | 주요 위치 | 완료 기준 |
| --- | --- | --- |
| C1 전체 카탈로그/프로필 | model/database, postgres-types 호환 함수 | 지원표 타입별 정의·별칭·옵션·조건·fixture 목록; 미구현 선택 불가 |
| C2 v2 모델/어댑터 | model/document, contracts/relational/workspace/transfer, DB schema/migration | v1↔읽기 호환, native 분기, legacy 원본 보존, profile/revision 저장, 1.5/2 MB 한도 |
| C3 서버 정책/동기화 | sync.service, workspace.service/controller, normalize-document, baseline/undo/restore | lock 안에서 context/최종 후보 검사, 설정 보호·오프라인 구문맥 거부·재생 유지 |
| C4 타입/F1 편집/MCP | App/Canvas/TableEditor, column-type-options/defaults, Enum/FK, mcp-* | 세 DB 같은 정책 사용; UI·REST·MCP 판정 일치; 빈 DB 변경/legacy 수정 지원 |
| C5 DDL/공유 메뉴 | model/database/dialects, 기존 postgres, App/Canvas, 진단 UI | 세 DB 전체 물리 설계 다운로드 및 실제 파일/기본 DB 실행 검사 |
| C6 T2 기본 타입 확장 | 고급 타입 catalog/parser/DDL, 해당 옵션 UI | 고급 기본 타입 누락 없이 타입별 경계/실행 fixture; 잘못된 key/default 옵션 차단 |
| C7 F2 기능 확장 | indexes/checks/expr/generated, sync/clipboard/undo/MCP/UI/DDL | 기능 합집합의 DB 조건·참조·라이프사이클 완비 및 실제 조합 검사 |
| C8 DB 변환/전체 QA | database-change planner, 갤러리, 서버/통합/브라우저 검증 | 검증된 변환 계획의 원자성·충돌/복구; 전체 타입/기능 지원표 검증 |

C1~C5를 ‘전체 타입·기능 지원 완료’라고 부르지 않는다. 단계별 enable은 전체 세로 경로가 완성된 기능에만 적용한다. C6/C7까지 진행해 지원표에서 정의한 전체 기본 타입/ERD 기능 목표를 채운다. C8의 변환기는 다른 DB 프로젝트에서의 native 설계/export 자체와 구분하되 DB 변경 UX 완성을 위한 후속 단위로 추적한다.

현재 코드에서 추가 점검할 부분:

- `postgres-types.ts`: 별칭 정규화와 옵션 검증을 공용 정책 진입점과 PG 구현으로 분리.
- `contracts/relational.ts`: PG ENUM byte 제한 및 타입 검증을 DB 문맥 밖에 강제하는 구조 제거.
- `document.ts`: serial→정수에 한정된 FK 컬럼 생성, 삭제 cascade, 전역 IDs/진단/표시 지원.
- `sync.ts`: 새 컬렉션, AST 컬럼 참조, 타입/generation 의존 경로와 field conflict 처리.
- `sync.service.ts`: raw fingerprint→정규화→잠긴 행 문맥→최종 후보 검증, snapshot remap/undo/restore.
- `workspace.service.ts`: 단순 databaseKind metadata PATCH 및 import 고정 PG 검증 수정.
- `column-defaults.ts`: auto 증가를 기본값 선택에서 serial 이름으로 바꾸는 현재 처리 교체.
- `mcp-read/patch/document/server`: 조회/patch/commands와 capabilities 도구, 실제 project DB 안내.

각 단위 시작 전 계획·완료 후 작업 로그를 기록하고 작고 독립적인 커밋으로 진행한다. 단위별 유효성 테스트, 실제 DB 검증, 전체 format/typecheck/test/build를 적절한 순서로 수행한다. 전체 포맷 변경은 기능 변경과 섞지 않는다.

## 10. 필수 검증 시나리오

| 사례 | 기대 결과 |
| --- | --- |
| MySQL에서 PG array/uuid 타입 ID를 POST/MCP로 입력 | UI에 후보 없음, 서버 unsupported로 거부 |
| PG numeric(20,-2), MySQL decimal(20,-2) | 해당 DB 규칙에 따라 서로 다른 판정 |
| SQLite 일반 VARCHAR(20), STRICT VARCHAR(20) | 일반은 affinity 안내, STRICT 신규 선언 거부 |
| 빈 테이블/이름 미입력 | draft 저장 가능, export 오류 및 수정 위치 표시 |
| 동일 type 표시명이 여러 DB에 존재 | DB별 ID·옵션·DDL 유지, 전역 alias 변환 없음 |
| parent auto 증가 PK에서 child FK 생성 | base type/부호·문자집합 유지, child 생성/기본값 제거 |
| 카드 DB 변경과 다른 사용자의 sync 동시 실행 | row lock/revision으로 한 문맥에서만 적용, 구문맥 거부 |
| DB 변경 뒤 오프라인 큐 replay | 이전 accepted operation은 동일 결과, 새 구문맥 쓰기 거부 |
| 기존 MySQL 표시 v1에 PG timestamptz 존재 | 열기/원본 표시/복구 허용, 신규 복제·DDL 차단 |
| v1 unknown 타입 설명/레이아웃 수정 | legacy 원본 유지, 오류 복제 없음, 수정 가능 |
| schemaVersion2를 v1 클라이언트가 저장 | 무시/손실 저장 금지, 업그레이드 필요 응답 |
| 도메인 없는 테이블 및 다른 도메인 참조 | 전체 설계 한 번씩 출력, 화면 참조 중복 없음 |
| 인덱스/CHECK 컬럼 삭제·복사·undo/restore | ID 참조 정리/검사와 현재 DB 정책 유지 |
| 미검증 타입/옵션에 verified 표시 | 지원 fixture/gate 테스트 실패 |
| 실제 FK/enum/default/generated/check 실행 | 정상 DDL 실행 + 값 허용/거부·갱신/삭제 동작 검증 |

## 11. 설계 근거 및 상태

세부 DB 사실과 타입/기능별 공식 출처는 [지원 명세](2026-10-01-Database-TypeFeatureMatrix.md)에 가까이 연결한다. 본 문서의 API·모델·프로필·정책 선택은 해당 자료 및 현 코드 조사에 따른 제품 설계다.

후속 구현에서만 확정할 사항은 exact QA 실행 이미지/SQLite 라이브러리 버전, DB별 고급 기본값 parser의 함수 whitelist, 설치 의존 collation/SRID 목록 및 각 feature 실행 fixture다. 인터페이스·저장/동기화 원칙·기본 UX를 이 항목 때문에 다시 결정할 필요는 없다. 미검증 세부 항목은 availability gate로 막고 구현 결과로 명세를 갱신한다.
