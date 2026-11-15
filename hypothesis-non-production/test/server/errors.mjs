export class EpisodeError extends Error {
  constructor(code, message, { status = 400, retryable = false, ...details } = {}) {
    super(message);
    this.name = "EpisodeError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    Object.assign(this, details);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.phase && { phase: this.phase }),
      ...(this.validation && { validation: this.validation }),
      ...(this.attempts !== undefined && { attempts: this.attempts }),
      ...(this.currentRevision !== undefined && { currentRevision: this.currentRevision }),
      ...(this.currentScene !== undefined && { currentScene: this.currentScene }),
      ...(this.details && { details: this.details }),
    };
  }
}

export class SceneGenerationError extends EpisodeError {
  constructor(phase, message, { validation, attempts = 0, cause } = {}) {
    super("scene_generation_failed", message, {
      status: 502,
      retryable: true,
      phase,
      validation,
      attempts,
      details: cause ? { cause: cause.message } : undefined,
    });
    this.name = "SceneGenerationError";
  }
}
