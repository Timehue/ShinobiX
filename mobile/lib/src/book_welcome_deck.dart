import 'package:flutter/material.dart';

/// A landing-page companion for the unused pane in book posture.
///
/// The game owns its in-world navigation in the WebView. Before the player
/// enters the world, this pane keeps the fold display useful with the same
/// entry actions as the landing page.
class BookWelcomeDeck extends StatelessWidget {
  const BookWelcomeDeck({
    super.key,
    required this.onActivate,
    this.signIn = false,
    this.creator = false,
    this.creatorStep,
    this.creatorNextLabel,
    this.creatorBackLabel,
  });

  final ValueChanged<String> onActivate;
  final bool signIn;
  final bool creator;
  final String? creatorStep;
  final String? creatorNextLabel;
  final String? creatorBackLabel;

  static const _gold = Color(0xFFE6BB62);
  static const _ink = Color(0xFFF3E8D0);
  static const _muted = Color(0xFFB8B1A4);

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xFF0B101C),
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFF24212A),
                    Color(0xFF111622),
                    Color(0xFF17131A),
                  ],
                ),
                border: Border.all(color: _gold.withValues(alpha: 0.48)),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x77000000),
                    blurRadius: 28,
                    offset: Offset(0, 10),
                  ),
                  BoxShadow(
                    color: Color(0x1AE6BB62),
                    blurRadius: 22,
                    spreadRadius: -8,
                  ),
                ],
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(22, 28, 22, 22),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 68,
                        height: 68,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: const Color(0x24E6BB62),
                          border: Border.all(
                            color: _gold.withValues(alpha: 0.72),
                          ),
                        ),
                        child: const Icon(
                          Icons.auto_awesome,
                          color: _gold,
                          size: 32,
                        ),
                      ),
                    ),
                    const SizedBox(height: 22),
                    Text(
                      creator
                          ? 'YOUR SHINOBI RECORD'
                          : signIn
                          ? 'RETURN TO YOUR JOURNEY'
                          : 'THE VILLAGE GATES ARE OPEN',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        decoration: TextDecoration.none,
                        color: _gold,
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 2.2,
                      ),
                    ),
                    const SizedBox(height: 11),
                    Text(
                      creator
                          ? 'Your shinobi\nis taking shape.'
                          : signIn
                          ? 'Your story awaits\nat the gates.'
                          : 'Your next chapter\nbegins here.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        decoration: TextDecoration.none,
                        color: _ink,
                        fontSize: 27,
                        height: 1.12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      creator
                          ? 'Each choice shapes your first chapter. Continue through the academy record on the other pane.'
                          : signIn
                          ? 'Continue with the account you trust, or return to the village gates.'
                          : 'Choose your village, shape your shinobi, and make a name for yourself.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        decoration: TextDecoration.none,
                        color: _muted,
                        fontSize: 14,
                        height: 1.55,
                      ),
                    ),
                    const SizedBox(height: 24),
                    if (creator) ...[
                      Text(
                        'CURRENT STEP  ·  ${creatorStep?.toUpperCase() ?? 'GATE'}',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          decoration: TextDecoration.none,
                          color: _gold,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.7,
                        ),
                      ),
                      const SizedBox(height: 18),
                      _WelcomeAction(
                        label: creatorNextLabel ?? 'Continue',
                        icon: Icons.arrow_forward_rounded,
                        primary: true,
                        onPressed: () => onActivate('creatorNext'),
                      ),
                      const SizedBox(height: 10),
                      _WelcomeAction(
                        label: creatorBackLabel ?? 'Back',
                        icon: Icons.arrow_back_rounded,
                        onPressed: () => onActivate('creatorBack'),
                      ),
                    ] else if (!signIn) ...[
                      _WelcomeAction(
                        label: 'Enter the World',
                        icon: Icons.arrow_forward_rounded,
                        primary: true,
                        onPressed: () => onActivate('begin'),
                      ),
                      const SizedBox(height: 10),
                      _WelcomeAction(
                        label: 'Explore Gameplay',
                        icon: Icons.explore_outlined,
                        onPressed: () => onActivate('explore'),
                      ),
                      const SizedBox(height: 10),
                      _WelcomeAction(
                        label: 'Log In',
                        icon: Icons.login_rounded,
                        onPressed: () => onActivate('login'),
                      ),
                    ] else ...[
                      const Text(
                        'SIGN IN ON THE OTHER PANE',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          decoration: TextDecoration.none,
                          color: _gold,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.8,
                        ),
                      ),
                      const SizedBox(height: 18),
                      _WelcomeAction(
                        label: 'Return to Welcome',
                        icon: Icons.arrow_back_rounded,
                        primary: true,
                        onPressed: () => onActivate('back'),
                      ),
                    ],
                    const SizedBox(height: 18),
                    const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        _WelcomePillar(
                          icon: Icons.menu_book_rounded,
                          label: 'STORIES',
                        ),
                        SizedBox(width: 18),
                        _WelcomePillar(
                          icon: Icons.bolt_rounded,
                          label: 'BATTLES',
                        ),
                        SizedBox(width: 18),
                        _WelcomePillar(
                          icon: Icons.pets_rounded,
                          label: 'BONDS',
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _WelcomeAction extends StatelessWidget {
  const _WelcomeAction({
    required this.label,
    required this.icon,
    required this.onPressed,
    this.primary = false,
  });

  final String label;
  final IconData icon;
  final VoidCallback onPressed;
  final bool primary;

  static const _gold = Color(0xFFE6BB62);
  static const _ink = Color(0xFFF3E8D0);

  @override
  Widget build(BuildContext context) {
    return Material(
      color: primary ? _gold : const Color(0x33171D2A),
      borderRadius: BorderRadius.circular(13),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(13),
        child: Container(
          constraints: const BoxConstraints(minHeight: 52),
          padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 11),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(13),
            border: Border.all(
              color: primary
                  ? const Color(0xFFFFE5A2)
                  : _gold.withValues(alpha: 0.35),
            ),
          ),
          child: Row(
            children: [
              Icon(
                icon,
                size: 19,
                color: primary ? const Color(0xFF20170A) : _gold,
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    decoration: TextDecoration.none,
                    color: primary ? const Color(0xFF20170A) : _ink,
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              if (primary)
                const Icon(
                  Icons.arrow_forward_rounded,
                  size: 19,
                  color: Color(0xFF20170A),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WelcomePillar extends StatelessWidget {
  const _WelcomePillar({required this.icon, required this.label});

  final IconData icon;
  final String label;

  static const _gold = Color(0xFFAA8C4B);
  static const _muted = Color(0xFFAAA292);

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: _gold, size: 17),
        const SizedBox(height: 4),
        Text(
          label,
          style: const TextStyle(
            decoration: TextDecoration.none,
            color: _muted,
            fontSize: 8,
            fontWeight: FontWeight.w800,
            letterSpacing: 1.1,
          ),
        ),
      ],
    );
  }
}
