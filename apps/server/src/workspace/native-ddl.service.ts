import {
  Injectable,
  Inject,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { projectDDLExportSchema } from '@ezerd/contracts';
import {
  exportNativeDatabaseDDL,
  exportPostgres,
  resolveProjectDatabaseState,
  type DesignDocument,
  type DatabaseIssue,
} from '@ezerd/model';
import { projects } from '../db/schema.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { readNativeProjectDocument } from '../shared/native-document-reader.js';

@Injectable()
export class NativeDDLService {
  constructor(@Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService) {}
  exportProject(actorId: string, projectId: string) {
    return this.access.runProject(actorId, projectId, 'read', async (tx) => {
      const [row] = await tx.select().from(projects).where(eq(projects.id, projectId));
      if (!row) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      const database = resolveProjectDatabaseState(row),
        read = readNativeProjectDocument(row.document, database);
      let sql = '',
        canExport = false,
        issues: DatabaseIssue[] = [];
      if (read.status !== 'available')
        issues.push({
          code: read.code,
          category: 'unsupported',
          severity: 'error',
          objectId: null,
          path: '/',
          params: {},
        });
      else if (read.stored.schemaVersion === 1 && database.kind === 'postgresql') {
        const result = exportPostgres(read.rawSource as DesignDocument);
        sql = result.sql;
        canExport = result.canExport;
        issues = result.diagnostics.map((issue) => ({
          code: issue.code,
          objectId: issue.objectId || null,
          path: '/',
          params: { message: issue.message },
          category: 'invalid',
          severity: 'error',
        }));
      } else if (read.stored.schemaVersion === 1)
        issues.push({
          code: 'document.native-upgrade-required',
          category: 'unsupported',
          severity: 'error',
          objectId: null,
          path: '/',
          params: {},
        });
      else {
        const result = exportNativeDatabaseDDL(read.stored);
        sql = result.sql;
        canExport = result.canExport;
        issues = result.issues;
      }
      const name =
        row.name
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
          .replace(/[. ]+$/g, '')
          .slice(0, 120) || 'project';
      const result = projectDDLExportSchema.safeParse({
        projectId,
        projectName: row.name,
        version: row.version,
        sequence: row.syncSequence,
        database,
        documentSchemaVersion: read.stored.schemaVersion,
        filename: `${name}.${database.kind}.sql`,
        encoding: 'UTF-8',
        sql: canExport ? sql : '',
        canExport,
        issues,
      });
      if (!result.success) throw new UnprocessableEntityException({ code: 'ddl.result-invalid' });
      return result.data;
    });
  }
}
