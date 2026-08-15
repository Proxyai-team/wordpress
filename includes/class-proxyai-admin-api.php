<?php
/**
 * The dashboard's data plane: a REST proxy from wp-admin to ProxyAI.
 *
 * The dashboard's JavaScript calls this site's own REST API (cookie-
 * authenticated, nonce-checked, capability gated); PHP forwards allowlisted
 * calls server-to-server with a short-lived JWT minted from the site secret.
 * The browser holds no ProxyAI credential and the secret never leaves PHP.
 *
 * The allowlist keeps this from being an open proxy: only the dashboard's own
 * endpoints are reachable, and bot-scoped paths are pinned to this site's bot.
 *
 * @package ProxyAI
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Cookie-authenticated REST proxy between wp-admin and ProxyAI.
 */
final class ProxyAI_Admin_Api {

	private const REST_NAMESPACE = 'proxyai/v1';

	/**
	 * Dashboard endpoints under /api/wordpress/ this proxy may reach.
	 * Compared against the first path segment after `wordpress/`.
	 */
	private const WORDPRESS_ENDPOINTS = array(
		'state',
		'settings',
		'rates',
		'analytics',
		'tickets',
		'onboarding',
		'commerce',
		'checkout',
		// Development only; the server 404s it on production and it still
		// requires this site's credential.
		'dev-reset',
	);

	/**
	 * Hooks route registration into rest_api_init.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	/**
	 * Registers the dashboard's REST routes.
	 */
	public static function routes(): void {
		// The widget switch. Local, not proxied — the option lives on this
		// site. Answers with what is actually stored.
		register_rest_route(
			self::REST_NAMESPACE,
			'/widget',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => static fn(): array => array( 'visible' => ProxyAI_Connection::widget_visible() ),
					'permission_callback' => array( ProxyAI_Connection::class, 'can_manage' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => static function ( WP_REST_Request $request ): array {
						ProxyAI_Connection::set_widget_visible( true === $request['visible'] || '1' === $request['visible'] );
						return array( 'visible' => ProxyAI_Connection::widget_visible() );
					},
					'permission_callback' => array( ProxyAI_Connection::class, 'can_manage' ),
				),
			)
		);

		// The content-sync switch. Local like the widget switch: the option
		// lives on this site and gates the save/delete listeners.
		register_rest_route(
			self::REST_NAMESPACE,
			'/sync',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => static fn(): array => array( 'enabled' => ProxyAI_Content_Sync::sync_enabled() ),
					'permission_callback' => array( ProxyAI_Connection::class, 'can_manage' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => static function ( WP_REST_Request $request ): array {
						ProxyAI_Content_Sync::set_sync_enabled( true === $request['enabled'] || '1' === $request['enabled'] );
						return array( 'enabled' => ProxyAI_Content_Sync::sync_enabled() );
					},
					'permission_callback' => array( ProxyAI_Connection::class, 'can_manage' ),
				),
			)
		);

		// The knowledge implant chain, run server-side because wp-admin's
		// origin cannot be named by the bucket's CORS policy. Every URL this
		// PUTs to came out of an authenticated ProxyAI response — nothing
		// request-supplied is fetched.
		register_rest_route(
			self::REST_NAMESPACE,
			'/rag/implant',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'rag_implant' ),
				'permission_callback' => array( ProxyAI_Connection::class, 'can_manage' ),
			)
		);

		// Inbox attachment bytes, streamed raw (the JSON proxy would wrap them
		// as {raw}). The opaque key is upstream-scoped to this site's bot and
		// rides as a query param: its slashes would 404 in the path on hosts
		// with AllowEncodedSlashes Off.
		register_rest_route(
			self::REST_NAMESPACE,
			'/attachment',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'attachment' ),
				'permission_callback' => array( ProxyAI_Connection::class, 'can_manage' ),
				'args'                => array(
					'key' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/admin/(?P<path>.+)',
			array(
				'methods'             => array( 'GET', 'POST', 'PATCH', 'DELETE' ),
				'callback'            => array( self::class, 'proxy' ),
				// Capability check on top of WordPress's own cookie + X-WP-Nonce
				// check for logged-in REST calls.
				'permission_callback' => array( ProxyAI_Connection::class, 'can_manage' ),
				'args'                => array(
					'path' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);
	}

	/**
	 * Whether a forward path is one the dashboard may reach: the WordPress
	 * dashboard endpoints, and this site's own bot. Any other bot id is
	 * refused here — the plugin must not relay probes of another tenancy.
	 *
	 * @param string $path The forward path, relative to /api/.
	 * @return bool Whether the path may be forwarded.
	 */
	public static function path_allowed( string $path ): bool {
		// Reject dot segments (and encoded %2e): bots/{id}/../x passes the
		// prefix pin below, then the HTTP client normalizes the .. away and
		// reaches an endpoint off the allowlist.
		if ( preg_match( '#(^|/)\.\.?(/|$)#', $path ) || stripos( $path, '%2e' ) !== false ) {
			return false;
		}
		if ( preg_match( '#^wordpress/([a-z-]+)(/[a-z-]+)?$#', $path, $m ) ) {
			return in_array( $m[1], self::WORDPRESS_ENDPOINTS, true );
		}

		// Agent photo; the route scopes itself to the authenticated account.
		if ( 'account/avatar' === $path ) {
			return true;
		}

		$bot_id = ProxyAI_Connection::bot_id();
		if ( '' !== $bot_id && str_starts_with( $path, 'bots/' . $bot_id . '/' ) ) {
			return true;
		}

		return false;
	}

	/**
	 * Rebuilds a multipart/form-data body from the parsed text and file parts;
	 * PHP has already consumed the original body into $_POST/$_FILES, so it
	 * cannot be relayed verbatim.
	 *
	 * @param array<string,mixed> $fields   Text parts (get_body_params()).
	 * @param array<string,mixed> $files    File parts (get_file_params()).
	 * @param string              $boundary The multipart boundary string.
	 * @return string The rebuilt multipart body.
	 */
	private static function multipart_body( array $fields, array $files, string $boundary ): string {
		$eol = "\r\n";
		$out = '';
		foreach ( $fields as $name => $value ) {
			if ( is_array( $value ) ) {
				continue;
			}
			$out .= '--' . $boundary . $eol;
			$out .= 'Content-Disposition: form-data; name="' . $name . '"' . $eol . $eol;
			$out .= (string) $value . $eol;
		}
		foreach ( $files as $name => $file ) {
			if ( ! is_array( $file ) || ! isset( $file['tmp_name'] ) ) {
				continue;
			}
			// Strip `[]` so the app sees the field name it reads (getAll('files')).
			$field = str_ends_with( $name, '[]' ) ? substr( $name, 0, -2 ) : $name;
			if ( is_array( $file['tmp_name'] ) ) {
				$count = count( $file['tmp_name'] );
				for ( $i = 0; $i < $count; $i++ ) {
					$out .= self::file_part(
						$boundary,
						$field,
						(string) ( $file['name'][ $i ] ?? 'upload' ),
						(string) ( $file['type'][ $i ] ?? '' ),
						(string) ( $file['tmp_name'][ $i ] ?? '' )
					);
				}
			} else {
				$out .= self::file_part(
					$boundary,
					$field,
					(string) ( $file['name'] ?? 'upload' ),
					(string) ( $file['type'] ?? '' ),
					(string) $file['tmp_name']
				);
			}
		}
		$out .= '--' . $boundary . '--' . $eol;
		return $out;
	}

	/**
	 * One file part for multipart_body(); empty string if the file is unreadable.
	 *
	 * @param string $boundary The multipart boundary string.
	 * @param string $field    The form field name.
	 * @param string $filename The uploaded file's name.
	 * @param string $type     The uploaded file's MIME type.
	 * @param string $tmp_name Path to the uploaded temp file.
	 * @return string The encoded part, or '' when unreadable.
	 */
	private static function file_part( string $boundary, string $field, string $filename, string $type, string $tmp_name ): string {
		if ( '' === $tmp_name ) {
			return '';
		}
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local uploaded tmp file, not a URL.
		$contents = file_get_contents( $tmp_name );
		if ( false === $contents ) {
			return '';
		}
		$eol = "\r\n";
		return '--' . $boundary . $eol
			. 'Content-Disposition: form-data; name="' . $field . '"; filename="' . $filename . '"' . $eol
			. 'Content-Type: ' . ( '' !== $type ? $type : 'application/octet-stream' ) . $eol . $eol
			. $contents . $eol;
	}

	/** Version of the ingest manifest the service expects. */
	private const RAG_INGEST_VERSION = 2;

	/**
	 * One authenticated JSON call to the app.
	 *
	 * @param string              $method The HTTP method.
	 * @param string              $path   The API path, relative to /api/.
	 * @param array<string,mixed> $body   The JSON body to send.
	 * @param string              $token  The bearer token.
	 * @return array{code:int, body:array<string,mixed>}|WP_Error
	 */
	private static function app_json( string $method, string $path, array $body, string $token ) {
		$response = wp_remote_request(
			PROXYAI_APP_URL . '/api/' . $path,
			array(
				'method'  => $method,
				'timeout' => 30,
				'headers' => array(
					'Authorization' => 'Bearer ' . $token,
					'Content-Type'  => 'application/json',
				),
				'body'    => wp_json_encode( $body ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		return array(
			'code' => (int) wp_remote_retrieve_response_code( $response ),
			'body' => is_array( $decoded ) ? $decoded : array(),
		);
	}

	/**
	 * Runs a batch of HTTP requests concurrently via the core Requests
	 * library; sequential round trips would blow past max_execution_time and
	 * gateway timeouts on large implants.
	 *
	 * @param array<int|string,array{url:string,type:string,headers?:array<string,string>,data?:string,timeout?:int}> $requests The requests to run.
	 * @return array<int|string,array{code:int,body:string}|WP_Error> Keyed like $requests.
	 */
	private static function request_multiple( array $requests ): array {
		$class    = class_exists( 'WpOrg\\Requests\\Requests' ) ? 'WpOrg\\Requests\\Requests' : 'Requests';
		$prepared = array();
		foreach ( $requests as $key => $r ) {
			$prepared[ $key ] = array(
				'url'     => $r['url'],
				'type'    => $r['type'],
				'headers' => $r['headers'] ?? array(),
				'data'    => $r['data'] ?? '',
				'options' => array( 'timeout' => $r['timeout'] ?? 30 ),
			);
		}
		$responses = $class::request_multiple( $prepared );

		$out = array();
		foreach ( $responses as $key => $resp ) {
			if ( $resp instanceof \Exception || $resp instanceof \Throwable ) {
				$out[ $key ] = new WP_Error( 'request_failed', $resp->getMessage() );
				continue;
			}
			$out[ $key ] = array(
				'code' => (int) ( $resp->status_code ?? 0 ),
				'body' => (string) ( $resp->body ?? '' ),
			);
		}
		return $out;
	}

	/**
	 * Stages and implants knowledge documents: draft per document, upload the
	 * markdown, one implant plan for the batch (the server checks credit for
	 * the set before indexing any of it), then a manifest PUT per document to
	 * wake the queue. Returns the job ids; the dashboard polls them through
	 * the ordinary proxy.
	 *
	 * @param WP_REST_Request $request The incoming request.
	 * @return WP_REST_Response|WP_Error The created job ids, or an error.
	 */
	public static function rag_implant( WP_REST_Request $request ) {
		$token  = ProxyAI_Connection::mint_token();
		$bot_id = ProxyAI_Connection::bot_id();
		if ( '' === $token || '' === $bot_id ) {
			return new WP_Error( 'not_connected', __( 'This site is not connected to ProxyAI.', 'proxyai' ), array( 'status' => 409 ) );
		}

		$documents = $request['documents'];
		if ( ! is_array( $documents ) || array() === $documents || count( $documents ) > 20 ) {
			return new WP_Error( 'invalid_input', __( 'Nothing to implant.', 'proxyai' ), array( 'status' => 400 ) );
		}

		$docs = array();
		foreach ( $documents as $doc ) {
			$name     = isset( $doc['name'] ) && is_string( $doc['name'] ) ? trim( $doc['name'] ) : '';
			$markdown = isset( $doc['markdown'] ) && is_string( $doc['markdown'] ) ? $doc['markdown'] : '';
			if ( '' === $name || '' === $markdown ) {
				return new WP_Error( 'invalid_input', __( 'Every document needs a name and text.', 'proxyai' ), array( 'status' => 400 ) );
			}
			$docs[] = array(
				'name'     => $name,
				'markdown' => $markdown,
			);
		}

		// Wave 1 — create every draft at once.
		$draft_requests = array();
		foreach ( $docs as $i => $doc ) {
			$draft_requests[ $i ] = array(
				'url'     => PROXYAI_APP_URL . '/api/bots/' . $bot_id . '/rag/drafts',
				'type'    => 'POST',
				'headers' => array(
					'Authorization' => 'Bearer ' . $token,
					'Content-Type'  => 'application/json',
				),
				'data'    => wp_json_encode( array( 'name' => $doc['name'] ) ),
				'timeout' => 30,
			);
		}
		$prepared = array();
		foreach ( self::request_multiple( $draft_requests ) as $i => $res ) {
			if ( is_wp_error( $res ) ) {
				return new WP_Error( 'upstream_unreachable', __( 'ProxyAI could not be reached.', 'proxyai' ), array( 'status' => 502 ) );
			}
			$body = json_decode( $res['body'], true );
			$body = is_array( $body ) ? $body : array();
			if ( 200 !== $res['code'] || empty( $body['jobId'] ) || empty( $body['putUrl'] ) ) {
				$reason = isset( $body['error'] ) ? (string) $body['error'] : 'draft_create_failed';
				return new WP_Error( 'draft_failed', $reason, array( 'status' => 502 ) );
			}
			$prepared[ $i ] = array(
				'name'         => $docs[ $i ]['name'],
				'markdown'     => $docs[ $i ]['markdown'],
				'jobId'        => (string) $body['jobId'],
				'tempKey'      => (string) ( $body['key'] ?? '' ),
				'contentBytes' => strlen( $docs[ $i ]['markdown'] ),
				'putUrl'       => (string) $body['putUrl'],
				'contentType'  => (string) ( $body['contentType'] ?? 'text/markdown' ),
			);
		}

		// Wave 2 — upload every markdown draft at once.
		$upload_requests = array();
		foreach ( $prepared as $i => $p ) {
			$upload_requests[ $i ] = array(
				'url'     => $p['putUrl'],
				'type'    => 'PUT',
				'headers' => array( 'Content-Type' => $p['contentType'] ),
				'data'    => $p['markdown'],
				'timeout' => 60,
			);
		}
		foreach ( self::request_multiple( $upload_requests ) as $res ) {
			if ( is_wp_error( $res ) || $res['code'] >= 300 ) {
				return new WP_Error( 'draft_failed', 'draft_upload_failed', array( 'status' => 502 ) );
			}
		}

		$plan = self::app_json(
			'POST',
			'bots/' . $bot_id . '/rag/implant',
			array(
				'documents' => array_map(
					static fn( array $p ): array => array(
						'jobId'        => $p['jobId'],
						'contentBytes' => $p['contentBytes'],
					),
					array_values( $prepared )
				),
			),
			$token
		);
		if ( is_wp_error( $plan ) ) {
			return new WP_Error( 'upstream_unreachable', __( 'ProxyAI could not be reached.', 'proxyai' ), array( 'status' => 502 ) );
		}
		if ( 200 !== $plan['code'] || ! isset( $plan['body']['documents'] ) || ! is_array( $plan['body']['documents'] ) ) {
			$reason = isset( $plan['body']['error'] ) ? (string) $plan['body']['error'] : 'ingest_failed';
			return new WP_Error( 'implant_failed', $reason, array( 'status' => $plan['code'] >= 400 ? $plan['code'] : 502 ) );
		}

		$manifests = array();
		foreach ( $plan['body']['documents'] as $row ) {
			if ( isset( $row['jobId'], $row['manifest'] ) ) {
				$manifests[ (string) $row['jobId'] ] = $row['manifest'];
			}
		}

		// Wave 3 — commit every manifest at once, waking the ingest queue.
		$manifest_requests = array();
		foreach ( $prepared as $i => $p ) {
			$target = $manifests[ $p['jobId'] ] ?? null;
			if ( ! is_array( $target ) || empty( $target['putUrl'] ) ) {
				return new WP_Error( 'implant_failed', 'ingest_failed', array( 'status' => 502 ) );
			}
			$manifest_requests[ $i ] = array(
				'url'     => (string) $target['putUrl'],
				'type'    => 'PUT',
				'headers' => array( 'Content-Type' => (string) ( $target['contentType'] ?? 'application/json' ) ),
				'data'    => wp_json_encode(
					array(
						'version'       => self::RAG_INGEST_VERSION,
						'job_id'        => $p['jobId'],
						'bot_id'        => $bot_id,
						'document_name' => $p['name'],
						'document_url'  => 'rag://' . $bot_id . '/' . rawurlencode( $p['name'] ),
						'content_bytes' => $p['contentBytes'],
						'object_key'    => $p['tempKey'],
					)
				),
				'timeout' => 30,
			);
		}
		foreach ( self::request_multiple( $manifest_requests ) as $res ) {
			if ( is_wp_error( $res ) || $res['code'] >= 300 ) {
				return new WP_Error( 'implant_failed', 'manifest_upload_failed', array( 'status' => 502 ) );
			}
		}

		return new WP_REST_Response(
			array(
				'jobs' => array_map(
					static fn( array $p ): array => array(
						'jobId'        => $p['jobId'],
						'name'         => $p['name'],
						'contentBytes' => $p['contentBytes'],
					),
					array_values( $prepared )
				),
			),
			200
		);
	}

	/**
	 * Streams one inbox attachment's bytes to the browser. Echo-and-exit
	 * because the REST envelope would JSON-encode the binary body.
	 *
	 * @param WP_REST_Request $request The incoming request.
	 * @return WP_Error An error on failure; on success this exits after echoing.
	 */
	public static function attachment( WP_REST_Request $request ) {
		$token  = ProxyAI_Connection::mint_token();
		$bot_id = ProxyAI_Connection::bot_id();
		if ( '' === $token || '' === $bot_id ) {
			return new WP_Error( 'not_connected', __( 'This site is not connected to ProxyAI.', 'proxyai' ), array( 'status' => 409 ) );
		}

		$key      = (string) $request['key'];
		$response = wp_remote_get(
			PROXYAI_APP_URL . '/api/bots/' . $bot_id . '/handoff/attachments/' . rawurlencode( $key ),
			array(
				'timeout' => 20,
				'headers' => array( 'Authorization' => 'Bearer ' . $token ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'upstream_unreachable', __( 'ProxyAI could not be reached.', 'proxyai' ), array( 'status' => 502 ) );
		}
		$status = (int) wp_remote_retrieve_response_code( $response );
		if ( 200 !== $status ) {
			return new WP_Error( 'attachment_missing', __( 'Attachment not found.', 'proxyai' ), array( 'status' => $status >= 400 ? $status : 502 ) );
		}

		$type = (string) wp_remote_retrieve_header( $response, 'content-type' );
		header( 'Content-Type: ' . ( '' !== $type ? $type : 'application/octet-stream' ) );
		header( 'Cache-Control: private, max-age=300' );
		echo wp_remote_retrieve_body( $response ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- binary passthrough of an authenticated upstream object.
		exit;
	}

	/**
	 * Forwards one allowlisted request and relays the answer. The JWT is
	 * minted per request (one local HMAC) so it can never be stale.
	 *
	 * @param WP_REST_Request $request The incoming request.
	 * @return WP_REST_Response|WP_Error The relayed upstream answer, or an error.
	 */
	public static function proxy( WP_REST_Request $request ) {
		$path = (string) $request['path'];
		if ( ! self::path_allowed( $path ) ) {
			return new WP_Error( 'forbidden_path', __( 'This endpoint is not available.', 'proxyai' ), array( 'status' => 403 ) );
		}

		$token = ProxyAI_Connection::mint_token();
		if ( '' === $token ) {
			return new WP_Error( 'not_connected', __( 'This site is not connected to ProxyAI.', 'proxyai' ), array( 'status' => 409 ) );
		}

		$url   = PROXYAI_APP_URL . '/api/' . $path;
		$query = $request->get_query_params();
		// Strip WordPress's own routing params; everything else travels.
		unset( $query['path'], $query['rest_route'], $query['_locale'] );
		if ( array() !== $query ) {
			// http_build_query handles array-valued params (filter[]=a), which
			// rawurlencode(array) would fatal on, and encodes exactly once.
			$url .= ( str_contains( $url, '?' ) ? '&' : '?' ) . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
		}

		$args = array(
			'method'  => $request->get_method(),
			// Shorter than PHP's execution limit: a hung upstream must surface
			// as a dashboard error, not a white screen.
			'timeout' => 20,
			'headers' => array(
				'Authorization' => 'Bearer ' . $token,
			),
		);

		$content_type = (string) $request->get_header( 'content-type' );
		$files        = $request->get_file_params();
		if ( stripos( $content_type, 'multipart/form-data' ) === 0 || array() !== $files ) {
			// get_body() is empty for multipart POSTs (PHP consumed the input
			// into $_POST/$_FILES); rebuild the upload from the parsed parts.
			$boundary                        = 'proxyai' . wp_generate_password( 24, false );
			$args['body']                    = self::multipart_body( $request->get_body_params(), $files, $boundary );
			$args['headers']['Content-Type'] = 'multipart/form-data; boundary=' . $boundary;
		} else {
			$body = $request->get_body();
			if ( '' !== $body ) {
				$args['body'] = $body;
				// Forwarded verbatim so JSON stays JSON.
				if ( '' !== $content_type ) {
					$args['headers']['Content-Type'] = $content_type;
				}
			}
		}

		$response = wp_remote_request( $url, $args );
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'upstream_unreachable', __( 'ProxyAI could not be reached.', 'proxyai' ), array( 'status' => 502 ) );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		// Rewrite 502/503/504 to 500: a CDN in front of this site would
		// replace those statuses with its own error page, losing the JSON
		// diagnosis the dashboard shows.
		if ( 502 === $status || 503 === $status || 504 === $status ) {
			$status = 500;
		}
		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		// Relayed with the upstream's status. A non-JSON body (the usage CSV
		// export) travels wrapped as `raw` rather than streamed into wp-admin.
		$body_text = (string) wp_remote_retrieve_body( $response );
		if ( null === $decoded && '' !== $body_text && strtolower( trim( $body_text ) ) !== 'null' ) {
			return new WP_REST_Response( array( 'raw' => $body_text ), $status );
		}
		return new WP_REST_Response( $decoded, $status );
	}
}
