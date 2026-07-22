/**
 * The public read-only API this app consumes (DESIGN.md §8). Configurable
 * via VITE_API_BASE_URL so the API location can be repointed without a code
 * change (e.g. staging vs local vs production).
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")) ||
  "http://localhost:4001";
