import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config, SupabaseProject } from "../config.js";
import { SchemaInventoryService } from "./schema-inventory.js";

export interface TableBackupResult {
  tableName: string;
  rowCount: number;
  success: boolean;
  errorMessage?: string;
}

export interface ProjectBackupResult {
  projectId: string;
  projectName: string;
  timestamp: string;
  backupFilePath?: string;
  fileSizeBytes: number;
  compressedSha256?: string;
  tables: TableBackupResult[];
  totalRows: number;
  success: boolean;
  errorMessage?: string;
}

export interface SupabaseBackupSummary {
  timestamp: string;
  durationSeconds: number;
  projects: ProjectBackupResult[];
  totalRowsDumped: number;
  totalBytesWritten: number;
  allSuccessful: boolean;
}

export class BackupService {
  /**
   * Ensure necessary backup directories exist
   */
  static async ensureDirectories(): Promise<void> {
    await fs.mkdir(config.backupSupabaseDir, { recursive: true });
    for (const p of config.supabase.projects) {
      await fs.mkdir(path.join(config.backupSupabaseDir, p.id), { recursive: true });
    }
  }

  /**
   * Backup a single Supabase project
   */
  static async backupProject(
    project: SupabaseProject,
    candidateTables: string[]
  ): Promise<ProjectBackupResult> {
    const key = project.serviceRoleKey || project.anonKey;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (!project.url || !key) {
      return {
        projectId: project.id,
        projectName: project.name,
        timestamp,
        fileSizeBytes: 0,
        tables: [],
        totalRows: 0,
        success: false,
        errorMessage: "Missing Supabase URL or access key",
      };
    }

    try {
      const supabase: SupabaseClient = createClient(project.url, key, {
        auth: { persistSession: false },
      });

      const projectBackupDir = path.join(config.backupSupabaseDir, project.id);
      await fs.mkdir(projectBackupDir, { recursive: true });

      const tableDumps: Record<string, any[]> = {};
      const tableResults: TableBackupResult[] = [];
      let totalRows = 0;

      for (const table of candidateTables) {
        try {
          // Verify table exists and retrieve rows (batched)
          const rows: any[] = [];
          const batchSize = 1000;
          let offset = 0;
          let hasMore = true;

          while (hasMore) {
            const { data, error } = await supabase
              .from(table)
              .select("*")
              .range(offset, offset + batchSize - 1);

            if (error) {
              // Table might not exist or be accessible in this project
              tableResults.push({
                tableName: table,
                rowCount: 0,
                success: false,
                errorMessage: error.message,
              });
              hasMore = false;
              break;
            }

            if (data && data.length > 0) {
              rows.push(...data);
              offset += data.length;
              if (data.length < batchSize) {
                hasMore = false;
              }
            } else {
              hasMore = false;
            }
          }

          if (rows.length > 0 || !tableResults.some((t) => t.tableName === table)) {
            tableDumps[table] = rows;
            totalRows += rows.length;
            tableResults.push({
              tableName: table,
              rowCount: rows.length,
              success: true,
            });
          }
        } catch (err: any) {
          tableResults.push({
            tableName: table,
            rowCount: 0,
            success: false,
            errorMessage: err?.message || String(err),
          });
        }
      }

      // Filter out tables that returned 0 rows AND were marked inaccessible
      const accessibleTables = tableResults.filter((t) => t.success);

      // Create snapshot payload
      const snapshotPayload = {
        metadata: {
          projectId: project.id,
          projectName: project.name,
          url: project.url,
          timestamp: new Date().toISOString(),
          accessibleTablesCount: accessibleTables.length,
          totalRows,
        },
        tables: tableDumps,
      };

      const jsonStr = JSON.stringify(snapshotPayload, null, 2);
      const compressedBuffer = zlib.gzipSync(Buffer.from(jsonStr, "utf8"));
      const sha256 = crypto.createHash("sha256").update(compressedBuffer).digest("hex");

      const fileName = `${project.id}_backup_${timestamp}.json.gz`;
      const filePath = path.join(projectBackupDir, fileName);
      await fs.writeFile(filePath, compressedBuffer);

      // Write latest manifest
      const manifestPath = path.join(projectBackupDir, "latest_manifest.json");
      await fs.writeFile(
        manifestPath,
        JSON.stringify(
          {
            latestFile: fileName,
            timestamp: new Date().toISOString(),
            fileSizeBytes: compressedBuffer.byteLength,
            sha256,
            totalRows,
            tables: accessibleTables,
          },
          null,
          2
        )
      );

      // Enforce retention pruning
      await this.pruneOldBackups(projectBackupDir, config.backupRetentionDays);

      return {
        projectId: project.id,
        projectName: project.name,
        timestamp,
        backupFilePath: filePath,
        fileSizeBytes: compressedBuffer.byteLength,
        compressedSha256: sha256,
        tables: tableResults,
        totalRows,
        success: true,
      };
    } catch (err: any) {
      return {
        projectId: project.id,
        projectName: project.name,
        timestamp,
        fileSizeBytes: 0,
        tables: [],
        totalRows: 0,
        success: false,
        errorMessage: err?.message || String(err),
      };
    }
  }

  /**
   * Run backup across all configured Supabase projects
   */
  static async backupAllProjects(): Promise<SupabaseBackupSummary> {
    const startTime = Date.now();
    await this.ensureDirectories();

    // 1. Discover all candidate table names from sibling repos
    const repoSchemas = await SchemaInventoryService.scanLocalRepos();
    const candidateSet = new Set<string>();
    for (const r of repoSchemas) {
      for (const t of r.tablesDetected) {
        candidateSet.add(t);
      }
    }

    // Common standard tables in Ambiakshi ecosystem
    const standardTables = [
      "_ambiakshi_heartbeat",
      "profiles",
      "tools",
      "tool_usage",
      "logs",
      "users",
      "accounts",
      "sessions",
      "feedback",
      "audit_logs",
    ];
    for (const st of standardTables) candidateSet.add(st);

    const candidateTables = Array.from(candidateSet);
    const results: ProjectBackupResult[] = [];

    const projects = config.supabase.projects.length > 0
      ? config.supabase.projects
      : config.supabase.url
      ? [{
          id: "primary",
          name: "Primary Database",
          url: config.supabase.url,
          serviceRoleKey: config.supabase.serviceRoleKey,
          anonKey: config.supabase.anonKey,
          heartbeatTable: config.supabase.heartbeatTable,
          deleteDummyAfterInsert: config.supabase.deleteDummyAfterInsert,
        }]
      : [];

    for (const project of projects) {
      const res = await this.backupProject(project, candidateTables);
      results.push(res);
    }

    const durationSeconds = (Date.now() - startTime) / 1000;
    const totalRowsDumped = results.reduce((acc, r) => acc + r.totalRows, 0);
    const totalBytesWritten = results.reduce((acc, r) => acc + r.fileSizeBytes, 0);
    const allSuccessful = results.length > 0 && results.every((r) => r.success);

    return {
      timestamp: new Date().toISOString(),
      durationSeconds,
      projects: results,
      totalRowsDumped,
      totalBytesWritten,
      allSuccessful,
    };
  }

  /**
   * Prune backups older than retentionDays
   */
  private static async pruneOldBackups(dirPath: string, retentionDays: number): Promise<number> {
    try {
      const files = await fs.readdir(dirPath);
      const backupFiles = files.filter((f) => f.endsWith(".json.gz"));
      if (backupFiles.length <= 1) return 0;

      const now = Date.now();
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
      let prunedCount = 0;

      for (const file of backupFiles) {
        const fullPath = path.join(dirPath, file);
        const stat = await fs.stat(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.unlink(fullPath);
          prunedCount++;
        }
      }

      return prunedCount;
    } catch {
      return 0;
    }
  }
}
