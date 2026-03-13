import crypto from "crypto";
import { getServerEnv } from "../env";

type TrackingPayload = {
  email: string;
  iat: number;
};

function getSecret() {
  const env = getServerEnv();
  if (env.TRACKING_TOKEN_SECRET) {
    return env.TRACKING_TOKEN_SECRET;
  }

  if (process.env.NODE_ENV !== "production") {
    return "dev-tracking-secret-change-me";
  }

  throw new Error("TRACKING_TOKEN_SECRET is required in production.");
}

function toBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function createTrackingToken(email: string): string {
  const payload: TrackingPayload = { email: email.toLowerCase(), iat: Date.now() };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload, getSecret());
  return `${encodedPayload}.${signature}`;
}

export function readTrackingToken(token: string): TrackingPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = sign(encodedPayload, getSecret());
  if (!safeEqual(expectedSignature, signature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload)) as TrackingPayload;
    if (!parsed.email || typeof parsed.email !== "string") return null;
    if (!parsed.iat || typeof parsed.iat !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}
