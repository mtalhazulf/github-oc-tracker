/** Field name → human-readable message, rendered inline next to the input. */
export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 422 — the input is malformed or violates a rule. Carries per-field messages. */
export class ValidationError extends AppError {
  constructor(
    message = "Please correct the highlighted fields.",
    readonly fields: FieldErrors = {},
  ) {
    super(message, 422, "validation_failed");
  }
}

/** 409 — the input is well-formed but collides with existing data. */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "conflict");
  }
}

/** 404 — the addressed record does not exist (or is archived out of view). */
export class NotFoundError extends AppError {
  constructor(what = "That record") {
    super(`${what} was not found.`, 404, "not_found");
  }
}

/** 403 — authenticated but not permitted. */
export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to that.") {
    super(message, 403, "forbidden");
  }
}
