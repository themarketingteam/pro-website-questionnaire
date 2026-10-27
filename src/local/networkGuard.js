export const installLocalNetworkGuard = () => {
  const allowed = (input) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, window.location.href);
    if (url.origin !== window.location.origin) throw new Error(`Local preview blocked external request to ${url.hostname}.`);
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => { allowed(input); return originalFetch(input, init); };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) { allowed(String(url)); return originalOpen.call(this, method, url, ...args); };
  if (navigator.sendBeacon) navigator.sendBeacon = (url) => { allowed(String(url)); return false; };
};
