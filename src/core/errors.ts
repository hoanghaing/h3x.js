import type { Issue } from './types';

export class H3xError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'H3xError';
  }
}

export class H3xParseError extends H3xError {
  readonly element?: string;
  readonly attribute?: string;
  constructor(message: string, where: { element?: string; attribute?: string } = {}) {
    super(message);
    this.name = 'H3xParseError';
    this.element = where.element;
    this.attribute = where.attribute;
  }
}

export class H3xVersionError extends H3xError {
  readonly found: number;
  constructor(found: number) {
    super(`Unsupported h3x version: ${found}`);
    this.name = 'H3xVersionError';
    this.found = found;
  }
}

export class H3xValidationError extends H3xError {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(issues.map((i) => i.message).join('; ') || 'Validation failed');
    this.name = 'H3xValidationError';
    this.issues = issues;
  }
}
