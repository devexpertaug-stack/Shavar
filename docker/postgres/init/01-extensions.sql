-- Enable extensions required by EstateFlow.
-- pgvector: inventory/unit embeddings for property matching (Task 9).
CREATE EXTENSION IF NOT EXISTS vector;
-- pgcrypto: gen_random_uuid() and crypto helpers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
