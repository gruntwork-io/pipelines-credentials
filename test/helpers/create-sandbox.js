const { extractScript } = require('./extract-script');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let cachedFn = null;

function getSandboxedFn() {
  if (!cachedFn) {
    const script = extractScript();
    cachedFn = new AsyncFunction(
      'core', 'fetch', 'process', 'console', 'setTimeout', 'Math', 'github', 'context', 'JSON',
      script
    );
  }
  return cachedFn;
}

async function runAction({ coreMock, fetchMock, env = {}, githubMock = {}, contextMock = {} }) {
  const fn = getSandboxedFn();

  const processShim = { env: { ...env } };
  const consoleShim = { log: jest.fn() };
  const setTimeoutShim = (fn) => fn();
  const mathShim = { ...Math, random: () => 0.5, pow: Math.pow, round: Math.round };

  await fn(coreMock, fetchMock, processShim, consoleShim, setTimeoutShim, mathShim, githubMock, contextMock, JSON);
}

module.exports = { runAction };
