import type { ErrorCode } from "./types.js";

export class DeveloperToolkitError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "DeveloperToolkitError";
    this.code = code;
  }
}
