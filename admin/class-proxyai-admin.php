<?php
/**
 * The wp-admin surface: a connect screen, and a native status screen once
 * connected.
 *
 * The hosted dashboard opens in a new tab — nothing external is framed inside
 * wp-admin, and every figure shown here came from the last server-to-server
 * heartbeat, not the merchant's browser.
 *
 * @package ProxyAI
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The wp-admin screens and admin-post handlers.
 */
final class ProxyAI_Admin {

	private const PAGE_SLUG         = 'proxyai';
	private const CONNECT_ACTION    = 'proxyai_connect';
	private const DISCONNECT_ACTION = 'proxyai_disconnect';
	private const LAUNCH_ACTION     = 'proxyai_launch';
	private const WIDGET_ACTION     = 'proxyai_widget';

	/**
	 * This page's hook suffix, so the stylesheet enqueues here and nowhere else.
	 *
	 * @var string
	 */
	private static string $hook = '';

	/**
	 * Hooks the menu, admin-post handlers, heartbeat and assets.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
		add_action( 'admin_post_' . self::CONNECT_ACTION, array( self::class, 'handle_connect' ) );
		add_action( 'admin_post_' . self::DISCONNECT_ACTION, array( self::class, 'handle_disconnect' ) );
		// Opens the hosted dashboard signed in. Reaching the handler mints a
		// credential, so it sits behind admin-post + nonce + capability.
		add_action( 'admin_post_' . self::LAUNCH_ACTION, array( self::class, 'handle_launch' ) );
		// Widget switch for the no-JavaScript fallback; the dashboard app
		// writes through the REST route in ProxyAI_Admin_Api.
		add_action( 'admin_post_' . self::WIDGET_ACTION, array( self::class, 'handle_widget' ) );
		add_action( 'admin_init', array( ProxyAI_Connection::class, 'heartbeat' ) );
		add_action( 'admin_notices', array( self::class, 'failover_notice' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue_styles' ) );
		add_filter( 'plugin_row_meta', array( self::class, 'row_meta' ), 10, 2 );
	}

	/**
	 * Adds a Docs link to this plugin's row on the Plugins screen.
	 *
	 * @param array  $meta Existing row meta links.
	 * @param string $file Plugin basename being rendered.
	 * @return array Row meta with the Docs link appended for this plugin.
	 */
	public static function row_meta( array $meta, string $file ): array {
		if ( plugin_basename( PROXYAI_PLUGIN_FILE ) === $file ) {
			$meta[] = '<a href="https://www.proxyai.app/help" target="_blank" rel="noopener noreferrer">' . esc_html__( 'Docs', 'proxyai' ) . '</a>';
		}
		return $meta;
	}

	/**
	 * Says so when ProxyAI is answering from its backup servers. The flag is
	 * set by the connection helper from a response header — this makes no
	 * request of its own.
	 */
	public static function failover_notice(): void {
		if ( ! get_transient( 'proxyai_failover_notice' ) ) {
			return;
		}
		printf(
			'<div class="notice notice-warning"><p><strong>%s</strong> %s</p></div>',
			esc_html__( 'ProxyAI is running on backup servers.', 'proxyai' ),
			esc_html__( 'Your chatbot keeps working — replies may be a little slower than usual.', 'proxyai' )
		);
	}

	/**
	 * Adds the ProxyAI admin page to the menu.
	 */
	public static function menu(): void {
		// Under WooCommerce when it exists, top level otherwise.
		$parent     = class_exists( 'WooCommerce' ) ? 'woocommerce' : null;
		$capability = ProxyAI_Connection::required_capability();

		if ( $parent ) {
			$hook = add_submenu_page( $parent, 'ProxyAI', 'ProxyAI', $capability, self::PAGE_SLUG, array( self::class, 'render' ) );
		} else {
			$hook = add_menu_page( 'ProxyAI', 'ProxyAI', $capability, self::PAGE_SLUG, array( self::class, 'render' ), 'dashicons-format-chat', 58 );
		}

		// `load-{hook}` fires only on this screen, keeping the forced
		// heartbeat off every other admin page.
		if ( $hook ) {
			self::$hook = $hook;
			add_action( 'load-' . $hook, array( self::class, 'prepare_screen' ) );
		}
	}

	/**
	 * The screen's stylesheet and, once connected, the dashboard app —
	 * enqueued on this screen only. The app rides WordPress's bundled
	 * `wp-element` and `wp-api-fetch`, which carries the REST nonce.
	 *
	 * @param string $hook The current admin page's hook suffix.
	 */
	public static function enqueue_styles( string $hook ): void {
		if ( $hook !== self::$hook ) {
			return;
		}
		wp_enqueue_style(
			'proxyai-admin',
			plugins_url( 'admin/css/admin.css', PROXYAI_PLUGIN_FILE ),
			array(),
			PROXYAI_VERSION
		);

		if ( ! ProxyAI_Connection::is_connected() ) {
			return;
		}

		wp_enqueue_script(
			'proxyai-dashboard',
			plugins_url( 'admin/js/dashboard.js', PROXYAI_PLUGIN_FILE ),
			array( 'wp-element', 'wp-api-fetch', 'wp-i18n' ),
			PROXYAI_VERSION,
			true
		);

		wp_add_inline_script(
			'proxyai-dashboard',
			'window.ProxyAIDash = ' . wp_json_encode(
				array(
					'version'       => PROXYAI_VERSION,
					// Footer legal links only; API traffic goes through this
					// site's own REST proxy, never straight to the app.
					'appUrl'        => PROXYAI_APP_URL,
					// For the multipart avatar upload, which apiFetch cannot make;
					// it goes through plain fetch with the same nonce.
					'restUrl'       => esc_url_raw( rest_url() ),
					'restNonce'     => wp_create_nonce( 'wp_rest' ),
					// Bundled channel brand marks for the Channels grid.
					'assetsUrl'     => esc_url_raw( plugins_url( 'assets/', PROXYAI_PLUGIN_FILE ) ),
					// Signed-in hop to the app for OAuth connect buttons: the
					// dashboard posts this form into a new tab with a `next` path.
					'launch'        => array(
						'url'    => esc_url_raw( admin_url( 'admin-post.php' ) ),
						'action' => self::LAUNCH_ACTION,
						'nonce'  => wp_create_nonce( self::LAUNCH_ACTION ),
					),
					// Not wp_nonce_url: it HTML-escapes, and location.href with
					// "&amp;_wpnonce=" loses the nonce.
					'disconnectUrl' => add_query_arg(
						array(
							'action'   => self::DISCONNECT_ACTION,
							'_wpnonce' => wp_create_nonce( self::DISCONNECT_ACTION ),
						),
						admin_url( 'admin-post.php' )
					),
				)
			) . ';',
			'before'
		);
	}

	/**
	 * Runs before this screen renders: a forced heartbeat, which clears a
	 * deleted pairing and refreshes the summary figures the screen displays.
	 */
	public static function prepare_screen(): void {
		ProxyAI_Connection::heartbeat( true );
	}

	/**
	 * Renders the admin page: connect screen, or the connected home.
	 */
	public static function render(): void {
		if ( ! ProxyAI_Connection::can_manage() ) {
			wp_die( esc_html__( 'You do not have permission to view this page.', 'proxyai' ) );
		}

		// The heartbeat already ran in prepare_screen().
		if ( ! ProxyAI_Connection::is_connected() ) {
			self::render_connect();
			return;
		}
		self::render_home();
	}

	/**
	 * The message a redirect back to this page carried, sanitised. No nonce
	 * check: the admin-post handlers verified one before redirecting here,
	 * and the value selects no action — it is sanitised here and escaped
	 * where printed.
	 */
	private static function requested_error(): string {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return isset( $_GET['proxyai_error'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['proxyai_error'] ) ) : '';
	}

	/**
	 * Renders the pre-connection screen: disclosure, checks, connect button.
	 */
	private static function render_connect(): void {
		$error = self::requested_error();
		?>
		<div class="wrap proxyai-connect">
			<div class="proxyai-connect__mark">
				<?php // Bundled asset: this screen makes no external request. ?>
				<img src="<?php echo esc_url( plugins_url( 'assets/logo.svg', PROXYAI_PLUGIN_FILE ) ); ?>" alt="" width="44"
					height="44">
				<h1><?php esc_html_e( 'ProxyAI', 'proxyai' ); ?></h1>
			</div>

			<?php if ( '' !== $error ) : ?>
				<div class="proxyai-connect__error"><?php echo esc_html( $error ); ?></div>
			<?php endif; ?>

			<div class="proxyai-connect__card">
				<p class="proxyai-connect__lede">
					<?php esc_html_e( 'Connect this site to ProxyAI to add an AI assistant that answers from your own content. No account or credit card is needed — connecting creates one for you.', 'proxyai' ); ?>
				</p>
				<h2><?php esc_html_e( 'Before you connect', 'proxyai' ); ?></h2>
				<ul class="proxyai-connect__checks">
					<li>
						<?php
						printf(
							/* translators: %s: this site's confirmation endpoint URL. */
							esc_html__( 'Your site must be reachable over HTTPS from the public internet. ProxyAI calls back to %s to verify that you control this domain, so a local or password-protected site cannot connect.', 'proxyai' ),
							'<code>' . esc_html( ProxyAI_Connection::site_origin() . '/wp-json/proxyai/v1/confirm' ) . '</code>'
						);
						?>
					</li>
					<li>
						<?php
						esc_html_e( 'The chatbot itself is free. Credit is only what it spends while answering, and you can top it up from the dashboard at any time.', 'proxyai' );
						?>
					</li>
				</ul>
				<?php // What connecting sends, disclosed before the button. ?>
				<hr class="proxyai-connect__rule">
				<p class="proxyai-connect__fine">
					<?php esc_html_e( 'Connecting sends this site\'s address, name, administration email address, and its WordPress and WooCommerce versions to ProxyAI, and creates an account tied to this domain. Nothing else leaves your site unless you turn it on.', 'proxyai' ); ?>
				</p>
				<p class="proxyai-connect__fine">
					<?php esc_html_e( 'While connected, this site reports its name, plugin version, and WordPress and WooCommerce versions to ProxyAI every six hours, so your dashboard reflects the install and add-ons you own. Once the assistant is live, visitors\' messages are sent to ProxyAI to be answered. Your posts and pages are sent only if you add the Knowledge add-on (available free with a badge, or paid without). Disconnecting stops all of it.', 'proxyai' ); ?>
				</p>
				<p class="proxyai-connect__fine">
					<?php
					$legal = array(
						'terms'             => __( 'Terms of Service', 'proxyai' ),
						'privacy'           => __( 'Privacy Policy', 'proxyai' ),
						'service-agreement' => __( 'Service Agreement', 'proxyai' ),
					);
					$links = array();
					foreach ( $legal as $slug => $label ) {
						$links[] = sprintf(
							'<a href="%s" target="_blank" rel="noopener noreferrer">%s</a>',
							esc_url( PROXYAI_APP_URL . '/' . $slug ),
							esc_html( $label )
						);
					}
					printf(
						/* translators: %s: links to the Terms of Service, Privacy Policy and Service Agreement. */
						esc_html__( 'By connecting you agree to our %s.', 'proxyai' ),
						// Already escaped piecewise above; the joined string is markup.
						implode( ', ', $links ) // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
					);
					?>
				</p>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="<?php echo esc_attr( self::CONNECT_ACTION ); ?>">
					<?php wp_nonce_field( self::CONNECT_ACTION ); ?>
					<button type="submit" class="proxyai-connect__go">
						<?php esc_html_e( 'Connect to ProxyAI', 'proxyai' ); ?>
					</button>
				</form>
			</div>
		</div>
		<?php
	}

	/**
	 * The connected screen. PHP renders the frame and a no-JavaScript
	 * fallback; the enqueued `dashboard.js` renders everything else against
	 * this site's own REST proxy. Nothing external is framed.
	 */
	private static function render_home(): void {
		?>
		<div class="proxyai-dash-wrap">
			<div class="proxyai-dash">
				<div class="proxyai-connect__mark">
					<img src="<?php echo esc_url( plugins_url( 'assets/logo.svg', PROXYAI_PLUGIN_FILE ) ); ?>" alt=""
						width="44" height="44">
					<h1><?php esc_html_e( 'ProxyAI', 'proxyai' ); ?></h1>
					<span class="proxyai-home__pill"><?php esc_html_e( 'Connected', 'proxyai' ); ?></span>
				</div>
				<?php $error = self::requested_error(); ?>
				<?php if ( '' !== $error ) : ?>
					<div class="proxyai-connect__error"><?php echo esc_html( $error ); ?></div>
				<?php endif; ?>
				<div id="proxyai-dashboard"></div>
				<noscript>
					<?php self::render_home_fallback(); ?>
				</noscript>
			</div>
		</div>
		<?php
	}

	/**
	 * No-JavaScript fallback: the widget switch and disconnect controls, plus
	 * the summary figures the last heartbeat stored.
	 */
	private static function render_home_fallback(): void {
		$summary        = ProxyAI_Connection::summary();
		$widget_visible = ProxyAI_Connection::widget_visible();
		$bot_name       = '' !== $summary['bot_name'] ? $summary['bot_name'] : __( 'Your assistant', 'proxyai' );
		?>
		<div class="wrap proxyai-connect proxyai-home">
			<div class="proxyai-connect__card">
				<h2><?php esc_html_e( 'This site', 'proxyai' ); ?></h2>
				<p class="proxyai-home__bot"><?php echo esc_html( $bot_name ); ?></p>
				<p class="proxyai-connect__fine"><?php echo esc_html( ProxyAI_Connection::site_origin() ); ?></p>

				<div class="proxyai-home__facts">
					<div class="proxyai-home__fact">
						<span class="proxyai-home__fact-label"><?php esc_html_e( 'Credit balance', 'proxyai' ); ?></span>
						<span class="proxyai-home__fact-value">
							<?php
							// A dash until the first heartbeat response lands.
							echo null === $summary['credits']
								? esc_html__( '—', 'proxyai' )
								: esc_html( '$' . number_format( (float) $summary['credits'], 2 ) );
							?>
						</span>
					</div>
					<div class="proxyai-home__fact">
						<span class="proxyai-home__fact-label"><?php esc_html_e( 'Add-ons', 'proxyai' ); ?></span>
						<span class="proxyai-home__fact-value">
							<?php
							echo array() === $summary['addons']
								? esc_html__( 'None yet', 'proxyai' )
								: esc_html( implode( ', ', $summary['addons'] ) );
							?>
						</span>
					</div>
				</div>

				<?php
				// A form, not a link: the handler must run server-side (it
				// mints a sign-in code over the signed channel).
				?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" target="_blank">
					<input type="hidden" name="action" value="<?php echo esc_attr( self::LAUNCH_ACTION ); ?>">
					<?php wp_nonce_field( self::LAUNCH_ACTION ); ?>
					<button type="submit" class="proxyai-connect__go">
						<?php esc_html_e( 'Open the ProxyAI dashboard', 'proxyai' ); ?>
					</button>
				</form>
				<p class="proxyai-connect__fine proxyai-home__hint">
					<?php
					printf(
						/* translators: %s: the ProxyAI dashboard hostname. */
						esc_html__( 'Opens %s in a new tab, signed in as this site\'s account. Configure the assistant, buy add-ons and top up credit there.', 'proxyai' ),
						esc_html( (string) wp_parse_url( PROXYAI_APP_URL, PHP_URL_HOST ) )
					);
					?>
				</p>
			</div>

			<div class="proxyai-connect__card">
				<h2><?php esc_html_e( 'Chat widget', 'proxyai' ); ?></h2>
				<p class="proxyai-connect__fine">
					<?php
					echo $widget_visible
						? esc_html__( 'Visible — the assistant appears on every page of your site.', 'proxyai' )
						: esc_html__( 'Hidden — visitors see no chat button, and the widget script is not loaded at all.', 'proxyai' );
					?>
				</p>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="<?php echo esc_attr( self::WIDGET_ACTION ); ?>">
					<input type="hidden" name="visible" value="<?php echo $widget_visible ? '0' : '1'; ?>">
					<?php wp_nonce_field( self::WIDGET_ACTION ); ?>
					<button type="submit" class="proxyai-home__secondary">
						<?php
						echo $widget_visible
							? esc_html__( 'Hide the widget', 'proxyai' )
							: esc_html__( 'Show the widget', 'proxyai' );
						?>
					</button>
				</form>
			</div>

			<div class="proxyai-connect__card">
				<h2><?php esc_html_e( 'Disconnect', 'proxyai' ); ?></h2>
				<p class="proxyai-connect__fine">
					<?php esc_html_e( 'Removes the assistant from this site and clears the stored credentials. Your ProxyAI account, credits and billing history are kept, and reconnecting this site restores the same account.', 'proxyai' ); ?>
				</p>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="<?php echo esc_attr( self::DISCONNECT_ACTION ); ?>">
					<?php wp_nonce_field( self::DISCONNECT_ACTION ); ?>
					<button type="submit" class="proxyai-home__danger">
						<?php esc_html_e( 'Disconnect this site', 'proxyai' ); ?>
					</button>
				</form>
			</div>
		</div>
		<?php
	}

	/**
	 * The admin-post handler that pairs the site, then redirects back to the page.
	 */
	public static function handle_connect(): void {
		check_admin_referer( self::CONNECT_ACTION );
		if ( ! ProxyAI_Connection::can_manage() ) {
			wp_die( esc_html__( 'You do not have permission to do that.', 'proxyai' ) );
		}

		$result = ProxyAI_Connection::connect();
		$args   = array( 'page' => self::PAGE_SLUG );
		if ( is_wp_error( $result ) ) {
			$args['proxyai_error'] = $result->get_error_message();
		}
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) );
		exit;
	}

	/**
	 * The admin-post handler that disconnects the site, then redirects back.
	 */
	public static function handle_disconnect(): void {
		check_admin_referer( self::DISCONNECT_ACTION );
		if ( ! ProxyAI_Connection::can_manage() ) {
			wp_die( esc_html__( 'You do not have permission to do that.', 'proxyai' ) );
		}

		ProxyAI_Connection::disconnect();
		wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE_SLUG ), admin_url( 'admin.php' ) ) );
		exit;
	}

	/**
	 * Opens the dashboard: mints a single-use, one-minute sign-in code over
	 * the signed server-to-server channel, then redirects to redeem it. The
	 * code is the only thing that ever appears in a URL — the site secret
	 * stays server-side. Gates: admin-post, nonce, capability.
	 */
	public static function handle_launch(): void {
		check_admin_referer( self::LAUNCH_ACTION );
		if ( ! ProxyAI_Connection::can_manage() ) {
			wp_die( esc_html__( 'You do not have permission to do that.', 'proxyai' ) );
		}

		$response = ProxyAI_Connection::signed_post( '/api/wordpress/sso-code', array() );
		$code     = is_array( $response ) && isset( $response['code'] ) && is_string( $response['code'] )
			? $response['code']
			: '';

		if ( '' === $code ) {
			wp_safe_redirect(
				add_query_arg(
					array(
						'page'          => self::PAGE_SLUG,
						'proxyai_error' => __( 'Could not reach ProxyAI to open the dashboard. Try again in a moment.', 'proxyai' ),
					),
					admin_url( 'admin.php' )
				)
			);
			exit;
		}

		// Optional landing path on the app. Relative paths only; the SSO
		// route enforces the same rule again server-side.
		$next  = isset( $_POST['next'] ) ? sanitize_text_field( wp_unslash( (string) $_POST['next'] ) ) : '';
		$query = '?code=' . rawurlencode( $code );
		// Same-origin relative paths only. "//host" and the backslash forms
		// ("/\host", "/%5Chost") resolve to another origin because URL parsers
		// treat "\" as "/" — reject any backslash outright.
		$next_ok = '' !== $next
			&& '/' === $next[0]
			&& ( ! isset( $next[1] ) || ( '/' !== $next[1] && '\\' !== $next[1] ) )
			&& strpos( $next, '\\' ) === false
			&& stripos( $next, '%5c' ) === false;
		if ( $next_ok ) {
			$query .= '&next=' . rawurlencode( $next );
		}

		// Off-site on purpose, so wp_redirect rather than wp_safe_redirect;
		// the destination is a constant, not request-derived.
		wp_redirect( PROXYAI_APP_URL . '/api/wordpress/sso' . $query ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect
		exit;
	}

	/**
	 * Shows or hides the widget on the public site. The switch is a local
	 * option rather than bot config: hiding it remotely would still enqueue
	 * the script on every page view. Gates: admin-post, nonce, capability.
	 */
	public static function handle_widget(): void {
		check_admin_referer( self::WIDGET_ACTION );
		if ( ! ProxyAI_Connection::can_manage() ) {
			wp_die( esc_html__( 'You do not have permission to do that.', 'proxyai' ) );
		}

		if ( isset( $_POST['visible'] ) ) {
			ProxyAI_Connection::set_widget_visible(
				sanitize_text_field( wp_unslash( $_POST['visible'] ) ) === '1'
			);
		}
		wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE_SLUG ), admin_url( 'admin.php' ) ) );
		exit;
	}
}
