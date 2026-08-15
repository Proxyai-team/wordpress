<?php
/**
 * Plugin Name:       ProxyAI
 * Plugin URI:        https://wordpress.org/plugins/proxyai/
 * Description:       AI chat assistant for your site and WooCommerce store. Answers questions from your own content, hands off to a human, and adds to the cart in the shopper's browser.
 * Version:           1.0.3
 * Requires at least: 6.2
 * Requires PHP:      8.1
 * Author:            ProxyAI
 * Author URI:        https://www.proxyai.app
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       proxyai
 *
 * The `Version:` header is the source of truth; PROXYAI_VERSION below must match it.
 *
 * @package ProxyAI
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const PROXYAI_VERSION = '1.0.2';

/** Service origin. Overridable for development. */
if ( ! defined( 'PROXYAI_APP_URL' ) ) {
	define( 'PROXYAI_APP_URL', 'https://www.proxyai.app' );
}

/** Fallback runtime origin, used only before pairing; the paired value wins once stored. */
if ( ! defined( 'PROXYAI_RUNTIME_URL' ) ) {
	define( 'PROXYAI_RUNTIME_URL', 'https://www.proxyai.app' );
}

define( 'PROXYAI_PLUGIN_FILE', __FILE__ );
define( 'PROXYAI_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
// URL for the plugin's own assets (not the service URL).
define( 'PROXYAI_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require_once PROXYAI_PLUGIN_DIR . 'includes/class-proxyai-connection.php';
require_once PROXYAI_PLUGIN_DIR . 'includes/class-proxyai-content-sync.php';
require_once PROXYAI_PLUGIN_DIR . 'includes/class-proxyai-order-lookup.php';
require_once PROXYAI_PLUGIN_DIR . 'includes/class-proxyai-rest-api.php';
require_once PROXYAI_PLUGIN_DIR . 'includes/class-proxyai-admin-api.php';
require_once PROXYAI_PLUGIN_DIR . 'includes/class-proxyai-widget.php';
require_once PROXYAI_PLUGIN_DIR . 'admin/class-proxyai-admin.php';

/**
 * Boots the plugin. An unconnected site still needs the admin screen and
 * REST endpoint in order to connect.
 */
function proxyai_boot(): void {
	ProxyAI_Rest_Api::register();
	ProxyAI_Admin_Api::register();
	ProxyAI_Order_Lookup::register();
	ProxyAI_Widget::register();
	ProxyAI_Content_Sync::register();
	if ( is_admin() ) {
		ProxyAI_Admin::register();
	}
}
add_action( 'plugins_loaded', 'proxyai_boot' );

/**
 * Notifies ProxyAI so the pairing is torn down remotely too. Synchronous and
 * best effort: this is the last point the site secret can sign the request.
 */
function proxyai_deactivate(): void {
	// Clear scheduled events, or WP-Cron fires them into a fatal error later.
	wp_clear_scheduled_hook( 'proxyai_sync_flush' );
	wp_clear_scheduled_hook( 'proxyai_sync_crawl' );
	ProxyAI_Connection::disconnect();
}
register_deactivation_hook( __FILE__, 'proxyai_deactivate' );

/**
 * Removes the plugin's own options only; the remote account is kept so a
 * reinstall lands on the same customer.
 */
function proxyai_uninstall(): void {
	// forget() removes all connection credentials, including the
	// visitor-identity signing secret; everything is re-delivered on reconnect.
	ProxyAI_Connection::forget();
	delete_option( ProxyAI_Connection::OPTION_ENABLED );
	delete_option( ProxyAI_Content_Sync::OPTION_KNOWLEDGE );
	delete_option( ProxyAI_Content_Sync::OPTION_QUEUE );
	delete_option( ProxyAI_Content_Sync::OPTION_SYNC_ENABLED );
}
register_uninstall_hook( __FILE__, 'proxyai_uninstall' );
