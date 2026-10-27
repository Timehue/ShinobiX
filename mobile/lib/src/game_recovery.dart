/// Retain navigation in memory, never an auth-return URL or arbitrary document.
/// The web client still decides which screens and active runs it can restore.
Uri gameRecoveryUri(Uri launch, Uri? visited, Uri previous) {
  if (visited == null ||
      (visited.scheme != 'https' && visited.scheme != 'http') ||
      visited.origin != launch.origin ||
      visited.userInfo.isNotEmpty ||
      (visited.path.isNotEmpty && visited.path != '/') ||
      (visited.query.isNotEmpty && visited.query != launch.query)) {
    return previous;
  }
  final fragment = visited.fragment;
  if (fragment.isEmpty || fragment == '/start') return launch.removeFragment();
  if (!RegExp(r'^/[A-Za-z][A-Za-z0-9_-]{0,63}$').hasMatch(fragment)) {
    return previous;
  }
  return launch.replace(fragment: fragment);
}
