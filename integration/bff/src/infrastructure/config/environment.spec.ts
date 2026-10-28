import { describe, expect, it } from 'vitest';
import { bffEnvironment } from './environment.js';

describe('finance standalone origin', () => {
  it('includes 4204 by default and permits an explicit finance-only origin', () => {
    expect(bffEnvironment({}).origins).toContain('http://127.0.0.1:4204');
    expect(bffEnvironment({ WEB_ALLOWED_ORIGINS: 'http://127.0.0.1:4204' }).origins).toEqual(['http://127.0.0.1:4204']);
  });
  it('does not permit the template port, wildcard, localhost or arbitrary origins', () => {
    for (const origin of ['http://127.0.0.1:5173', '*', 'http://localhost:4204', 'https://outside.invalid']) {
      expect(() => bffEnvironment({ WEB_ALLOWED_ORIGINS: origin })).toThrow('WEB_ALLOWED_ORIGINS');
    }
  });
});
