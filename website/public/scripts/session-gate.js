// Chakusa dashboard session gate. Loaded as a classic (non-module) script in
// the <head> of every dashboard page so it runs before any page script.
//
// The API revokes a whole session family when one refresh token is used
// twice (theft detection). A dashboard page fires several gateway requests
// at once; if the short-lived access cookie had expired, each would trigger
// its own refresh with the same token and the second would revoke the
// session, signing the user out. So every gateway request first awaits one
// shared GET /v1/session, serialised across tabs with the Web Locks API; the
// gateway refreshes only when the access token is missing or near expiry and
// reports how long it stays valid, and the check re-runs shortly before then.
(function () {
  "use strict";
  var GATEWAY = "https://auth.chakusarecovery.com";
  var SKIP = { "/v1/session": 1, "/v1/logout": 1, "/v1/login": 1, "/v1/register": 1, "/v1/google": 1 };
  var originalFetch = window.fetch.bind(window);
  var freshUntil = 0;
  var inFlight = null;

  function check() {
    function run() {
      return originalFetch(GATEWAY + "/v1/session", { credentials: "include" }).then(function (response) {
        if (response.status === 401) { freshUntil = Date.now() + 30000; return; }
        if (!response.ok) { freshUntil = 0; return; }
        return response.json().then(function (body) {
          var seconds = body && typeof body.expiresIn === "number" ? body.expiresIn : 0;
          freshUntil = Date.now() + Math.max(0, seconds - 120) * 1000;
        }, function () { freshUntil = 0; });
      });
    }
    if (navigator.locks && navigator.locks.request) return navigator.locks.request("chakusa-session", run);
    return run();
  }

  function ensureSession() {
    if (Date.now() < freshUntil) return Promise.resolve();
    if (!inFlight) {
      inFlight = check().catch(function () { freshUntil = 0; }).then(function () { inFlight = null; }, function () { inFlight = null; });
    }
    return inFlight;
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    if (typeof url === "string" && url.indexOf(GATEWAY + "/") === 0) {
      var path = new URL(url).pathname;
      if (!SKIP[path]) return ensureSession().then(function () { return originalFetch(input, init); });
    }
    return originalFetch(input, init);
  };
})();
