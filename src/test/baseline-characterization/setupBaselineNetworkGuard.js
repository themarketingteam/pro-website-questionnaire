import { afterEach, beforeEach, expect, vi } from 'vitest';

let fetchMock;
let xhrOpenMock;

beforeEach(() => {
  fetchMock = vi.fn(() => {
    throw new Error('Baseline characterization attempted an unmocked fetch');
  });
  vi.stubGlobal('fetch', fetchMock);

  xhrOpenMock = vi
    .spyOn(XMLHttpRequest.prototype, 'open')
    .mockImplementation(() => {
      throw new Error('Baseline characterization attempted an unmocked XMLHttpRequest');
    });
});

afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  expect(xhrOpenMock).not.toHaveBeenCalled();
  xhrOpenMock.mockRestore();
  vi.unstubAllGlobals();
});
