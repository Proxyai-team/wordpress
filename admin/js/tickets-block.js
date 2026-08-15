/*
 * Editor half of the "ProxyAI Support Tickets" block.
 *
 * The block is server-rendered — its markup carries a per-request identity
 * token that must never be saved into post content — so this only draws the
 * editor placeholder and saves nothing. Plain JS against the wp-* globals;
 * the plugin ships no build step.
 */
(function (blocks, element, blockEditor) {
  "use strict";
  var el = element.createElement;

  blocks.registerBlockType("proxyai/tickets", {
    edit: function () {
      return el(
        "div",
        blockEditor.useBlockProps({
          style: {
            border: "1px dashed #c3c4c7",
            borderRadius: "8px",
            padding: "20px",
            textAlign: "center",
            background: "#fff",
          },
        }),
        el(
          "strong",
          { style: { display: "block", fontSize: "14px" } },
          "ProxyAI Support Tickets",
        ),
        el(
          "span",
          { style: { fontSize: "13px", color: "#646970" } },
          "Your customers get an “Open a support ticket” button here; the form and their " +
            "ticket history open in a dialog, so the block adds one control rather than a panel " +
            "that pushes the rest of the page around. Signed-in customers only — logged-out " +
            "visitors are asked to log in first. Nothing to configure.",
        ),
      );
    },
    // Server-rendered: no markup is stored with the post.
    save: function () {
      return null;
    },
  });
})(window.wp.blocks, window.wp.element, window.wp.blockEditor);
