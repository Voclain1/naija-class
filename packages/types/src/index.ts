// Barrel for all shared types + Zod schemas. New modules add re-exports here
// as they land. Keep this file flat — no logic, just re-exports.

export * from './errors.js';
export * from './permissions.js';
export * from './auth/index.js';
export * from './onboarding/index.js';
export * from './invitations/index.js';
export * from './academic-years/index.js';
export * from './class-levels/index.js';
export * from './class-arms/index.js';
export * from './subjects/index.js';
export * from './class-subjects/index.js';