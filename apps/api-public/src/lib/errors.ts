import type { Response } from "express";
import type { ApiErrorResponse } from "@cop/shared-types";

/** Small typed wrapper so route handlers can `throw` and let a central
 * error handler turn it into the shared `ApiErrorResponse` shape. */
export class ApiError extends Error {
  status: number;
  error: string;

  constructor(status: number, error: string, message: string) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

export function sendError(res: Response, status: number, error: string, message: string): void {
  const body: ApiErrorResponse = { error, message };
  res.status(status).json(body);
}

export function notFound(resource: string): ApiError {
  return new ApiError(404, "not_found", `${resource} not found.`);
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, "bad_request", message);
}
