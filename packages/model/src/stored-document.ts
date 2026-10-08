import type { DesignDocument } from './document.js';
import type { NativeDesignDocument } from './database/native-document.js';

/** Persisted JSON can be historical v1 or Native v2; narrow by schemaVersion before use. */
export type StoredDesignDocument = DesignDocument | NativeDesignDocument;
