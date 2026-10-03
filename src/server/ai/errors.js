export class AIError extends Error {
  constructor(message, code = 'AI_UNAVAILABLE', status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
