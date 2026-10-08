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
  var LOOKUP_TIMEOUT_MS = 1500;           // per provider
  var CEILING_MS = 2000;                  // absolute max wait before falling back

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

  function normalize(code) {
    return String(code).toUpperCase() === "NG" ? "NG" : "INTL";
  }

  // Free, no-API-key, CORS-enabled providers. All are queried at the same
  // time; whichever answers first wins. Different providers are blocked by
  // different ad-blockers/networks, so using several makes detection far
  // more reliable than relying on one.
  var PROVIDERS = [
    "https://api.country.is/",
    "https://get.geojs.io/v1/ip/country.json",
    "https://ipwho.is/?fields=success,country_code",
    "https://ipapi.co/json/"
  ];

  function lookup(url) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, LOOKUP_TIMEOUT_MS);
    return fetch(url, controller ? { signal: controller.signal } : undefined)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        clearTimeout(timer);
        var code = data && (data.country_code || data.country);
        if (typeof code === "string" && code.length === 2) return normalize(code);
        throw new Error("no country in response");
      })
      .catch(function (err) { clearTimeout(timer); throw err; });
  }

  // Resolves with the first provider that succeeds; rejects only if all fail.
  function firstSuccess(promises) {
    return new Promise(function (resolve, reject) {
      var failed = 0;
      promises.forEach(function (p) {
        p.then(resolve, function () {
          failed += 1;
          if (failed === promises.length) reject(new Error("all providers failed"));
        });
      });
    });
  }

  /**
   * Resolves to "NG" or "INTL" — never rejects, never waits longer than
   * CEILING_MS.
   * Fallback on total failure/timeout: "INTL" — the commercially safer
   * default, since it avoids showing discounted Naira pricing to a visitor
   * who isn't actually in Nigeria. (Failures are not cached, so the next
   * page view tries detection again.)
   */
  function detectCountry() {
    var override = getOverride();
    if (override) return Promise.resolve(override);

    var cached = getCached();
    if (cached) return Promise.resolve(cached);

    var detection = firstSuccess(PROVIDERS.map(lookup)).then(function (country) {
      setCached(country);
      return country;
    });

    var ceiling = new Promise(function (resolve) {
      setTimeout(function () { resolve("INTL"); }, CEILING_MS);
    });

    return Promise.race([detection, ceiling]).catch(function () { return "INTL"; });
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
