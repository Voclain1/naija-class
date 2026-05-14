-- Enable required extensions on database creation.
-- pgvector is used for AI/RAG (Phase 5); uuid-ossp for UUID generation.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
