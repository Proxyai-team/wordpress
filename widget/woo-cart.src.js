/* ProxyAI WooCommerce cart plugin.
 *
 * Loaded only on a WooCommerce storefront, alongside embed.js, by the plugin's
 * own `wp_enqueue_script`. Every piece of WooCommerce knowledge the widget
 * needs lives here; embed.src.js stays commerce-agnostic and never learns what
 * a cart is. Validation and registration come from cart-plugin-kit.js, shared
 * with the Shopify plugin.
 *
 * It registers the *same* contract as shopify-cart.src.js — same capability
 * strings, same action types — which is what lets the Go side and the widget
 * core stay unchanged across two backends.
 *
 * Why it exists at all, same as Shopify: a cart the runtime builds over HTTP is
 * a different cart from the one in this browser. On WooCommerce the gap is
 * wider still, because a Store API cart is keyed by a `Cart-Token` header that
 * belongs to one HTTP session and can never be handed to the shopper. Executing
 * here writes the cart they are actually looking at.
 */
import {
  documentReady,
  fail,
  lineId,
  quantity,
  registerPlugin,
} from "./cart-plugin-kit.js";

(function () {
  "use strict";

  var NAME = "woo-cart";
  var API = "/wp-json/wc/store/v1";

     /* Store API session handle: returned on first guest cart touch, required
      * on every write after. Drop it and the next write starts a fresh cart —
      * the shopper watches their item vanish. Memory only. */
  var cartToken = null;

     /* WP REST nonce (wp_localize_script): keeps a logged-in shopper's cart on
      * their account instead of a guest cart. Absent when logged out — the
      * Cart-Token carries them. */
  function config() {
    return window.ProxyAIWooConfig || {};
  }

  function headers(extra) {
    var out = { Accept: "application/json" };
    var nonce = config().nonce;
    if (nonce) out["Nonce"] = nonce;
    if (cartToken) out["Cart-Token"] = cartToken;
    for (var key in extra || {}) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) out[key] = extra[key];
    }
    return out;
  }

  function remember(response) {
    var token = response.headers && response.headers.get("Cart-Token");
    if (token) cartToken = token;
    return response;
  }

  // ---- reads ---------------------------------------------------------------

    /* Minor-unit money with exponent alongside; honoured, not assumed 2 —
     * zero-decimal currencies report 0. */
  function money(amount, minorUnit) {
    var n = Number(amount);
    if (!isFinite(n)) return null;
    var exp = typeof minorUnit === "number" ? minorUnit : 2;
    return (n / Math.pow(10, exp)).toFixed(exp);
  }

  function snapshot() {
    return fetch(API + "/cart", { headers: headers(), credentials: "same-origin" })
      .then(remember)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cart) {
        if (!cart) return null;
        var totals = cart.totals || {};
        var exp = totals.currency_minor_unit;
        return {
          currency: totals.currency_code,
          item_count: cart.items_count,
          total: money(totals.total_price, exp),
          // Reported rather than derived: the runtime cannot know a merchant's
          // permalink settings, and a model asked for "the checkout link" with
          // nothing to hand will invent one.
          cart_url: config().cart_url || null,
          checkout_url: config().checkout_url || null,
          items: (cart.items || []).map(function (i) {
            var prices = i.prices || {};
            var pexp = prices.currency_minor_unit;
            var totalsForLine = i.totals || {};
            return {
              // Woo calls it `key`; the runtime calls every one of these a line
              // id, because that is what it is for.
              line_id: i.key,
              // The variation id when the shopper picked one, else the product
              // id — the same value add-item takes back.
              variant_id: String(i.id),
              title: i.name,
              variant: variantLabel(i),
              quantity: i.quantity,
              unit_price: money(prices.price, pexp),
              line_total: money(totalsForLine.line_total, totalsForLine.currency_minor_unit),
            };
          }),
        };
      })
      .catch(function () { return null; });
  }

     /* "Size: Large, Colour: Blue" from the variation array — without it every
      * variable-product line reads identically. */
  function variantLabel(item) {
    var parts = (item.variation || []).map(function (v) {
      return (v.attribute || "") + ": " + (v.value || "");
    });
    return parts.length ? parts.join(", ") : undefined;
  }

  // ---- writes --------------------------------------------------------------

  function post(path, body) {
    return fetch(API + path, {
      method: "POST",
      credentials: "same-origin",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    }).then(remember);
  }

  /* A Woo id is always digits: a product id, or a variation id when the shopper
   * chose options. Anything else is not an id we produced, so it is refused
   * rather than passed through to the store.
   */
  function productId(v) {
    var s = String(v == null ? "" : v).trim();
    return /^\d+$/.test(s) ? Number(s) : null;
  }

     /* Repaint the theme's cart UI — WooCommerce does not after a Store API
      * write. Classic themes: wc_fragment_refresh (jQuery bus); block themes:
      * wc-blocks_added_to_cart. Both fired. */
  function repaint() {
    try {
      document.body.dispatchEvent(new CustomEvent("wc-blocks_added_to_cart"));
      if (window.jQuery) {
        window.jQuery(document.body).trigger("wc_fragment_refresh");
        window.jQuery(document.body).trigger("added_to_cart");
      }
    } catch (e) {
      // A theme with a broken listener must not turn a successful cart write
      // into a reported failure.
    }
  }

    /* Every write resolves to the same shape: cart now + store objections
     * (surfaced as user_errors — the store explains refusals best). */
  function settle(response) {
    if (response.ok) {
      repaint();
      return snapshot().then(function (cart) {
        return { ok: true, user_errors: [], warnings: [], cart: cart };
      });
    }
    return response
      .json()
      .catch(function () { return null; })
      .then(function (body) {
        return snapshot().then(function (cart) {
          return {
            ok: false,
            user_errors: body && body.message
              ? [{ code: body.code || "woocommerce_error", message: body.message }]
              : [],
            warnings: [],
            cart: cart,
          };
        });
      });
  }

  function failed(err) {
    return { ok: false, reason: "action_failed", detail: String((err && err.message) || err) };
  }

  function execute(action) {
    var p = action.payload || {};

    if (action.type === "cart.add") {
      var id = productId(p.variant_id);
      var qty = quantity(p.quantity == null ? 1 : p.quantity, false, config().max_quantity);
      if (!id) return fail("invalid_variant_id");
      if (qty === null) return fail("invalid_quantity");
      return post("/cart/add-item", { id: id, quantity: qty }).then(settle, failed);
    }

    if (action.type === "cart.set_quantity") {
      var setLine = lineId(p.line_id);
      var setQty = quantity(p.quantity, true, config().max_quantity);
      if (!setLine) return fail("invalid_line_id");
      if (setQty === null) return fail("invalid_quantity");
      // Zero is how the runtime expresses a removal through this action, and
      // Woo's update-item does not accept it — so it is routed to the endpoint
      // that does rather than sent and refused.
      if (setQty === 0) {
        return post("/cart/remove-item", { key: setLine }).then(settle, failed);
      }
      return post("/cart/update-item", { key: setLine, quantity: setQty }).then(settle, failed);
    }

    if (action.type === "cart.remove") {
      var rmLine = lineId(p.line_id);
      if (!rmLine) return fail("invalid_line_id");
      return post("/cart/remove-item", { key: rmLine }).then(settle, failed);
    }

    return fail("unsupported_action");
  }

  // ---- registration --------------------------------------------------------

  documentReady().then(function () {
    // Not a WooCommerce page, or the plugin did not print its config. As on
    // Shopify, registering nothing is the correct outcome: the widget sends no
    // cart capability and the runtime falls back to a path that needs none.
    if (!config().cart_url) return;

    registerPlugin({
      name: NAME,
      capabilities: ["cart.read", "cart.write"],
      // Exactly the types the runtime emits, and the same three the Shopify
      // plugin claims — the contract is the widget's, not the backend's.
      actions: ["cart.add", "cart.set_quantity", "cart.remove"],
      context: snapshot,
      execute: execute,
    });
  });
})();
