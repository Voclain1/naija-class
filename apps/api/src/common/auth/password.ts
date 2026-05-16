import * as argon2 from "argon2";

// Thin wrapper around argon2 so tests can spy on these functions. The
// argon2 package ships as CommonJS with non-configurable exports, which
// means vi.spyOn(argon2, 'verify') throws "Cannot redefine property".
// Re-exporting through this ESM module makes the bindings spy-able.
//
// All hashing in the codebase MUST go through here — never call argon2
// directly from a service. That keeps the audit surface for password
// handling to one file.

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
