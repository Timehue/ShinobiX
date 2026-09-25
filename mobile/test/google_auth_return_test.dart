import 'package:flutter_test/flutter_test.dart';
import 'package:shinobi_app/src/google_auth_return.dart';

void main() {
  const ticket = 'Qm9vay1vZi10aGUtbmluamEtdGlja2V0LTAwMQ'; // base64url, like the server's

  test('a finished sign-in is forwarded to the game with the shell parameters', () {
    final uri = gameUriForAuthResult('shinobijourney://auth?gauth=ok&gticket=$ticket');
    expect(uri.scheme, 'https');
    expect(uri.host, 'shinobijourney.com');
    expect(uri.path, '/');
    expect(uri.queryParameters, {'gauth': 'ok', 'gticket': ticket, 'playNative': '1', 'playReview': '0'});
  });

  test('every outcome the server can send is forwarded', () {
    for (final outcome in ['ok', 'signup', 'linked', 'taken', 'expired', 'error']) {
      expect(gameUriForAuthResult('shinobijourney://auth?gauth=$outcome').queryParameters['gauth'], outcome);
    }
  });

  test('a failure carries no ticket', () {
    final uri = gameUriForAuthResult('shinobijourney://auth?gauth=error');
    expect(uri.queryParameters.containsKey('gticket'), isFalse);
  });

  test('anything malformed or foreign becomes a plain error, never a forwarded value', () {
    final bad = <String?>[
      null,
      '',
      'not a url',
      'https://shinobijourney.com/?gauth=ok&gticket=$ticket',
      'shinobijourney://review?gauth=ok',
      'evil://auth?gauth=ok&gticket=$ticket',
      'shinobijourney://auth?gauth=admin',
      'shinobijourney://auth',
      "shinobijourney://auth?gauth=ok&gticket=');alert(1);//",
      'shinobijourney://auth?gauth=ok&gticket=${'a' * 129}',
    ];
    for (final callback in bad) {
      expect(gameUriForAuthResult(callback), authErrorUri(), reason: '$callback');
    }
  });

  test('the error URL clears the website\'s sign-in state and keeps the shell parameters', () {
    expect(authErrorUri().toString(), 'https://shinobijourney.com/?gauth=error&playNative=1&playReview=0');
  });
}
