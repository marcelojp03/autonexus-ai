/// Pending authorization state of the PKCE flow.
///
/// It is persisted **before** the browser opens and removed only when the code has been exchanged (or
/// abandoned). That is what makes the flow survive the system restarting the app while the browser is
/// in the foreground: without a stored state the callback cannot be redeemed and the sign-in silently
/// fails.
library;

class PendingAuthorization {
  const PendingAuthorization({
    required this.state,
    required this.codeVerifier,
    required this.nonce,
    required this.redirectUrl,
    required this.createdAt,
  });

  final String state;
  final String codeVerifier;
  final String nonce;
  final String redirectUrl;
  final DateTime createdAt;

  bool isUsableAt(DateTime now, {Duration lifetime = const Duration(minutes: 15)}) => now.difference(createdAt) < lifetime;

  Map<String, Object?> toRow() => {
        'state': state,
        'code_verifier': codeVerifier,
        'nonce': nonce,
        'redirect_url': redirectUrl,
        'created_at': createdAt.toUtc().toIso8601String(),
      };

  static PendingAuthorization fromRow(Map<String, Object?> row) => PendingAuthorization(
        state: row['state']! as String,
        codeVerifier: row['code_verifier']! as String,
        nonce: row['nonce']! as String,
        redirectUrl: row['redirect_url']! as String,
        createdAt: DateTime.parse(row['created_at']! as String),
      );
}
