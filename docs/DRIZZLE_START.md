# 프로젝트 테이블로 익히는 Drizzle

## 1. 스키마 정의

`apps/server/src/db/schema.ts`가 EZERD 자체 DB의 테이블을 정의합니다.

```ts
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  status: projectStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

이 코드를 작성하는 것만으로 DB가 변경되지는 않습니다. 변경을 마이그레이션 파일로 생성하고 적용해야 합니다.

`updatedAt`의 기본값은 INSERT 시에만 적용됩니다. 프로젝트 수정 기능을 구현할 때 해당 컬럼을 명시적으로 갱신해야 합니다.

## 2. SQL 생성과 적용

```powershell
pnpm db:generate
# apps/server/drizzle의 새 SQL 파일을 검토
pnpm db:migrate
```

초기 SQL은 `apps/server/drizzle/0000_create_projects.sql`에 있습니다. SQL 파일과 `meta` 폴더를 함께 버전 관리합니다. 이미 적용한 마이그레이션을 수정하는 대신 새 마이그레이션을 추가합니다.

## 3. 저장과 조회

실행 가능한 예시는 `apps/server/scripts/db-check.ts`입니다.

```ts
await tx.insert(projects).values({ id, name: '개발 환경 연결 검증' });
const [project] = await tx
  .select()
  .from(projects)
  .where(eq(projects.id, id));
```

SQL 관점에서는 다음 작업에 해당합니다. 실제 Drizzle 쿼리는 값들을 파라미터로 전달하고 기본값 컬럼을 처리하므로 출력 SQL의 형태는 달라질 수 있습니다.

```sql
INSERT INTO projects (id, name) VALUES ($1, $2);
SELECT id, name, status, created_at, updated_at
FROM projects
WHERE id = $1;
```

`$inferSelect`는 읽은 행의 타입, `$inferInsert`는 새 행을 넣을 때의 타입을 만듭니다. 기본값이 있는 컬럼은 입력 시 생략할 수 있습니다.

## 4. 데이터 없이 검증하기

```powershell
pnpm db:check
```

이 스크립트는 트랜잭션 안에서 임시 프로젝트를 저장·조회하고 의도적으로 롤백합니다. 롤백 후 해당 ID가 남지 않았는지도 확인합니다. 이를 통해 연결·마이그레이션·저장·조회·롤백이 실제 PostgreSQL에서 동작하는지 확인합니다.

프로젝트 생성·목록·수정·보관·문서 저장 API는 `apps/server/src/workspace.controller.ts`에 구현했습니다. 아래 예제는 현재 기능의 쿼리와 대응 SQL을 설명합니다.

## 참고

- [Drizzle 스키마](https://orm.drizzle.team/docs/sql-schema-declaration)
- [Drizzle 조회](https://orm.drizzle.team/docs/select)
- [Drizzle Kit](https://orm.drizzle.team/docs/kit-overview)


## 5. 실제 갤러리와 프로젝트 생성

```ts
const [row] = await db.insert(projects)
  .values({ name: input.name })
  .returning();
```

대응 SQL의 핵심은 다음과 같습니다. ID, 상태, 문서, 버전, 시각은 DB 기본값으로 채웁니다. `returning()`으로 생성된 행을 한 번에 읽습니다.

```sql
INSERT INTO projects (name) VALUES ($1)
RETURNING *;
```

갤러리는 상태와 검색어로 좁히고 최근 수정순으로 읽습니다. 사용자 검색의 `%`와 `_`는 먼저 이스케이프해 일반 문자로 검색합니다.

```ts
await db.select().from(projects)
  .where(and(
    eq(projects.status, input.status),
    escapedSearch ? ilike(projects.name, `%${escapedSearch}%`) : undefined,
  ))
  .orderBy(desc(projects.updatedAt), asc(projects.id));
```

```sql
SELECT * FROM projects
WHERE status = $1 AND name ILIKE $2
ORDER BY updated_at DESC, id ASC;
```

검색어가 비어 있으면 이름 조건을 생략합니다. 외부 입력은 SQL 문자열에 직접 붙이지 않고 Drizzle이 바인딩하는 값으로 전달합니다.

## 6. 문서 저장과 오래된 저장 방지

```ts
const [row] = await db.update(projects)
  .set({
    document: input.document,
    version: sql`${projects.version} + 1`,
    updatedAt: new Date(),
  })
  .where(and(
    eq(projects.id, id),
    eq(projects.version, input.expectedVersion),
    eq(projects.status, 'active'),
  ))
  .returning();
```

핵심 SQL은 다음과 같습니다.

```sql
UPDATE projects
SET document = $1::jsonb,
    version = version + 1,
    updated_at = $2
WHERE id = $3 AND version = $4 AND status = 'active'
RETURNING *;
```

버전 3을 읽은 두 화면이 동시에 저장하면, 첫 저장으로 버전이 4가 됩니다. 두 번째 저장은 `version = 3` 조건에 맞는 행이 없어 갱신하지 않습니다. 서버는 프로젝트 존재 여부를 확인해 없으면 404, 버전이 바뀌었거나 보관 상태면 409를 반환합니다. 조회 후 별도 무조건 UPDATE를 수행하지 않으므로 조건 검사와 갱신 사이에서 덮어쓰기가 발생하지 않습니다.

프로젝트 이름 수정과 보관도 같은 버전 검사를 사용합니다. `updatedAt`은 수정 쿼리에서 명시적으로 갱신합니다. 과거 버전의 내용은 보관하지 않으므로 이 장치 자체가 변경 이력이나 복원을 제공하지는 않습니다.

추가 마이그레이션 `0001_dazzling_scrambler.sql`은 기존 프로젝트에 기본 빈 문서와 버전 0을 부여하고 사용자 테이블을 추가합니다. JSONB는 사용자가 설계한 도메인과 배치를 보관하며 대상 DB 테이블을 실행해 만드는 기능과는 별개입니다.

실제 DB 검증은 `pnpm test:integration`으로 실행합니다. 현재 소스를 빌드한 뒤 저장·재열기·두 요청의 경쟁·잘못된 요청 거부를 확인하고 테스트가 생성한 ID만 정리합니다.


## 7. 댓글과 멘션의 트랜잭션

`review_threads`, `review_messages`, `review_notifications`는 `projects.document`와 별개다. `apps/server/src/review.controller.ts`의 새 댓글 처리는 Drizzle 트랜잭션 안에서 다음 순서로 실행한다.

```sql
BEGIN;
SELECT document FROM projects WHERE id = $1 FOR UPDATE;
-- 현재 화면/객체와 작성자/멘션 대상이 존재하는지 검사
INSERT INTO review_threads (...) VALUES (...) RETURNING *;
INSERT INTO review_messages (...) VALUES (...);
INSERT INTO review_notifications (...) VALUES (...);
COMMIT;
```

`SELECT ... FOR UPDATE`는 대상 검증 중 다른 저장이 같은 프로젝트 행을 변경하는 순서를 조정한다. 이후 객체가 삭제되어도 thread의 object_id는 문자열 참조로 보존되어 대화를 잃지 않는다. 멘션 사용자 검증이나 기록 중 하나라도 실패하면 전체 트랜잭션을 롤백해 댓글만 생기거나 알림만 남는 상태를 방지한다. 실제 SQL의 값은 Drizzle이 매개변수로 바인딩한다.

단순 설계 저장은 프로젝트 행의 JSONB와 버전만 갱신한다. 따라서 다른 사용자가 작성한 댓글이나 알림을 오래된 설계 문서가 덮어쓰지 않는다.
