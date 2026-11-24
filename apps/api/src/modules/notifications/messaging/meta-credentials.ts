import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function metaTokenKey(value: string | undefined): Buffer | undefined {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return undefined;
  const key = Buffer.from(value, "base64");
  return key.length === 32 ? key : undefined;
}

export function sealMetaToken(key: Buffer, schoolId: string, wabaId: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify([schoolId, wabaId])));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function openMetaToken(key: Buffer, schoolId: string, wabaId: string, sealed: string): string {
  const [iv, tag, encrypted, extra] = sealed.split(".");
  if (!iv || !tag || !encrypted || extra !== undefined) throw new Error("Invalid Meta credential envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(JSON.stringify([schoolId, wabaId])));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
