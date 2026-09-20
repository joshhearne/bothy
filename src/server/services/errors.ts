/**
 * Errors the service layer throws, in one module so anything may import them
 * without pulling in a service and its database imports.
 */

export class NotFoundError extends Error {
  constructor(what = "Record") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** Thrown when the caller is authenticated but not allowed to do this. */
export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that") {
    super(message);
    this.name = "ForbiddenError";
  }
}
