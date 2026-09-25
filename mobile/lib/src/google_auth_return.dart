import 'shell_config.dart';

/// Outcomes the server's callback can report (api/auth/google/callback.ts).
const Set<String> _outcomes = {'ok', 'signup', 'linked', 'taken', 'expired', 'error'};

/// A ticket is `randomBytes(24).toString('base64url')` on the server.
final RegExp _ticketShape = RegExp(r'^[A-Za-z0-9_-]{1,128}$');

/// The launch parameters the website expects from this shell. `playReview` is
/// always 0 after a sign-in: the review prompt is a launch-time decision.
const Map<String, String> _shellParams = {'playNative': '1', 'playReview': '0'};

/// Turn what the Auth Tab handed back into the game URL to load.
///
/// The website finishes the sign-in by itself from `?gauth=…&gticket=…`
/// (readGoogleRedirect + claim in shinobij.client/src/lib/google-signin.ts),
/// redeeming the ticket with the nonce this WebView kept in sessionStorage.
/// So the shell never touches a credential. It only checks the callback is
/// well formed and forwards it.
///
/// Anything unexpected — a cancel, a malformed callback, someone else's
/// scheme — becomes `gauth=error`. That makes the website clear its "Opening
/// Google…" state and show its usual "did not complete" message, exactly as a
/// cancelled sign-in does on the web.
Uri gameUriForAuthResult(String? callbackUrl) {
  final callback = Uri.tryParse(callbackUrl ?? '');
  if (callback == null ||
      callback.scheme != ShellConfig.authCallbackScheme ||
      callback.host != ShellConfig.authCallbackHost) {
    return authErrorUri();
  }

  final outcome = callback.queryParameters['gauth'] ?? '';
  if (!_outcomes.contains(outcome)) return authErrorUri();

  final ticket = callback.queryParameters['gticket'] ?? '';
  if (ticket.isNotEmpty && !_ticketShape.hasMatch(ticket)) return authErrorUri();

  return Uri.https(ShellConfig.host, '/', {
    'gauth': outcome,
    if (ticket.isNotEmpty) 'gticket': ticket,
    ..._shellParams,
  });
}

/// The URL for a sign-in that did not come back at all (tab closed, error).
Uri authErrorUri() => Uri.https(ShellConfig.host, '/', {'gauth': 'error', ..._shellParams});
