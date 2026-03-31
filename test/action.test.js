const { runAction } = require('./helpers/create-sandbox');

function createCoreMock() {
  return {
    getIDToken: jest.fn().mockResolvedValue('mock-id-token'),
    setOutput: jest.fn(),
    setFailed: jest.fn(),
    summary: {
      addHeading: jest.fn().mockReturnThis(),
      addEOL: jest.fn().mockReturnThis(),
      addRaw: jest.fn().mockReturnThis(),
      write: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function okResponse(token) {
  return { ok: true, status: 200, statusText: 'OK', body: { token } };
}

function errorResponse(status, statusText, body) {
  return { ok: false, status, statusText, body };
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
      json: async () => {
        if (resp.body === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return resp.body;
      },
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

function createGithubMock(existingComments = []) {
  return {
    rest: {
      issues: {
        listComments: jest.fn().mockResolvedValue({ data: existingComments }),
        createComment: jest.fn().mockResolvedValue({ data: { html_url: 'https://github.com/test-owner/test-repo/issues/1#issuecomment-new' } }),
        updateComment: jest.fn().mockResolvedValue({ data: { html_url: 'https://github.com/test-owner/test-repo/issues/1#issuecomment-updated' } }),
      },
    },
  };
}

function createContextMock(prNumber) {
  return {
    payload: {
      pull_request: prNumber ? { number: prNumber } : undefined,
    },
    repo: { owner: 'test-owner', repo: 'test-repo' },
  };
}

function limitExceededResponse(limit, used) {
  return errorResponse(403, 'Forbidden', {
    error: 'LIMIT_EXCEEDED',
    detail: {
      limits: [{ limit, used }],
    },
  });
}

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

  describe('LIMIT_EXCEEDED behavior', () => {
    test('writes job summary and falls back to FALLBACK_TOKEN', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([limitExceededResponse(100, 120)]);

      await runAction({
        coreMock: core,
        fetchMock: fetch,
        env: DEFAULT_ENV,
        contextMock: createContextMock(),
      });

      expect(core.summary.addHeading).toHaveBeenCalledWith('Your Pipelines have been paused');
      expect(core.summary.addRaw).toHaveBeenCalledWith(
        expect.stringContaining('**120 of 100** infrastructure units included in your plan—exceeding the limit by **20 units**')
      );
      expect(core.summary.write).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('PIPELINES_TOKEN', 'fallback-pat');
    });

    test('creates PR comment when no existing comment', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([limitExceededResponse(100, 120)]);
      const githubMock = createGithubMock();
      const contextMock = createContextMock(42);

      await runAction({
        coreMock: core,
        fetchMock: fetch,
        env: DEFAULT_ENV,
        githubMock,
        contextMock,
      });

      expect(githubMock.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 42,
        body: expect.stringContaining('Your Gruntwork Pipelines have been paused'),
      });
      expect(githubMock.rest.issues.updateComment).not.toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('PIPELINES_TOKEN', 'fallback-pat');
    });

    test('updates existing PR comment instead of creating a new one', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([limitExceededResponse(100, 120)]);
      const existingComment = { id: 999, body: '<!-- pipelines-limit-exceeded -->\n## old content' };
      const githubMock = createGithubMock([existingComment]);
      const contextMock = createContextMock(42);

      await runAction({
        coreMock: core,
        fetchMock: fetch,
        env: DEFAULT_ENV,
        githubMock,
        contextMock,
      });

      expect(githubMock.rest.issues.updateComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 999,
        body: expect.stringContaining('Your Gruntwork Pipelines have been paused'),
      });
      expect(githubMock.rest.issues.createComment).not.toHaveBeenCalled();
    });

    test('does NOT write summary or comment for a normal 403', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([errorResponse(403, 'Forbidden')]);
      const githubMock = createGithubMock();
      const contextMock = createContextMock(42);

      await runAction({
        coreMock: core,
        fetchMock: fetch,
        env: DEFAULT_ENV,
        githubMock,
        contextMock,
      });

      expect(core.summary.write).not.toHaveBeenCalled();
      expect(githubMock.rest.issues.createComment).not.toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('PIPELINES_TOKEN', 'fallback-pat');
    });

    test('handles PR comment failure gracefully', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([limitExceededResponse(100, 120)]);
      const githubMock = createGithubMock();
      githubMock.rest.issues.listComments.mockRejectedValue(new Error('Resource not accessible by integration'));
      const contextMock = createContextMock(42);

      await runAction({
        coreMock: core,
        fetchMock: fetch,
        env: DEFAULT_ENV,
        githubMock,
        contextMock,
      });

      expect(core.summary.write).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('PIPELINES_TOKEN', 'fallback-pat');
    });

    test('calls setFailed when LIMIT_EXCEEDED and no FALLBACK_TOKEN', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([limitExceededResponse(100, 120)]);

      await runAction({
        coreMock: core,
        fetchMock: fetch,
        env: { ...DEFAULT_ENV, FALLBACK_TOKEN: '' },
        contextMock: createContextMock(),
      });

      expect(core.summary.write).toHaveBeenCalled();
      expect(core.setFailed).toHaveBeenCalled();
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
