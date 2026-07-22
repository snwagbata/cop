-- Extensions used throughout the schema:
--   pgcrypto   -> gen_random_uuid() for primary keys
--   btree_gist -> equality operator classes needed by the GiST exclusion
--                 constraint on officer_department_history (DESIGN.md §4/§6)
--   pg_trgm    -> trigram indexes for fuzzy officer-name matching (DESIGN.md §6)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
