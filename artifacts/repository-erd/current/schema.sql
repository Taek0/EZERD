-- EZERD PostgreSQL creation DDL

CREATE TYPE "public"."workspace_invitation_status" AS ENUM (E'pending', E'accepted', E'declined', E'cancelled', E'expired');

CREATE TYPE "public"."project_database_kind" AS ENUM (E'postgresql', E'mysql', E'sqlite');

CREATE TYPE "public"."project_status" AS ENUM (E'active', E'archived');

CREATE TYPE "public"."workspace_role" AS ENUM (E'owner', E'editor', E'viewer');

CREATE TYPE "public"."workspace_status" AS ENUM (E'active', E'archived');

CREATE TABLE "public"."mcp_tokens" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "name" varchar(80) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "last_used_at" timestamptz,
  CONSTRAINT "mcp_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mcp_tokens_token_hash_unique" UNIQUE ("token_hash")
);

CREATE TABLE "public"."review_messages" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "thread_id" uuid NOT NULL,
  "author_id" uuid NOT NULL,
  "body" text NOT NULL,
  "mention_ids" jsonb NOT NULL DEFAULT E'[]',
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "review_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."native_request_cancellations" (
  "operation_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "client_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "source_operation_id" uuid,
  "result" jsonb NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT E'{}',
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "native_request_cancellations_pkey" PRIMARY KEY ("operation_id")
);

CREATE TABLE "public"."review_notifications" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "read" boolean NOT NULL DEFAULT FALSE,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "review_notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."project_database_operations" (
  "project_id" uuid NOT NULL,
  "operation_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "result" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "project_database_operations_project_id_operation_id_pk" PRIMARY KEY ("project_id", "operation_id")
);

CREATE TABLE "public"."project_personal_operations" (
  "operation_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "result" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "project_personal_operations_pkey" PRIMARY KEY ("operation_id")
);

CREATE TABLE "public"."project_personal_states" (
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 0,
  "state" jsonb NOT NULL DEFAULT E'{"views":[],"notes":[],"nodes":[],"viewports":[],"relations":[]}',
  "updated_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "project_personal_states_project_id_user_id_pk" PRIMARY KEY ("project_id", "user_id")
);

CREATE TABLE "public"."projects" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "name" varchar(120) NOT NULL,
  "database_kind" "public"."project_database_kind" NOT NULL DEFAULT E'postgresql',
  "database_profile_id" varchar(80),
  "database_revision" integer NOT NULL DEFAULT 0,
  "status" "public"."project_status" NOT NULL DEFAULT E'active',
  "version" integer NOT NULL DEFAULT 0,
  "sync_sequence" integer NOT NULL DEFAULT 0,
  "document" jsonb NOT NULL DEFAULT E'{"schemaVersion":1,"domains":[],"domainRelations":[],"notes":[],"layout":{"nodes":[],"viewports":[{"viewId":"overview","x":0,"y":0,"zoom":1}]}}',
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."sessions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "last_seen_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_token_hash_unique" UNIQUE ("token_hash")
);

CREATE TABLE "public"."sync_client_baselines" (
  "baseline_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "last_successful_sync_at" timestamptz NOT NULL,
  "last_sequence" integer NOT NULL,
  "database_revision" integer NOT NULL DEFAULT 0,
  "document" jsonb NOT NULL,
  CONSTRAINT "sync_client_baselines_id_unique" UNIQUE ("project_id", "baseline_id")
);

CREATE TABLE "public"."sync_field_versions" (
  "project_id" uuid NOT NULL,
  "path" text NOT NULL,
  "sequence" integer NOT NULL,
  "operation_id" uuid NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "sync_field_versions_project_path_unique" UNIQUE ("project_id", "path")
);

CREATE TABLE "public"."sync_operations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "operation_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "base_sequence" integer NOT NULL,
  "baseline_issued_at" timestamptz NOT NULL,
  "baseline_id" uuid NOT NULL,
  "kind" varchar(16) NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "changes" jsonb NOT NULL,
  "result" jsonb NOT NULL,
  "deletion_snapshot" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sync_operations_project_operation_unique" UNIQUE ("project_id", "operation_id"),
  CONSTRAINT "sync_operations_project_sequence_unique" UNIQUE ("project_id", "sequence")
);

CREATE TABLE "public"."sync_tombstones" (
  "project_id" uuid NOT NULL,
  "object_id" text NOT NULL,
  "operation_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "sync_tombstones_project_object_unique" UNIQUE ("project_id", "object_id")
);

CREATE TABLE "public"."review_threads" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "view_id" text NOT NULL,
  "object_id" text,
  "x" double precision NOT NULL,
  "y" double precision NOT NULL,
  "resolved" boolean NOT NULL DEFAULT FALSE,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "review_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."user_workspaces" (
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" "public"."workspace_role" NOT NULL DEFAULT E'viewer',
  "joined_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "user_workspaces_workspace_id_user_id_pk" PRIMARY KEY ("workspace_id", "user_id")
);

CREATE TABLE "public"."users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "username" varchar(40) NOT NULL,
  "pin_hash" varchar(64) NOT NULL,
  "color" varchar(7) NOT NULL DEFAULT E'#4169e1',
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_username_unique" UNIQUE ("username")
);

CREATE TABLE "public"."workspace_audit_events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "action" varchar(64) NOT NULL,
  "target_user_id" uuid,
  "details" jsonb NOT NULL DEFAULT E'{}',
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "workspace_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."workspace_invitations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "invited_user_id" uuid NOT NULL,
  "invited_by" uuid NOT NULL,
  "role" "public"."workspace_role" NOT NULL DEFAULT E'viewer',
  "status" "public"."workspace_invitation_status" NOT NULL DEFAULT E'pending',
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."workspace" (
  "workspace_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspace_name" varchar(64) NOT NULL,
  "status" "public"."workspace_status" NOT NULL DEFAULT E'active',
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "workspace_pkey" PRIMARY KEY ("workspace_id")
);

ALTER TABLE "public"."mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."review_messages" ADD CONSTRAINT "review_messages_thread_id_review_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."review_threads" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."review_messages" ADD CONSTRAINT "review_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "public"."native_request_cancellations" ADD CONSTRAINT "native_request_cancellations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."native_request_cancellations" ADD CONSTRAINT "native_request_cancellations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "public"."review_notifications" ADD CONSTRAINT "review_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."review_notifications" ADD CONSTRAINT "review_notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."review_notifications" ADD CONSTRAINT "review_notifications_thread_id_review_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."review_threads" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."project_database_operations" ADD CONSTRAINT "project_database_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."project_database_operations" ADD CONSTRAINT "project_database_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "public"."project_personal_operations" ADD CONSTRAINT "project_personal_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."project_personal_operations" ADD CONSTRAINT "project_personal_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."project_personal_states" ADD CONSTRAINT "project_personal_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."project_personal_states" ADD CONSTRAINT "project_personal_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_workspace_id_workspace_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace" ("workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."sync_client_baselines" ADD CONSTRAINT "sync_client_baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."sync_client_baselines" ADD CONSTRAINT "sync_client_baselines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."sync_field_versions" ADD CONSTRAINT "sync_field_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."sync_operations" ADD CONSTRAINT "sync_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."sync_operations" ADD CONSTRAINT "sync_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "public"."sync_tombstones" ADD CONSTRAINT "sync_tombstones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."review_threads" ADD CONSTRAINT "review_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."user_workspaces" ADD CONSTRAINT "user_workspaces_workspace_id_workspace_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace" ("workspace_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "public"."user_workspaces" ADD CONSTRAINT "user_workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "public"."workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspace_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace" ("workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_user_id_users_id_fk" FOREIGN KEY ("invited_user_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "public"."workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMENT ON COLUMN "public"."review_messages"."mention_ids" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."native_request_cancellations"."result" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."native_request_cancellations"."metadata" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."project_database_operations"."result" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."project_personal_operations"."result" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."project_personal_states"."state" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."projects"."document" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."sync_client_baselines"."document" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."sync_operations"."changes" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."sync_operations"."result" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."sync_operations"."deletion_snapshot" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."sync_tombstones"."snapshot" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON COLUMN "public"."workspace_audit_events"."details" IS E'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님';

COMMENT ON TABLE "public"."workspace_audit_events" IS E'감사 기록 보존을 위해 workspace_id, actor_id, target_user_id에 물리 FK 없음';

