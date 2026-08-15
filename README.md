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

## License

The plugin code in this repository is licensed under the GNU General Public
License, version 2 or later — see [LICENSE](LICENSE). Copyright © ProxyAI.

"ProxyAI" and the ProxyAI logo are trademarks of ProxyAI and are not covered by
the GPL; the license grants no right to use them. The hosted ProxyAI service
this plugin talks to is a separate, proprietary service governed by its own
[Terms of Service](https://www.proxyai.app/terms) and
[Privacy Policy](https://www.proxyai.app/privacy) — the GPL covers this client
code only, not the service.
