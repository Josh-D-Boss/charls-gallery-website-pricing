/**
 * Charl's Gallery — country-based pricing detection.
 *
 * Purpose: decide whether a visitor should see Nigerian (NG) or
 * International (INTL) pricing, without asking them and without using
 * navigator.geolocation (no GPS permission prompt).
 *
 * Method: client-side IP geolocation lookup against a free, no-API-key
 * country-lookup endpoint. This works on GitHub Pages because it's just a
 * fetch() call from the visitor's own browser — no server-side code is
 * required on our end, and no secret key needs to be protected.
 *
 * Note on data exposure: because GitHub Pages cannot run server-side logic,
 * this script can only control what is *displayed*, not what is *delivered*
 * in the page's HTML. Both price lists exist in the page source regardless
 * of country. If the prices ever need to be withheld from the network
 * response entirely (not just the display), that requires a serverless/edge
 * function in front of the site, which this implementation deliberately
 * does not add.
 */
(function (window) {
  "use strict";

  var CACHE_KEY = "cg_country";
  var CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  var FETCH_TIMEOUT_MS = 2500;

  // Optional, discreet manual override for testing: ?country=NG or ?country=INTL
  // Not documented/linked anywhere in the UI; normal visitors never see or use it.
  function getOverride() {
    var params = new URLSearchParams(window.location.search);
    var value = params.get("country");
    if (!value) return null;
    return value.toUpperCase() === "NG" ? "NG" : "INTL";
  }

  function getCached() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
      return parsed.country;
    } catch (e) {
      return null;
    }
  }

  function setCached(country) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ country: country, ts: Date.now() }));
    } catch (e) {
      /* sessionStorage unavailable (e.g. some private-browsing modes) — safe to ignore */
    }
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error("timeout")); }, ms);
      })
    ]);
  }

  function normalize(code) {
    return code === "NG" ? "NG" : "INTL";
  }

  // Primary lookup: ipwho.is — free, no API key, generous rate limit, CORS-enabled.
  function lookupPrimary() {
    return withTimeout(fetch("https://ipwho.is/?fields=success,country_code"), FETCH_TIMEOUT_MS)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.success && data.country_code) return normalize(data.country_code);
        throw new Error("no country in response");
      });
  }

  // Secondary lookup, used only if the primary is unreachable or blocked
  // (ad blockers / corporate networks sometimes block one but not the other).
  function lookupSecondary() {
    return withTimeout(fetch("https://ipapi.co/json/"), FETCH_TIMEOUT_MS)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.country_code) return normalize(data.country_code);
        throw new Error("no country in response");
      });
  }

  /**
   * Resolves to "NG" or "INTL".
   *
   * Fallback if every lookup fails (offline, blocked, rate-limited, etc.):
   * defaults to "INTL". This is the commercially safer default — Nigeria is
   * reliably identified by IP-geolocation providers, so genuine detection
   * failures mostly affect visitors who are, by definition, unclassified;
   * treating them as international avoids the risk of showing discounted
   * Naira pricing to a visitor who isn't actually in Nigeria.
   */
  function detectCountry() {
    var override = getOverride();
    if (override) return Promise.resolve(override);

    var cached = getCached();
    if (cached) return Promise.resolve(cached);

    return lookupPrimary()
      .catch(lookupSecondary)
      .then(function (country) {
        setCached(country);
        return country;
      })
      .catch(function () {
        return "INTL"; // safe fallback — see comment above
      });
  }

  window.CGCountry = { detectCountry: detectCountry };
})(window);
