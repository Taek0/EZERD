import { BadRequestException, ConflictException } from '@nestjs/common';
import { rawDesignDocumentReadSchema } from '@ezerd/contracts';
import type { NativeDesignDocument, ProjectDatabaseState } from '@ezerd/model';

function freezeDocument<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDocument(child);
    Object.freeze(value);
  }
  return value;
}

/** Only shared native source is cached. Callers must authorize and read the head first. */
export class NativeQueryCache {
  private readonly entries = new Map<string, { document: NativeDesignDocument; bytes: number }>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = 32,
    private readonly maxBytes = 16 * 1024 * 1024,
  ) {}

  get(key: string): NativeDesignDocument | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.document;
  }

  parse(key: string, raw: unknown, database: ProjectDatabaseState): NativeDesignDocument {
    const parsed = rawDesignDocumentReadSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ code: 'document.source-invalid' });
    if (parsed.data.schemaVersion !== 2)
      throw new ConflictException({
        code: 'document.native-upgrade-required',
        message:
          '이 조회 도구는 native v2 설계를 사용합니다. get_project_document_state로 원본을 확인하고 명시적으로 변환해 주세요.',
      });
    if (
      parsed.data.database.kind !== database.kind ||
      parsed.data.database.profileId !== database.profileId
    )
      throw new ConflictException({
        code: 'database.context-changed',
        message: '현재 DB 설정과 native 문서를 확인해 주세요.',
      });
    // Query consumers historically receive the exact source, including whitespace,
    // imported aliases and legacy payloads. Validation must never canonicalize it.
    const document = freezeDocument(structuredClone(parsed.data));
    const bytes = Buffer.byteLength(JSON.stringify(document));
    // Oversized entries can be served, but may never evict the entire useful cache.
    if (this.maxEntries < 1 || bytes > this.maxBytes) return document;
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { document, bytes });
    this.bytes += bytes;
    return document;
  }
}
