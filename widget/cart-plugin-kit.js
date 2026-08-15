/* ProxyAI cart-plugin kit.
 *
 * Everything a storefront cart plugin needs that is not platform knowledge:
 * validation, registration and the ready gate. Bundled into each plugin by
 * esbuild (`build:embed`), never served on its own.
 *
 * It exists so `shopify-cart.src.js` and `woo-cart.src.js` cannot disagree
 * about what a valid quantity is or how a plugin registers. Everything that
 * *is* platform knowledge — the cart APIs, the id formats, the repaint — stays
 * in the plugin. embed.src.js remains commerce-agnostic and never learns what a
 * cart is.
 */

/**
 * Hard ceiling on a single cart line.
 *
 * The same number as `MAX_QUANTITY_CEILING` in `src/lib/commerce-settings.ts`:
 * a merchant allowed to configure more than the plugin will execute would get
 * silent refusals the bot cannot explain.
 */
export var MAX_QUANTITY = 100;

/** Resolves once the document is parsed. Plugin runtimes are module scripts. */
export function documentReady() {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise(function (resolve) {
    document.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
}

/** Integer minor units to a decimal string. Non-numbers stay null, not "0.00". */
export function money(minorUnits) {
  if (typeof minorUnits !== "number") return null;
  return (minorUnits / 100).toFixed(2);
}

/**
 * A whole quantity within `1..MAX_QUANTITY`, or null.
 *
 * `allowZero` is for set-quantity, where zero is the documented way to remove a
 * line. Refusing here rather than at the platform API keeps the failure legible
 * to the model: it gets `invalid_quantity`, not a cart-shaped error.
 */
export function quantity(q, allowZero, max) {
  var n = Number(q);
  // Coerced rather than type-checked: the merchant cap crosses from PHP, and a
  // helper that stringifies it once turned a cap of 5 into an ignored one — the
  // check passed silently and the ceiling fell back to the global maximum.
  var cap = Number(max);
  var ceiling = isFinite(cap) && cap > 0 ? Math.min(cap, MAX_QUANTITY) : MAX_QUANTITY;
  if (!isFinite(n) || Math.floor(n) !== n) return null;
  if (n < (allowZero ? 0 : 1) || n > ceiling) return null;
  return n;
}

/** A non-empty opaque line identifier, or null. */
export function lineId(v) {
  var s = String(v == null ? "" : v).trim();
  return s ? s : null;
}

/** The refusal shape every plugin returns for input it will not execute. */
export function fail(reason) {
  return Promise.resolve({ ok: false, reason: reason });
}

/**
 * Hands the plugin to the widget.
 *
 * Push rather than call `registerPlugin`: embed.js may not have run yet, and it
 * drains this array when it does. Callers register *nothing* when the platform
 * runtime is absent — the widget then sends no cart capability and the runtime
 * falls back to a path that does not need one.
 */
export function registerPlugin(plugin) {
  var api = (window.ProxyAI = window.ProxyAI || {});
  api.plugins = api.plugins || [];
  api.plugins.push(plugin);
}
