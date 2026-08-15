<?php
/**
 * Pairing, credentials and token minting. Two credentials, never
 * interchangeable: the site secret (never sent to a browser; signs every
 * server-to-server call) and the merchant JWT (HS256 over that secret,
 * 15 min TTL, minted only for a user who can manage the store).
 *
 * @package ProxyAI
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Pairing state, credentials and token minting for the ProxyAI connection.
 */
final class ProxyAI_Connection {

	public const OPTION_SECRET = 'proxyai_site_secret';
	public const OPTION_BOT_ID = 'proxyai_bot_id';
	/**
	 * Signature over this origin from connect. Not a credential — lets edge
	 * middleware set frame-ancestors without a DB read.
	 */
	public const OPTION_SITE_SIG       = 'proxyai_site_sig';
	public const OPTION_ENABLED        = 'proxyai_enabled';
	public const OPTION_LAST_HEARTBEAT = 'proxyai_last_heartbeat';
	/** Widget message origin, reported by ProxyAI at connect and refreshed each heartbeat. */
	public const OPTION_RUNTIME_URL = 'proxyai_runtime_url';

	/**
	 * Secret for signing VISITOR identity tokens (helpdesk ticket gate) —
	 * distinct from OPTION_SECRET, which authenticates this site to ProxyAI.
	 * Delivered by the heartbeat while the helpdesk add-on is owned.
	 */
	public const OPTION_IDENTITY_SECRET = 'proxyai_identity_secret';

	/**
	 * Dashboard-summary figures (credits, add-ons, bot name), written from each
	 * heartbeat so the admin page renders from the database without calling out.
	 */
	public const OPTION_SUMMARY = 'proxyai_summary';

	/** Dashboard token lifetime, in seconds. The service rejects anything older. */
	private const TOKEN_TTL = 900;

	/** Audience claim the service checks on the token. */
	private const TOKEN_AUDIENCE = 'proxyai';

	/** How often the heartbeat may fire, in seconds. */
	private const HEARTBEAT_INTERVAL = 6 * HOUR_IN_SECONDS;

	/**
	 * The capability that defines "may administer this store":
	 * `manage_woocommerce` on a store, `manage_options` without WooCommerce.
	 */
	public static function required_capability(): string {
		return class_exists( 'WooCommerce' ) ? 'manage_woocommerce' : 'manage_options';
	}

	/**
	 * Whether the current user may administer this store.
	 *
	 * @return bool Whether the user has the required capability.
	 */
	public static function can_manage(): bool {
		return current_user_can( self::required_capability() );
	}

	/**
	 * Whether pretty permalinks are on. /checkout-link/ is a rewrite endpoint,
	 * so "Plain" permalinks would 404 mid-purchase.
	 */
	public static function pretty_permalinks(): bool {
		return get_option( 'permalink_structure', '' ) !== '';
	}

	/**
	 * The canonical origin this site pairs under: lowercased scheme and host,
	 * default ports dropped. Pairing is keyed on this exact string, so it must
	 * be derived the same way every time.
	 */
	public static function site_origin(): string {
		$parts = wp_parse_url( home_url() );
		if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
			return '';
		}
		$scheme = $parts['scheme'] ?? 'https';
		$port   = isset( $parts['port'] ) && ! in_array( (int) $parts['port'], array( 80, 443 ), true )
			? ':' . (int) $parts['port']
			: '';
		return strtolower( $scheme . '://' . $parts['host'] . $port );
	}

	/**
	 * The stored site secret; empty when unpaired.
	 *
	 * @return string The secret, or ''.
	 */
	public static function secret(): string {
		$secret = get_option( self::OPTION_SECRET, '' );
		return is_string( $secret ) ? $secret : '';
	}

	/**
	 * The paired bot's id; empty when unpaired.
	 *
	 * @return string The bot id, or ''.
	 */
	public static function bot_id(): string {
		$id = get_option( self::OPTION_BOT_ID, '' );
		return is_string( $id ) ? $id : '';
	}

	/** Widget message base URL; constant fallback only pre-connect. */
	public static function runtime_url(): string {
		$stored = get_option( self::OPTION_RUNTIME_URL, '' );
		if ( is_string( $stored ) && '' !== $stored ) {
			return untrailingslashit( $stored );
		}
		return untrailingslashit( PROXYAI_RUNTIME_URL );
	}

	/**
	 * Stores the reported runtime origin; non-absolute-http(s) values are dropped.
	 *
	 * @param mixed $value The reported runtime URL.
	 */
	private static function store_runtime_url( $value ): void {
		if ( ! is_string( $value ) || '' === $value ) {
			return;
		}
		$url = esc_url_raw( trim( $value ) );
		if ( '' === $url || ! preg_match( '#^https?://#i', $url ) ) {
			return;
		}
		update_option( self::OPTION_RUNTIME_URL, untrailingslashit( $url ), false );
	}

	/**
	 * Whether this site holds both halves of the pairing.
	 *
	 * @return bool Whether the site is paired.
	 */
	public static function is_connected(): bool {
		return self::secret() !== '' && self::bot_id() !== '';
	}

	/**
	 * Whether the widget should render: paired and switched on.
	 *
	 * @return bool Whether the widget is enabled.
	 */
	public static function is_enabled(): bool {
		return self::is_connected() && self::widget_visible();
	}

	/**
	 * The merchant's show/hide switch, independent of pairing state. Defaults
	 * to visible so sites paired before this option existed keep showing the widget.
	 */
	public static function widget_visible(): bool {
		return get_option( self::OPTION_ENABLED, '1' ) === '1';
	}

	/**
	 * Autoloaded, unlike the other options here: is_enabled() runs on every
	 * front-end page load.
	 *
	 * @param bool $visible Whether the widget should show.
	 */
	public static function set_widget_visible( bool $visible ): void {
		update_option( self::OPTION_ENABLED, $visible ? '1' : '0', true );
	}

	/**
	 * Pairs with ProxyAI. The secret is stored *before* calling out — the
	 * remote side immediately calls back /proxyai/v1/confirm with a nonce only
	 * a holder of this secret can sign. Failure rolls the secret back.
	 */
	public static function connect() {
		if ( ! self::can_manage() ) {
			return new WP_Error( 'forbidden', __( 'You are not allowed to connect this site.', 'proxyai' ) );
		}

		$origin = self::site_origin();
		if ( '' === $origin ) {
			return new WP_Error( 'bad_site_url', __( 'This site has no usable address.', 'proxyai' ) );
		}

		$previous = self::secret();
		$secret   = wp_generate_password( 48, false );
		// Autoload off: the secret must never end up in a cached options blob.
		update_option( self::OPTION_SECRET, $secret, false );

		$response = wp_remote_post(
			PROXYAI_APP_URL . '/api/wordpress/connect',
			array(
				'timeout' => 20,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode(
					array(
						'site_url'          => $origin,
						'site_secret'       => $secret,
						'site_name'         => get_bloginfo( 'name' ),
						'admin_email'       => get_option( 'admin_email' ),
						'wp_version'        => get_bloginfo( 'version' ),
						'wc_version'        => defined( 'WC_VERSION' ) ? WC_VERSION : null,
						'pretty_permalinks' => self::pretty_permalinks(),
						'plugin_version'    => PROXYAI_VERSION,
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			update_option( self::OPTION_SECRET, $previous, false );
			return $response;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $code || ! is_array( $body ) || empty( $body['bot_id'] ) ) {
			update_option( self::OPTION_SECRET, $previous, false );
			$reason = is_array( $body ) && isset( $body['error'] ) ? (string) $body['error'] : 'unknown';
			return new WP_Error(
				'connect_failed',
				sprintf(
				/* translators: %s: machine-readable failure reason. */
					__( 'ProxyAI could not verify this site (%s). Check that this site is reachable over HTTPS from the public internet.', 'proxyai' ),
					$reason
				)
			);
		}

		update_option( self::OPTION_BOT_ID, (string) $body['bot_id'], false );
		update_option( self::OPTION_SITE_SIG, isset( $body['site_sig'] ) ? (string) $body['site_sig'] : '', false );
		update_option( self::OPTION_ENABLED, '1', true );
		self::store_runtime_url( $body['runtime_url'] ?? null );
		return true;
	}

	/**
	 * Notifies ProxyAI, then forgets credentials regardless of the call's
	 * outcome; the missing heartbeat is the remote backstop.
	 */
	public static function disconnect(): void {
		if ( self::is_connected() ) {
			self::signed_post( '/api/wordpress/disconnect', array() );
		}
		self::forget();
	}

	/** Drops credentials without notifying the service. */
	public static function forget(): void {
		delete_option( self::OPTION_SECRET );
		delete_option( self::OPTION_BOT_ID );
		delete_option( self::OPTION_SITE_SIG );
		delete_option( self::OPTION_LAST_HEARTBEAT );
		delete_option( self::OPTION_RUNTIME_URL );
		delete_option( self::OPTION_IDENTITY_SECRET );
		delete_option( self::OPTION_SUMMARY );
	}

	/**
	 * Account summary as of the last heartbeat. Nulls and an empty list before
	 * the first response.
	 *
	 * @return array{credits: ?string, addons: string[], bot_name: string}
	 */
	public static function summary(): array {
		$stored = get_option( self::OPTION_SUMMARY, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		$credits = isset( $stored['credits'] ) && is_string( $stored['credits'] ) ? $stored['credits'] : null;
		$addons  = array();
		foreach ( (array) ( $stored['addons'] ?? array() ) as $name ) {
			if ( is_string( $name ) && '' !== $name ) {
				$addons[] = $name;
			}
		}
		return array(
			'credits'  => $credits,
			'addons'   => $addons,
			'bot_name' => isset( $stored['bot_name'] ) && is_string( $stored['bot_name'] ) ? $stored['bot_name'] : '',
		);
	}

	/**
	 * Reports versions upstream every few hours. Carries wc_version so a later
	 * WooCommerce install gains cart features without reconnecting.
	 *
	 * @param bool $force Send even inside the rate-limit window.
	 */
	public static function heartbeat( bool $force = false ): void {
		if ( ! self::is_connected() ) {
			return;
		}
		$last = (int) get_option( self::OPTION_LAST_HEARTBEAT, 0 );
		if ( ! $force && $last > time() - self::HEARTBEAT_INTERVAL ) {
			return;
		}
		// Written before the call so a down remote is not retried on every
		// admin page load.
		update_option( self::OPTION_LAST_HEARTBEAT, time(), false );

		$response = self::signed_post(
			'/api/wordpress/heartbeat',
			array(
				'site_name'         => get_bloginfo( 'name' ),
				'wp_version'        => get_bloginfo( 'version' ),
				'wc_version'        => defined( 'WC_VERSION' ) ? WC_VERSION : null,
				// Reported every time: switching permalinks to "Plain" silently
				// breaks the checkout link the bot hands out.
				'pretty_permalinks' => self::pretty_permalinks(),
				'plugin_version'    => PROXYAI_VERSION,
			)
		);

		// The remote account is gone, so these credentials can never work
		// again; clear them locally and fall back to the connect screen.
		if ( is_wp_error( $response ) && $response->get_error_code() === 'site_unknown' ) {
			self::forget();
			return;
		}

		// Refreshed each heartbeat: if ProxyAI rotates the signing key, this is
		// what keeps the dashboard iframe frameable without a reconnect.
		if ( is_array( $response ) && ! empty( $response['site_sig'] ) ) {
			update_option( self::OPTION_SITE_SIG, (string) $response['site_sig'], false );
		}

		// The runtime origin can move; refresh it too.
		if ( is_array( $response ) ) {
			self::store_runtime_url( $response['runtime_url'] ?? null );
		}

		// Visitor-identity signing secret: present while the helpdesk add-on is
		// owned, null otherwise — stored or cleared to match, so a lapsed
		// add-on stops minting tokens.
		if ( is_array( $response ) && array_key_exists( 'identity_secret', $response ) ) {
			$identity_secret = $response['identity_secret'];
			if ( is_string( $identity_secret ) && '' !== $identity_secret ) {
				update_option( self::OPTION_IDENTITY_SECRET, $identity_secret, false );
			} else {
				delete_option( self::OPTION_IDENTITY_SECRET );
			}
		}

		// Dashboard figures, stored so the admin screen never waits on a
		// remote call.
		if ( is_array( $response ) && isset( $response['credits'] ) ) {
			update_option(
				self::OPTION_SUMMARY,
				array(
					'credits'  => (string) $response['credits'],
					'addons'   => array_values(
						array_filter(
							array_map( 'strval', (array) ( $response['addons'] ?? array() ) ),
							static fn( string $name ): bool => '' !== $name
						)
					),
					'bot_name' => isset( $response['bot_name'] ) ? (string) $response['bot_name'] : '',
				),
				false
			);
		}

		// Entitlement changes arrive only here; a newly bought Knowledge add-on
		// triggers a full crawl on the transition.
		if ( is_array( $response ) && array_key_exists( 'knowledge', $response ) ) {
			$owned     = (bool) $response['knowledge'];
			$was_owned = ProxyAI_Content_Sync::has_knowledge();
			ProxyAI_Content_Sync::set_knowledge( $owned );
			if ( $owned && ! $was_owned ) {
				ProxyAI_Content_Sync::start_crawl();
			}
		}
	}

	/**
	 * The stored origin signature from connect; empty when unpaired.
	 *
	 * @return string The signature, or ''.
	 */
	public static function site_signature(): string {
		$sig = get_option( self::OPTION_SITE_SIG, '' );
		return is_string( $sig ) ? $sig : '';
	}

	/**
	 * POSTs with an HMAC over the exact bytes. site_url is added here so it
	 * can never disagree with the secret — that pair is the identity.
	 *
	 * @param string              $path    The API path, starting with /.
	 * @param array<string,mixed> $payload The JSON payload to sign and send.
	 * @return array<string,mixed>|WP_Error
	 */
	public static function signed_post( string $path, array $payload ) {
		$secret = self::secret();
		if ( '' === $secret ) {
			return new WP_Error( 'not_connected', __( 'This site is not connected to ProxyAI.', 'proxyai' ) );
		}

		$payload['site_url'] = self::site_origin();
		$body                = wp_json_encode( $payload );
		if ( ! is_string( $body ) ) {
			return new WP_Error( 'encode_failed', __( 'Could not encode the request.', 'proxyai' ) );
		}

		$response = wp_remote_post(
			PROXYAI_APP_URL . $path,
			array(
				'timeout' => 15,
				'headers' => array(
					'Content-Type'        => 'application/json',
					'X-ProxyAI-Signature' => hash_hmac( 'sha256', $body, $secret ),
				),
				'body'    => $body,
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		// Header is stamped only while the failover is serving. The transient
		// expires on its own, so a site that stops calling stops warning.
		if ( wp_remote_retrieve_header( $response, 'x-proxyai-origin' ) === 'secondary' ) {
			set_transient( 'proxyai_failover_notice', 1, 10 * MINUTE_IN_SECONDS );
		} else {
			delete_transient( 'proxyai_failover_notice' );
		}

		// 410: the account was deleted. Never resolves by retrying — callers
		// use this to forget the stored credentials.
		if ( (int) wp_remote_retrieve_response_code( $response ) === 410 ) {
			return new WP_Error( 'site_unknown', __( 'ProxyAI has no record of this site.', 'proxyai' ) );
		}

		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		return is_array( $decoded ) ? $decoded : array();
	}

	/**
	 * Mints a short-lived dashboard token; users without the capability get no
	 * token at all. Returns an empty string when this site cannot mint one.
	 */
	public static function mint_token(): string {
		$secret = self::secret();
		if ( '' === $secret || ! self::can_manage() ) {
			return '';
		}

		$user   = wp_get_current_user();
		$now    = time();
		$claims = array(
			'iss'           => self::site_origin(),
			'aud'           => self::TOKEN_AUDIENCE,
			'iat'           => $now,
			// Backdated a minute to tolerate host clock skew.
			'nbf'           => $now - 60,
			'exp'           => $now + self::TOKEN_TTL,
			'wp_user_id'    => (int) $user->ID,
			'wp_user_email' => (string) $user->user_email,
			'can_manage'    => true,
		);

		$segments      = array(
			self::base64url(
				(string) wp_json_encode(
					array(
						'alg' => 'HS256',
						'typ' => 'JWT',
					)
				)
			),
			self::base64url( (string) wp_json_encode( $claims ) ),
		);
		$signing_input = implode( '.', $segments );
		$segments[]    = self::base64url( hash_hmac( 'sha256', $signing_input, $secret, true ) );

		return implode( '.', $segments );
	}

	/**
	 * Mints the visitor identity token the widget attaches to messages: proof
	 * that this visitor is logged in on the store, which gates the ticket flow.
	 * Format the service verifies:
	 * base64url(payload).base64url(HMAC-SHA256(payload_b64, secret)).
	 * Empty when nobody is logged in or the secret is absent.
	 */
	public static function mint_visitor_token(): string {
		$secret = get_option( self::OPTION_IDENTITY_SECRET, '' );
		if ( ! is_string( $secret ) || '' === $secret || ! is_user_logged_in() ) {
			return '';
		}
		$user    = wp_get_current_user();
		$payload = self::base64url(
			(string) wp_json_encode(
				array(
					'user_id' => 'wp:' . (int) $user->ID,
					'email'   => (string) $user->user_email,
					'name'    => (string) $user->display_name,
					'exp'     => time() + DAY_IN_SECONDS,
				)
			)
		);
		return $payload . '.' . self::base64url( hash_hmac( 'sha256', $payload, $secret, true ) );
	}

	/**
	 * Signs an arbitrary message with the site secret. Used by the confirm endpoint.
	 *
	 * @param string $message The message to sign.
	 * @return string The hex HMAC, or '' when unpaired.
	 */
	public static function sign( string $message ): string {
		$secret = self::secret();
		return '' === $secret ? '' : hash_hmac( 'sha256', $message, $secret );
	}

	/**
	 * Base64url-encodes a string, unpadded.
	 *
	 * @param string $raw The bytes to encode.
	 * @return string The encoded string.
	 */
	private static function base64url( string $raw ): string {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- JWT base64url encoding, not obfuscation.
		return rtrim( strtr( base64_encode( $raw ), '+/', '-_' ), '=' );
	}
}
