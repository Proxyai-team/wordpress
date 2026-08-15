# Front-end widget scripts (readable sources)

These are the scripts the plugin loads on a site's front end from the ProxyAI
service. They are **not** part of the plugin zip — the widget and the service
it talks to are versioned together — but their unminified sources are kept
here (and served next to the minified files) so anyone can read them.

| Served as | Source here | Notes |
|---|---|---|
| `https://www.proxyai.app/embed.js` | `embed.src.js` | Chat widget. Vanilla JS, no dependencies, Shadow DOM. |
| `https://www.proxyai.app/woo-cart.js` | `woo-cart.src.js` + `cart-plugin-kit.js` | WooCommerce cart bridge; the kit is imported and inlined at build. |
| `https://www.proxyai.app/ticket-embed.js` | `ticket-embed.js` | Support-ticket form. Served unminified as-is. |

`embed.js` and `woo-cart.js` are produced with esbuild (`minify: true`,
`target: es2017`; `woo-cart` is bundled as an IIFE so `cart-plugin-kit.js` is
inlined). Reproduce with:

```sh
npx esbuild embed.src.js    --minify --target=es2017 --outfile=embed.js
npx esbuild woo-cart.src.js --minify --target=es2017 --bundle --format=iife --outfile=woo-cart.js
```

The same sources are also served live at
`https://www.proxyai.app/embed.src.js` and `https://www.proxyai.app/woo-cart.src.js`.
