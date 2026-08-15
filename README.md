# ProxyAI for WordPress

Source of the [ProxyAI](https://www.proxyai.app) WordPress plugin, as published on
[WordPress.org](https://wordpress.org/plugins/proxyai/).

There is no build step. Every file here ships as-is in the plugin zip:
`admin/js/dashboard.js` is hand-written against WordPress's bundled React
(`wp.element`) and `wp.apiFetch`; no bundler, transpiler or minifier is involved.

The front-end widget scripts the plugin loads from the ProxyAI service
(`embed.js`, `woo-cart.js`, `ticket-embed.js`) are not in the zip, but their
readable sources are in [`widget/`](widget/).

To try it, zip this directory as `proxyai/` and upload it under
**Plugins → Add New → Upload Plugin**, or copy it into `wp-content/plugins/proxyai/`.

Docs: https://www.proxyai.app/help
License: GPL-2.0-or-later
