import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PublishHistoryRecord } from "../shared/desktopApi";
import { isLocale, type Locale } from "../shared/i18n.ts";

interface HistoryStore {
  add(record: PublishHistoryRecord): Promise<void>;
  list(): Promise<PublishHistoryRecord[]>;
  close(): void;
}

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  all(): unknown[];
};

type SqliteDatabase = {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
};

type NodeSqliteModule = {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

type StoredPublishHistoryRecord = Omit<PublishHistoryRecord, "viewerLanguage"> & {
  viewerLanguage?: Locale | null;
};

class SqliteHistoryStore implements HistoryStore {
  private readonly db: SqliteDatabase;

  constructor(dbPath: string, sqlite: NodeSqliteModule) {
    this.db = new sqlite.DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS publish_history (
        document_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        issuer TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        display_expires_at TEXT,
        package_sha256 TEXT NOT NULL,
        kdf TEXT NOT NULL,
        iterations INTEGER NOT NULL,
        content_alg TEXT NOT NULL,
        created_by TEXT NOT NULL,
        output_path TEXT NOT NULL,
        platform TEXT NOT NULL,
        viewer_language TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const columns = this.db.prepare("PRAGMA table_info(publish_history)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "viewer_language")) {
      this.db.exec("ALTER TABLE publish_history ADD COLUMN viewer_language TEXT");
    }
  }

  async add(record: PublishHistoryRecord): Promise<void> {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO publish_history (
          document_id,
          title,
          issuer,
          issued_at,
          display_expires_at,
          package_sha256,
          kdf,
          iterations,
          content_alg,
          created_by,
          output_path,
          platform,
          viewer_language
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.documentId,
        record.title,
        record.issuer,
        record.issuedAt,
        record.displayExpiresAt ?? null,
        record.packageSha256,
        record.kdf,
        record.iterations,
        record.contentAlg,
        record.createdBy,
        record.outputPath,
        record.platform,
        record.viewerLanguage ?? null
      );
  }

  async list(): Promise<PublishHistoryRecord[]> {
    const rows = this.db
      .prepare(`
        SELECT
          document_id AS documentId,
          title,
          issuer,
          issued_at AS issuedAt,
          display_expires_at AS displayExpiresAt,
          package_sha256 AS packageSha256,
          kdf,
          iterations,
          content_alg AS contentAlg,
          created_by AS createdBy,
          output_path AS outputPath,
          platform,
          viewer_language AS viewerLanguage
        FROM publish_history
        ORDER BY issued_at DESC
        LIMIT 100
      `)
      .all() as StoredPublishHistoryRecord[];

    return rows.map((row) => ({
      ...row,
      viewerLanguage: isLocale(row.viewerLanguage) ? row.viewerLanguage : undefined
    }));
  }

  close(): void {
    this.db.close();
  }
}

class JsonlHistoryStore implements HistoryStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async add(record: PublishHistoryRecord): Promise<void> {
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  async list(): Promise<PublishHistoryRecord[]> {
    try {
      const text = await readFile(this.filePath, "utf8");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PublishHistoryRecord)
        .reverse()
        .slice(0, 100);
    } catch {
      return [];
    }
  }

  close(): void {}
}

export async function createHistoryStore(userDataPath: string): Promise<HistoryStore> {
  await mkdir(userDataPath, { recursive: true });

  try {
    const sqlite = (await import("node:sqlite")) as NodeSqliteModule;
    return new SqliteHistoryStore(join(userDataPath, "publish-history.sqlite"), sqlite);
  } catch {
    return new JsonlHistoryStore(join(userDataPath, "publish-history.jsonl"));
  }
}

