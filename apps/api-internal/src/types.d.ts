import type { Reviewer } from "@cop/shared-types";

declare global {
  namespace Express {
    interface Request {
      /** Populated by requireAuth once the bearer token resolves to a live session. */
      reviewer?: Reviewer;
    }
  }
}

export {};
