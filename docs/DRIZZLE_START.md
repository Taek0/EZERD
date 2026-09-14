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

프로젝트 생성 API는 다음 기능 단계에서 구현합니다. 현재 DB 검증 스크립트가 공개 프로젝트 생성 API를 대신하지는 않습니다.

## 참고

- [Drizzle 스키마](https://orm.drizzle.team/docs/sql-schema-declaration)
- [Drizzle 조회](https://orm.drizzle.team/docs/select)
- [Drizzle Kit](https://orm.drizzle.team/docs/kit-overview)

