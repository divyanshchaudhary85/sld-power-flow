import { describe, expect, it } from 'vitest';
import { parseVisionResponse, makeVisionRequest } from '../src/vision/api';

describe('structured vision boundary', () => {
  it('keeps credentials out of the request payload and disables stored responses', () => {
    const request = makeVisionRequest('selected-model', 'data:image/png;base64,dGVzdA==');
    expect(request.model).toBe('selected-model');
    expect(request.store).toBe(false);
    expect(JSON.stringify(request)).not.toContain('apiKey');
  });
  it('accepts a complete schema-valid perception response', () => {
    const value = { components: [{ type: 'busbar', label: 'BUS A', bbox: [0.1, 0.1, 0.9, 0.2], confidence: 0.9 }], notes: '' };
    expect(parseVisionResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] })).toEqual(value);
  });
  it.each([
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"components":[]}' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"components":[{"type":"busbar","label":"B","bbox":[0.9,0,0.1,1],"confidence":2}],"notes":""}' }] }] },
  ])('rejects incomplete/refused/malformed perception output', (value) => {
    expect(() => parseVisionResponse(value)).toThrow();
  });
});
