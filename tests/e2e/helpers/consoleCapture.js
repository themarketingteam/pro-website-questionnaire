import { redactText } from './redaction.js';

const DEFAULT_ALLOWED_CONSOLE_ERRORS = Object.freeze([
  /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/,
  /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/,
  /^App state check failed: Error$/,
  /^App state check failed: Base44Error: Request failed with status code 404(?:\n[\s\S]*)?$/,
]);

const isAllowed = (message, allowlist) => allowlist.some((pattern) => (
  pattern instanceof RegExp ? pattern.test(message) : message.includes(String(pattern))
));

export const installConsoleCapture = (
  page,
  { allowlist = DEFAULT_ALLOWED_CONSOLE_ERRORS } = {},
) => {
  const consoleMessages = [];
  const consoleErrors = [];
  const pageErrors = [];

  const onConsole = (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    const safeMessage = redactText(message.text());
    consoleMessages.push({
      allowed: message.type() !== 'error' || isAllowed(safeMessage, allowlist),
      text: safeMessage,
      type: message.type(),
    });
    if (message.type() === 'error' && !isAllowed(safeMessage, allowlist)) {
      consoleErrors.push(safeMessage);
    }
  };
  const onPageError = (error) => {
    pageErrors.push(redactText(error?.message || error));
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  return {
    consoleErrors,
    consoleMessages,
    pageErrors,
    safeSummary: () => ({
      consoleErrorCount: consoleErrors.length,
      consoleErrors: [...consoleErrors],
      consoleMessageCount: consoleMessages.length,
      consoleMessages: [...consoleMessages],
      pageErrorCount: pageErrors.length,
      pageErrors: [...pageErrors],
    }),
    stop: () => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    },
  };
};
