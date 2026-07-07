-- Enable required extensions on database creation.
-- pgvector is used for AI/RAG (Phase 5); uuid-ossp for UUID generation.
-- pgcrypto backs BVN column encryption (Phase 3 / Slice 12) via
-- pgp_sym_encrypt/pgp_sym_decrypt, wrapped by the encrypt_bvn/decrypt_bvn
-- SECURITY DEFINER functions — see CLAUDE.md "SECURITY DEFINER functions — index".
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
