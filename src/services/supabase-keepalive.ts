import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export interface KeepAliveResult {
  success: boolean;
  timestamp: string;
  durationMs: number;
  table: string;
  operation: string;
  insertedId?: string;
  deleted: boolean;
  message: string;
  error?: string;
}

export class SupabaseKeepAliveService {
  private client: SupabaseClient | null = null;

  private getClient(): SupabaseClient {
    if (this.client) return this.client;

    const key = config.supabase.serviceRoleKey || config.supabase.anonKey;
    if (!config.supabase.url || !key) {
      throw new Error(
        "Supabase credentials not set in .env. Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY."
      );
    }

    this.client = createClient(config.supabase.url, key, {
      auth: { persistSession: false },
    });
    return this.client;
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
   * Execute the daily keep-alive heartbeat:
   * 1. Inserts a dummy row
   * 2. Confirms active write
   * 3. Deletes the dummy row immediately
   */
  async executeHeartbeat(tableName?: string): Promise<KeepAliveResult> {
    const table = tableName || config.supabase.heartbeatTable;
    const start = Date.now();
    const timestamp = new Date().toISOString();
    const dummyId = `ping_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    try {
      const supabase = this.getClient();

      // Test general connectivity / table presence
      const pingTest = await supabase.from(table).select("*").limit(1);

      if (pingTest.error) {
        // If table doesn't exist, we provide clear guidance or try fallback table
        return {
          success: false,
          timestamp,
          durationMs: Date.now() - start,
          table,
          operation: "CONNECTIVITY_CHECK",
          deleted: false,
          message: `Supabase reached, but table '${table}' returned error: ${pingTest.error.message}. (If table doesn't exist yet, create it or specify an existing table name in .env SUPABASE_HEARTBEAT_TABLE)`,
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

      // Try inserting with dummy payload
      const insertRes = await supabase.from(table).insert([payload]).select();

      if (insertRes.error) {
        // If schema doesn't have name/metadata columns, try a generic single column or ping
        const fallbackRes = await supabase.from(table).select("count", { count: "exact", head: true });
        return {
          success: true,
          timestamp,
          durationMs: Date.now() - start,
          table,
          operation: "DATABASE_PING_READ",
          deleted: false,
          message: `Write rejected by schema constraint (${insertRes.error.message}), but database ping registered active query activity successfully.`,
        };
      }

      const inserted = insertRes.data?.[0];
      const rowId = inserted?.id || dummyId;

      // Step 2: Delete dummy row if configured
      let deleted = false;
      if (config.supabase.deleteDummyAfterInsert) {
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
        table,
        operation: "INSERT_AND_DELETE_DUMMY_ROW",
        insertedId: String(rowId),
        deleted,
        message: `Successfully inserted dummy row (ID: ${rowId}) and ${
          deleted ? "deleted it immediately" : "retained it"
        }. Database marked active.`,
      };
    } catch (err: any) {
      return {
        success: false,
        timestamp,
        durationMs: Date.now() - start,
        table,
        operation: "HEARTBEAT_FAILED",
        deleted: false,
        message: `Heartbeat execution failed: ${err.message || String(err)}`,
        error: err.message || String(err),
      };
    }
  }
}
