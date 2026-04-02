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

const TOKEN_REQUESTS = [
  { name: 'gruntwork_read', path: 'pipelines-read/gruntwork-io', fallback_env: 'PIPELINES_READ_TOKEN' },
  { name: 'org_read', path: 'pipelines-read/acme-corp', fallback_env: 'PIPELINES_READ_TOKEN' },
  { name: 'infra_write', path: 'propose-infra-change/acme-corp', fallback_env: 'INFRA_ROOT_WRITE_TOKEN' },
];

const DEFAULT_ENV = {
  API_BASE_URL: 'https://api.example.com/api/v1',
  TOKEN_REQUESTS: JSON.stringify(TOKEN_REQUESTS),
  PIPELINES_READ_TOKEN: 'fallback-read-pat',
  INFRA_ROOT_WRITE_TOKEN: 'fallback-write-pat',
};

const LOGIN_URL = 'https://api.example.com/api/v1/tokens/auth/login';

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
    test('fetches all tokens in parallel after single OIDC login', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([
        okResponse('provider-token'),
        okResponse('gruntwork-pat'),
        okResponse('org-pat'),
        okResponse('infra-pat'),
      ]);

      await runAction({ coreMock: core, fetchMock: fetch, env: DEFAULT_ENV });

      expect(fetch).toHaveBeenCalledTimes(4);
      expect(fetch.mock.calls[0][0]).toBe(LOGIN_URL);
      expect(fetch.mock.calls[1][0]).toContain('/tokens/pat/pipelines-read/gruntwork-io');
      expect(fetch.mock.calls[2][0]).toContain('/tokens/pat/pipelines-read/acme-corp');
      expect(fetch.mock.calls[3][0]).toContain('/tokens/pat/propose-infra-change/acme-corp');

      expect(core.setOutput).toHaveBeenCalledWith('tokens_json', JSON.stringify({
        gruntwork_read: 'gruntwork-pat',
        org_read: 'org-pat',
        infra_write: 'infra-pat',
      }));
      expect(core.setFailed).not.toHaveBeenCalled();
    });
  });

  describe('partial failure', () => {
    test('uses fallback for failed tokens while others succeed', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([
        okResponse('provider-token'),
        okResponse('gruntwork-pat'),
        errorResponse(403, 'Forbidden'),
        okResponse('infra-pat'),
      ]);

      await runAction({ coreMock: core, fetchMock: fetch, env: DEFAULT_ENV });

      const output = JSON.parse(core.setOutput.mock.calls.find(c => c[0] === 'tokens_json')[1]);
      expect(output.gruntwork_read).toBe('gruntwork-pat');
      expect(output.org_read).toBe('fallback-read-pat');
      expect(output.infra_write).toBe('infra-pat');
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('trims whitespace from fallback tokens', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([
        okResponse('provider-token'),
        errorResponse(403, 'Forbidden'),
        okResponse('org-pat'),
        okResponse('infra-pat'),
      ]);

      await runAction({
        coreMock: core,
        fetchMock: fetch,
        env: { ...DEFAULT_ENV, PIPELINES_READ_TOKEN: '  padded-token  ' },
      });

      const output = JSON.parse(core.setOutput.mock.calls.find(c => c[0] === 'tokens_json')[1]);
      expect(output.gruntwork_read).toBe('padded-token');
    });
  });

  describe('auth failure', () => {
    test('uses fallbacks for all tokens when OIDC fails', async () => {
      const core = createCoreMock();
      core.getIDToken.mockRejectedValue(new Error('OIDC unavailable'));

      await runAction({ coreMock: core, fetchMock: createFetchMock([]), env: DEFAULT_ENV });

      const output = JSON.parse(core.setOutput.mock.calls.find(c => c[0] === 'tokens_json')[1]);
      expect(output.gruntwork_read).toBe('fallback-read-pat');
      expect(output.org_read).toBe('fallback-read-pat');
      expect(output.infra_write).toBe('fallback-write-pat');
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('uses fallbacks for all tokens when login fails', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([
        errorResponse(403, 'Forbidden'),
      ]);

      await runAction({ coreMock: core, fetchMock: fetch, env: DEFAULT_ENV });

      const output = JSON.parse(core.setOutput.mock.calls.find(c => c[0] === 'tokens_json')[1]);
      expect(output.gruntwork_read).toBe('fallback-read-pat');
      expect(output.org_read).toBe('fallback-read-pat');
      expect(output.infra_write).toBe('fallback-write-pat');
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('calls setFailed when auth fails and fallback is missing', async () => {
      const core = createCoreMock();
      core.getIDToken.mockRejectedValue(new Error('OIDC unavailable'));

      await runAction({
        coreMock: core,
        fetchMock: createFetchMock([]),
        env: { ...DEFAULT_ENV, PIPELINES_READ_TOKEN: '' },
      });

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('PIPELINES_READ_TOKEN'));
    });

    test('calls setFailed when token fetch fails and fallback is missing', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([
        okResponse('provider-token'),
        errorResponse(403, 'Forbidden'),
        okResponse('org-pat'),
        okResponse('infra-pat'),
      ]);

      await runAction({
        coreMock: core,
        fetchMock: fetch,
        env: { ...DEFAULT_ENV, PIPELINES_READ_TOKEN: '' },
      });

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('PIPELINES_READ_TOKEN'));
    });
  });

  describe('LIMIT_EXCEEDED behavior', () => {
    test('writes job summary and uses fallbacks for all tokens', async () => {
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
      const output = JSON.parse(core.setOutput.mock.calls.find(c => c[0] === 'tokens_json')[1]);
      expect(output.gruntwork_read).toBe('fallback-read-pat');
      expect(output.org_read).toBe('fallback-read-pat');
      expect(output.infra_write).toBe('fallback-write-pat');
    });

    test('creates PR comment when in PR context', async () => {
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
  });

  describe('retry behavior', () => {
    test.each([
      { name: 'HTTP 500', failResponse: errorResponse(500, 'Internal Server Error') },
      { name: 'HTTP 502', failResponse: errorResponse(502, 'Bad Gateway') },
      { name: 'HTTP 429 rate limit', failResponse: errorResponse(429, 'Too Many Requests') },
      { name: 'ECONNREFUSED network error', failResponse: new Error('ECONNREFUSED') },
      { name: 'ETIMEDOUT network error', failResponse: new Error('ETIMEDOUT') },
      { name: 'TypeError fetch failed', failResponse: new TypeError('fetch failed') },
    ])('retries on $name then succeeds', async ({ failResponse }) => {
      const core = createCoreMock();
      const fetch = createFetchMock([
        failResponse,
        okResponse('provider-token'),
        okResponse('gruntwork-pat'),
        okResponse('org-pat'),
        okResponse('infra-pat'),
      ]);

      await runAction({ coreMock: core, fetchMock: fetch, env: DEFAULT_ENV });

      const output = JSON.parse(core.setOutput.mock.calls.find(c => c[0] === 'tokens_json')[1]);
      expect(output.gruntwork_read).toBe('gruntwork-pat');
      expect(output.org_read).toBe('org-pat');
      expect(output.infra_write).toBe('infra-pat');
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('retries individual token fetch failures', async () => {
      const core = createCoreMock();
      // With parallel execution, we need 4 successful responses after login
      // (one retry + 3 tokens = 4 PAT responses needed after the initial 500)
      const fetch = createFetchMock([
        okResponse('provider-token'),
        errorResponse(500, 'Internal Server Error'),
        okResponse('pat-1'),
        okResponse('pat-2'),
        okResponse('pat-3'),
      ]);

      await runAction({ coreMock: core, fetchMock: fetch, env: DEFAULT_ENV });

      // All tokens should be set in tokens_json
      const output = JSON.parse(core.setOutput.mock.calls.find(c => c[0] === 'tokens_json')[1]);
      expect(output).toHaveProperty('gruntwork_read');
      expect(output).toHaveProperty('org_read');
      expect(output).toHaveProperty('infra_write');
      expect(core.setFailed).not.toHaveBeenCalled();
    });
  });

  describe('single token request', () => {
    test('works with a single token request', async () => {
      const core = createCoreMock();
      const fetch = createFetchMock([
        okResponse('provider-token'),
        okResponse('single-pat'),
      ]);

      const singleTokenEnv = {
        API_BASE_URL: 'https://api.example.com/api/v1',
        TOKEN_REQUESTS: JSON.stringify([
          { name: 'my_token', path: 'some/path', fallback_env: 'MY_FALLBACK' },
        ]),
        MY_FALLBACK: 'fallback-value',
      };

      await runAction({ coreMock: core, fetchMock: fetch, env: singleTokenEnv });

      expect(core.setOutput).toHaveBeenCalledWith('tokens_json', JSON.stringify({ my_token: 'single-pat' }));
      expect(core.setFailed).not.toHaveBeenCalled();
    });
  });
});
