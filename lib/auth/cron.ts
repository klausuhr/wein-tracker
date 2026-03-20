import { getServerEnv } from "../env";

export function isCronAuthorized(request: Request): boolean {
  const env = getServerEnv();
  if (!env.CRON_SECRET) return true;

  const authHeader = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-cron-secret");
  const bearerExpected = `Bearer ${env.CRON_SECRET}`;

  return authHeader === bearerExpected || secretHeader === env.CRON_SECRET;
}
