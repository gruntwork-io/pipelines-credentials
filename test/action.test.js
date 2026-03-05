const { runAction } = require('./helpers/create-sandbox');

function createCoreMock() {
  return {
    getIDToken: jest.fn().mockResolvedValue('mock-id-token'),
    setOutput: jest.fn(),
    setFailed: jest.fn(),
  };
}

function okResponse(token) {
  return { ok: true, status: 200, statusText: 'OK', body: { token } };
}

function errorResponse(status, statusText) {
  return { ok: false, status, statusText };
}

function createFetchMock(responses) {
  let callIndex = 0;
  return jest.fn(async () => {
    if (callIndex >= responses.length) {
      throw new Error(`Unexpected fetch call #${callIndex + 1}`);
    }
    const resp = responses[callIndex++];
    if (resp instanceof Error) throw resp;
    return {
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      json: async () => resp.body,
    };
  });
}

const DEFAULT_ENV = {
  API_BASE_URL: 'https://api.example.com/api/v1',
  PIPELINES_TOKEN_PATH: 'org/repo',
  FALLBACK_TOKEN: 'fallback-pat',
};

const LOGIN_URL = 'https://api.example.com/api/v1/tokens/auth/login';
const TOKEN_URL = 'https://api.example.com/api/v1/tokens/pat/org/repo';

describe('pipelines-credentials action', () => {
  describe('happy path', () => {
    test('OIDC login and token fetch', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([
        okResponse('provider-token'),
        okResponse('pipelines-pat'),
      ]);

      await runAction({ coreMock: core, fetchMock: fetch, env: DEFAULT_ENV });

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[0][0]).toBe(LOGIN_URL);
      expect(fetch.mock.calls[1][0]).toBe(TOKEN_URL);
      expect(core.setOutput).toHaveBeenCalledWith('PIPELINES_TOKEN', 'pipelines-pat');
      expect(core.setFailed).not.toHaveBeenCalled();
    });
  });

  describe('fallback behavior', () => {
    test('uses FALLBACK_TOKEN when OIDC fails', async () => {
      const core = createCoreMock();
      core.getIDToken.mockRejectedValue(new Error('OIDC unavailable'));

      await runAction({ coreMock: core, fetchMock: createFetchMock([]), env: DEFAULT_ENV });

      expect(core.setOutput).toHaveBeenCalledWith('PIPELINES_TOKEN', 'fallback-pat');
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('trims whitespace from FALLBACK_TOKEN', async () => {
      const core = createCoreMock();
      core.getIDToken.mockRejectedValue(new Error('OIDC unavailable'));

      await runAction({
        coreMock: core,
        fetchMock: createFetchMock([]),
        env: { ...DEFAULT_ENV, FALLBACK_TOKEN: '  padded-token  ' },
      });

      expect(core.setOutput).toHaveBeenCalledWith('PIPELINES_TOKEN', 'padded-token');
    });

    test('calls setFailed when API fails and no FALLBACK_TOKEN', async () => {
      const core = createCoreMock();
      core.getIDToken.mockRejectedValue(new Error('OIDC unavailable'));

      await runAction({
        coreMock: core,
        fetchMock: createFetchMock([]),
        env: { ...DEFAULT_ENV, FALLBACK_TOKEN: '' },
      });

      expect(core.setFailed).toHaveBeenCalled();
    });

    test('uses FALLBACK_TOKEN when login returns non-retryable error', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([
        errorResponse(403, 'Forbidden'),
      ]);

      await runAction({ coreMock: core, fetchMock: fetch, env: DEFAULT_ENV });

      expect(core.setOutput).toHaveBeenCalledWith('PIPELINES_TOKEN', 'fallback-pat');
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry behavior', () => {
    test.each([
      {
        name: 'HTTP 500',
        failResponse: errorResponse(500, 'Internal Server Error'),
      },
      {
        name: 'HTTP 502',
        failResponse: errorResponse(502, 'Bad Gateway'),
      },
      {
        name: 'HTTP 429 rate limit',
        failResponse: errorResponse(429, 'Too Many Requests'),
      },
      {
        name: 'ECONNREFUSED network error',
        failResponse: new Error('ECONNREFUSED'),
      },
      {
        name: 'ETIMEDOUT network error',
        failResponse: new Error('ETIMEDOUT'),
      },
      {
        name: 'TypeError fetch failed',
        failResponse: new TypeError('fetch failed'),
      },
    ])('retries on $name then succeeds', async ({ failResponse }) => {
      const core = createCoreMock();
      const fetch = createFetchMock([
        failResponse,
        okResponse('provider-token'),
        okResponse('pipelines-pat'),
      ]);

      await runAction({ coreMock: core, fetchMock: fetch, env: DEFAULT_ENV });

      expect(core.setOutput).toHaveBeenCalledWith('PIPELINES_TOKEN', 'pipelines-pat');
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    test('retries multiple times before succeeding', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([
        errorResponse(500, 'Internal Server Error'),
        errorResponse(500, 'Internal Server Error'),
        okResponse('provider-token'),
        okResponse('pipelines-pat'),
      ]);

      await runAction({ coreMock: core, fetchMock: fetch, env: DEFAULT_ENV });

      expect(core.setOutput).toHaveBeenCalledWith('PIPELINES_TOKEN', 'pipelines-pat');
      expect(fetch).toHaveBeenCalledTimes(4);
    });
  });
});
