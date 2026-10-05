/**
 * Charl's Gallery — central country-based pricing mechanism.
 *
 * This is the ONLY place country-detection and pricing-visibility logic
 * lives. Pages never write their own detection/apply code — they just tag
 * markup with the data attributes below, and this script does the rest.
 * That guarantees Website Pricing and Design Pricing (and any future
 * pricing page) can never drift out of sync with each other.
 *
 * Markup contract:
 *   [data-pricing-root]        wrapper hidden by default; revealed once
 *                               the correct pricing is ready. No visible
 *                               loading text/spinner is shown at any point —
 *                               the area is simply blank until ready.
 *   [data-market="ng"|"intl"]  a whole block to keep only for that market
 *                               (used where NG/International are separate
 *                               sections, e.g. the Website pricing page).
 *   [data-price="ngn"|"usd"]   an inline element to keep only for that
 *                               currency (used where both prices sit in the
 *                               same row, e.g. the Design pricing page).
 *   [data-market-divider]      a purely decorative divider between two
 *                               market blocks; removed once only one market
 *                               remains.
 *
 * After processing, document.body gets a class of "pricing-ng" or
 * "pricing-intl" so any page's own CSS can adjust layout (e.g. collapsing a
 * two-currency grid down to one column) without needing page-specific JS.
 */
(function (window, document) {
  "use strict";

  var CACHE_KEY = "cg_country";
  var CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  var FETCH_TIMEOUT_MS = 2500;

  // Discreet manual override for testing only: ?country=NG or ?country=INTL.
  // Never surfaced in the UI; normal visitors never see or use it.
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
      /* sessionStorage unavailable — safe to ignore */
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

  // Primary lookup: free, no API key, CORS-enabled.
  function lookupPrimary() {
    return withTimeout(fetch("https://ipwho.is/?fields=success,country_code"), FETCH_TIMEOUT_MS)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.success && data.country_code) return normalize(data.country_code);
        throw new Error("no country in response");
      });
  }

  // Secondary lookup, used only if the primary is unreachable/blocked.
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
   * Fallback on total failure: "INTL" — the commercially safer default,
   * since genuine detection failures are rare for a well-covered country
   * like Nigeria, and defaulting to international avoids showing discounted
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
        return "INTL";
      });
  }

  /**
   * Applies the resolved country to whatever pricing markup exists on the
   * current page. Safe to call on pages with no pricing markup at all.
   */
  function applyPricing(country) {
    var isNG = country === "NG";

    document.querySelectorAll("[data-market]").forEach(function (el) {
      var keep = (isNG && el.dataset.market === "ng") || (!isNG && el.dataset.market === "intl");
      if (!keep) el.remove();
    });

    document.querySelectorAll("[data-price]").forEach(function (el) {
      var keep = (isNG && el.dataset.price === "ngn") || (!isNG && el.dataset.price === "usd");
      if (!keep) el.remove();
    });

    document.querySelectorAll("[data-market-divider]").forEach(function (el) {
      el.remove();
    });

    document.body.classList.add(isNG ? "pricing-ng" : "pricing-intl");

    document.querySelectorAll("[data-pricing-root]").forEach(function (el) {
      el.hidden = false;
    });
  }

  function init() {
    // Nothing to do on pages with no pricing markup.
    if (!document.querySelector("[data-pricing-root]")) return;
    detectCountry().then(applyPricing);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.CGCountry = { detectCountry: detectCountry, applyPricing: applyPricing };
})(window, document);
