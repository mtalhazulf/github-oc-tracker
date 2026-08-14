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

export class ValidationError extends AppError {
  constructor(
    message = "Please correct the highlighted fields.",
    readonly fields: FieldErrors = {},
  ) {
    super(message, 422, "validation_failed");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "conflict");
  }
}

export class NotFoundError extends AppError {
  constructor(what = "That record") {
    super(`${what} was not found.`, 404, "not_found");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to that.") {
    super(message, 403, "forbidden");
  }
}
