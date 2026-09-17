import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config, SupabaseProject } from "../config.js";

export interface KeepAliveResult {
  success: boolean;
  timestamp: string;
  durationMs: number;
  projectId?: string;
  projectName?: string;
  table: string;
  operation: string;
  insertedId?: string;
  deleted: boolean;
  message: string;
  error?: string;
}

export class SupabaseKeepAliveService {
  private clients: Map<string, SupabaseClient> = new Map();

  private getClientForProject(project: SupabaseProject): SupabaseClient {
    const cached = this.clients.get(project.id);
    if (cached) return cached;

    const key = project.serviceRoleKey || project.anonKey;
    if (!project.url || !key) {
      throw new Error(
        `Supabase credentials not configured for project '${project.name}'. Please set URL and service/anon key.`
      );
    }

    const client = createClient(project.url, key, {
      auth: { persistSession: false },
    });
    this.clients.set(project.id, client);
    return client;
  }

  /**
   * Unpause a suspended Supabase project via the Supabase Management API
   */
  static async restoreSuspendedProject(
    projectRef: string,
    managementToken: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/restore`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const errorText = await res.text();
        return {
          success: false,
          message: `Restore API call failed (HTTP ${res.status}): ${errorText}`,
        };
      }

      return {
        success: true,
        message: "Project restoration triggered successfully. Please allow 1-2 minutes for PostgreSQL to initialize.",
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Restore request failed: ${err.message || String(err)}`,
      };
    }
  }

  /**
   * Execute keep-alive heartbeat on a single project or table
   */
  async executeHeartbeat(
    target?: SupabaseProject | string
  ): Promise<KeepAliveResult> {
    let project: SupabaseProject;
    let customTable: string | undefined;

    if (typeof target === "string") {
      customTable = target;
      project = config.supabase.projects[0] || {
        id: "primary",
        name: "Primary Database",
        url: config.supabase.url,
        serviceRoleKey: config.supabase.serviceRoleKey,
        anonKey: config.supabase.anonKey,
        heartbeatTable: customTable || config.supabase.heartbeatTable,
        deleteDummyAfterInsert: config.supabase.deleteDummyAfterInsert,
      };
    } else if (target) {
      project = target;
    } else {
      project = config.supabase.projects[0] || {
        id: "primary",
        name: "Primary Database",
        url: config.supabase.url,
        serviceRoleKey: config.supabase.serviceRoleKey,
        anonKey: config.supabase.anonKey,
        heartbeatTable: config.supabase.heartbeatTable,
        deleteDummyAfterInsert: config.supabase.deleteDummyAfterInsert,
      };
    }

    const table = customTable || project.heartbeatTable || "_ambiakshi_heartbeat";
    const start = Date.now();
    const timestamp = new Date().toISOString();
    const dummyId = `ping_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    try {
      const supabase = this.getClientForProject(project);

      // Test general connectivity / table presence
      const pingTest = await supabase.from(table).select("*").limit(1);

      if (pingTest.error) {
        // Tailor fallback candidates to the specific project schema
        const candidateFallbacks =
          project.id === "tools" || project.url?.includes("aglvpztrnfaaxtjdajoh")
            ? ["subscriptions", "user", "session", "account", "verification"]
            : ["feedback_submissions", "telemetry_events", "consultation_leads", "subscribers", "slm_ticker_history"];

        for (const candidate of candidateFallbacks) {
          try {
            const fallbackTest = await supabase
              .from(candidate)
              .select("*", { count: "exact" })
              .limit(1);
            if (!fallbackTest.error) {
              return {
                success: true,
                timestamp,
                durationMs: Date.now() - start,
                projectId: project.id,
                projectName: project.name,
                table: candidate,
                operation: "FALLBACK_TABLE_PROBE",
                deleted: false,
                message: `[${project.name}] Heartbeat table '${table}' missing, but active table probe on '${candidate}' succeeded (${fallbackTest.count ?? 0} rows). Database registered active compute.`,
              };
            }
          } catch {
            // continue probing next candidate
          }
        }

        return {
          success: false,
          timestamp,
          durationMs: Date.now() - start,
          projectId: project.id,
          projectName: project.name,
          table,
          operation: "CONNECTIVITY_CHECK",
          deleted: false,
          message: `[${project.name}] Supabase reached, but table '${table}' returned error: ${pingTest.error.message}.`,
          error: pingTest.error.message,
        };
      }

      // Step 1: Insert dummy row
      const payload: Record<string, any> = {
        name: `Heartbeat ${dummyId}`,
        description: "Ambiakshi automated daily keepalive heartbeat",
        metadata: {
          dummyId,
          timestamp,
          automated: true,
          agent: "ambiakshi-maintenance-bot",
        },
      };

      const insertRes = await supabase.from(table).insert([payload]).select();

      if (insertRes.error) {
        // Ping read fallback
        await supabase.from(table).select("count", { count: "exact", head: true });
        return {
          success: true,
          timestamp,
          durationMs: Date.now() - start,
          projectId: project.id,
          projectName: project.name,
          table,
          operation: "DATABASE_PING_READ",
          deleted: false,
          message: `[${project.name}] Write rejected by schema constraint (${insertRes.error.message}), but database ping registered active query activity successfully.`,
        };
      }

      const inserted = insertRes.data?.[0];
      const rowId = inserted?.id || dummyId;

      // Step 2: Delete dummy row if configured
      let deleted = false;
      if (project.deleteDummyAfterInsert) {
        let deleteQuery = supabase.from(table).delete();
        if (inserted?.id !== undefined) {
          deleteQuery = deleteQuery.eq("id", inserted.id);
        } else {
          deleteQuery = deleteQuery.filter("metadata->>dummyId", "eq", dummyId);
        }

        const deleteRes = await deleteQuery;
        deleted = !deleteRes.error;
      }

      return {
        success: true,
        timestamp,
        durationMs: Date.now() - start,
        projectId: project.id,
        projectName: project.name,
        table,
        operation: "INSERT_AND_DELETE_DUMMY_ROW",
        insertedId: String(rowId),
        deleted,
        message: `[${project.name}] Successfully inserted dummy row (ID: ${rowId}) and ${
          deleted ? "deleted it immediately" : "retained it"
        }. Database marked active.`,
      };
    } catch (err: any) {
      return {
        success: false,
        timestamp,
        durationMs: Date.now() - start,
        projectId: project.id,
        projectName: project.name,
        table,
        operation: "HEARTBEAT_FAILED",
        deleted: false,
        message: `[${project.name}] Heartbeat failed: ${err.message || String(err)}`,
        error: err.message || String(err),
      };
    }
  }

  /**
   * Execute keep-alive heartbeats across all configured Supabase projects
   */
  async executeAllHeartbeats(): Promise<KeepAliveResult[]> {
    const projects = config.supabase.projects;
    if (projects.length === 0) {
      if (config.supabase.url && (config.supabase.serviceRoleKey || config.supabase.anonKey)) {
        return [await this.executeHeartbeat()];
      }
      return [];
    }

    const results: KeepAliveResult[] = [];
    for (const proj of projects) {
      const res = await this.executeHeartbeat(proj);
      results.push(res);
    }
    return results;
  }
}
