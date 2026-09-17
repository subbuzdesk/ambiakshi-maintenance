import tls from "node:tls";
import { config } from "../config.js";

export interface SslCheckResult {
  domain: string;
  isOk: boolean;
  issuer?: string;
  subject?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining?: number;
  status: "HEALTHY" | "EXPIRING_SOON" | "EXPIRED" | "ERROR";
  errorMessage?: string;
}

export class SslCheckerService {
  /**
   * Check SSL certificate validity for a single domain
   */
  static async checkDomain(
    domain: string,
    port: number = 443,
    timeoutMs: number = 8000
  ): Promise<SslCheckResult> {
    // Strip protocol if mistakenly passed
    const cleanDomain = domain.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];

    return new Promise((resolve) => {
      let resolved = false;

      const socket = tls.connect(
        {
          host: cleanDomain,
          port,
          servername: cleanDomain,
          rejectUnauthorized: false, // We inspect the raw cert properties
          timeout: timeoutMs,
        },
        () => {
          if (resolved) return;
          resolved = true;

          try {
            const cert = socket.getPeerCertificate();
            socket.destroy();

            if (!cert || Object.keys(cert).length === 0) {
              return resolve({
                domain: cleanDomain,
                isOk: false,
                status: "ERROR",
                errorMessage: "No SSL peer certificate presented by server",
              });
            }

            const validFrom = cert.valid_from;
            const validTo = cert.valid_to;
            const validToDate = new Date(validTo);
            const now = new Date();
            const msRemaining = validToDate.getTime() - now.getTime();
            const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));

            let status: SslCheckResult["status"] = "HEALTHY";
            if (daysRemaining <= 0) {
              status = "EXPIRED";
            } else if (daysRemaining <= config.sslExpiryWarningDays) {
              status = "EXPIRING_SOON";
            }

            const formatCertField = (field: any): string => {
              if (!field) return "";
              if (typeof field === "string") return field;
              if (Array.isArray(field)) return field.join(", ");
              if (typeof field === "object") {
                const val = field.O || field.CN || field.OU || JSON.stringify(field);
                return Array.isArray(val) ? val.join(", ") : String(val);
              }
              return String(field);
            };

            const issuer = formatCertField(cert.issuer);
            const subject = formatCertField(cert.subject);

            resolve({
              domain: cleanDomain,
              isOk: status === "HEALTHY",
              issuer,
              subject,
              validFrom,
              validTo,
              daysRemaining,
              status,
            });
          } catch (err: any) {
            resolve({
              domain: cleanDomain,
              isOk: false,
              status: "ERROR",
              errorMessage: err?.message || String(err),
            });
          }
        }
      );

      socket.on("error", (err) => {
        if (resolved) return;
        resolved = true;
        socket.destroy();
        resolve({
          domain: cleanDomain,
          isOk: false,
          status: "ERROR",
          errorMessage: err.message,
        });
      });

      socket.on("timeout", () => {
        if (resolved) return;
        resolved = true;
        socket.destroy();
        resolve({
          domain: cleanDomain,
          isOk: false,
          status: "ERROR",
          errorMessage: `Connection timed out after ${timeoutMs}ms`,
        });
      });
    });
  }

  /**
   * Check all configured ecosystem domains
   */
  static async checkAllDomains(domains?: string[]): Promise<SslCheckResult[]> {
    const targetDomains = domains || config.monitoredDomains;
    const results: SslCheckResult[] = [];

    for (const domain of targetDomains) {
      const res = await this.checkDomain(domain);
      results.push(res);
    }

    return results;
  }
}
