import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export interface RepoSchemaInfo {
  repoName: string;
  repoPath: string;
  foundFiles: string[];
  tablesDetected: string[];
}

export interface LiveTableInfo {
  tableName: string;
  projectId?: string;
  projectName?: string;
  rowCountEstimate?: number;
  accessible: boolean;
  status: string;
}

export class SchemaInventoryService {
  /**
   * Scan adjacent local Git repositories for migration files and table definitions
   */
  static async scanLocalRepos(): Promise<RepoSchemaInfo[]> {
    const parentDir = path.resolve(config.rootDir, "..");
    const targetRepos = [
      "ambiakshi-home",
      "ambiakshi-tools",
      "ambiakshi-slm",
      "ambiakshi-mobile",
    ];

    const results: RepoSchemaInfo[] = [];

    for (const repo of targetRepos) {
      const repoPath = path.join(parentDir, repo);
      const tablesDetected = new Set<string>();
      const foundFiles: string[] = [];

      try {
        await fs.access(repoPath);
      } catch {
        results.push({
          repoName: repo,
          repoPath,
          foundFiles: [],
          tablesDetected: [],
        });
        continue;
      }

      // Check standard migration directories
      const candidatePaths = [
        path.join(repoPath, "supabase", "migrations"),
        path.join(repoPath, "prisma"),
        path.join(repoPath, "drizzle"),
        path.join(repoPath, "migrations"),
        path.join(repoPath, "sql"),
      ];

      for (const dir of candidatePaths) {
        try {
          const files = await fs.readdir(dir);
          for (const file of files) {
            if (file.endsWith(".sql") || file.endsWith(".prisma") || file.endsWith(".ts")) {
              const fullPath = path.join(dir, file);
              foundFiles.push(path.relative(repoPath, fullPath));

              // Read file content and extract table names
              const content = await fs.readFile(fullPath, "utf8");
              const tableMatches = content.matchAll(
                /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["`]?([a-zA-Z0-9_]+)["`]?/gi
              );
              for (const m of tableMatches) {
                if (m[1]) tablesDetected.add(m[1].toLowerCase());
              }
            }
          }
        } catch {
          // Directory does not exist in this repo
        }
      }

      results.push({
        repoName: repo,
        repoPath,
        foundFiles,
        tablesDetected: Array.from(tablesDetected),
      });
    }

    return results;
  }

  /**
   * Probe Supabase databases across all configured projects to test accessibility of candidate tables
   */
  static async probeLiveTables(candidateTables: string[]): Promise<LiveTableInfo[]> {
    const projects = config.supabase.projects.length > 0
      ? config.supabase.projects
      : config.supabase.url && (config.supabase.serviceRoleKey || config.supabase.anonKey)
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

    if (projects.length === 0) {
      return [];
    }

    const results: LiveTableInfo[] = [];

    for (const project of projects) {
      const key = project.serviceRoleKey || project.anonKey;
      if (!project.url || !key) continue;

      try {
        const supabase = createClient(project.url, key, { auth: { persistSession: false } });

        for (const table of candidateTables) {
          try {
            const { count, error } = await supabase
              .from(table)
              .select("*", { count: "exact" })
              .limit(1);

            if (error) {
              results.push({
                tableName: table,
                projectId: project.id,
                projectName: project.name,
                accessible: false,
                status: error.message,
              });
            } else {
              results.push({
                tableName: table,
                projectId: project.id,
                projectName: project.name,
                rowCountEstimate: count ?? 0,
                accessible: true,
                status: "200 OK",
              });
            }
          } catch (err: any) {
            results.push({
              tableName: table,
              projectId: project.id,
              projectName: project.name,
              accessible: false,
              status: err?.message || String(err),
            });
          }
        }
      } catch (err: any) {
        console.warn(`Could not connect to project '${project.name}':`, err.message || err);
      }
    }

    return results;
  }
}
