import type { Response } from "express";
import type { ApiErrorResponse } from "@cop/shared-types";

/**
 * Thrown by route handlers to signal an HTTP error; caught by the
 * asyncHandler wrapper in app.ts and turned into an ApiErrorResponse.
 */
export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sendError(res: Response, status: number, code: string, message: string): void {
  const body: ApiErrorResponse = { error: code, message };
  res.status(status).json(body);
}
