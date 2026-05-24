export class NotImplementedError extends Error {
  public override readonly name: string = 'NotImplementedError';

  public constructor(feature: string) {
    super(`Not implemented: ${feature}`);
  }
}

export function notImplemented(feature: string): never {
  throw new NotImplementedError(feature);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
