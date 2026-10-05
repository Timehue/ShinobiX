import 'package:flutter/material.dart';

/// Foldable tabletop controls matching the game's existing mobile navigation.
/// Actions are forwarded to the WebView so the website remains the sole owner
/// of navigation, profile state, and menu dialogs.
class TabletopCommandDeck extends StatelessWidget {
  const TabletopCommandDeck({
    super.key,
    required this.selectedCommand,
    required this.modalOpen,
    required this.onActivate,
    this.axis = Axis.horizontal,
  });

  final String? selectedCommand;
  final bool modalOpen;
  final ValueChanged<String> onActivate;
  final Axis axis;

  static const _commands = <({String key, String label, IconData icon})>[
    (key: 'you', label: 'You', icon: Icons.person_outline_rounded),
    (key: 'travel', label: 'Travel', icon: Icons.explore_outlined),
    (key: 'village', label: 'Village', icon: Icons.account_balance_outlined),
    (key: 'items', label: 'Items', icon: Icons.inventory_2_outlined),
    (key: 'menu', label: 'Menu', icon: Icons.menu_rounded),
  ];

  static final commandKeys = List<String>.unmodifiable(
    _commands.map((command) => command.key),
  );

  static const _ink = Color(0xFFF3E8D0);
  static const _gold = Color(0xFFE6BB62);
  static const _muted = Color(0xFFAA9B83);

  @override
  Widget build(BuildContext context) {
    final vertical = axis == Axis.vertical;
    return ColoredBox(
      color: const Color(0xFF0B101C),
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: vertical ? 12 : 18,
          vertical: vertical ? 16 : 14,
        ),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compactVertical = vertical && constraints.maxHeight < 400;
            final panel = ConstrainedBox(
              constraints: vertical
                  ? BoxConstraints(
                      maxWidth: 440,
                      maxHeight: constraints.maxHeight,
                    )
                  : const BoxConstraints(maxWidth: 900, maxHeight: 184),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Color(0xFF20212B),
                      Color(0xFF111622),
                      Color(0xFF17131A),
                    ],
                  ),
                  border: Border.all(
                    color: _gold.withValues(alpha: 0.52),
                    width: 1.2,
                  ),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x66000000),
                      blurRadius: 24,
                      offset: Offset(0, 8),
                    ),
                    BoxShadow(
                      color: Color(0x1AE6BB62),
                      blurRadius: 18,
                      spreadRadius: -7,
                    ),
                  ],
                ),
                child: Padding(
                  padding: EdgeInsets.fromLTRB(
                    vertical ? 12 : 14,
                    compactVertical ? 8 : 11,
                    vertical ? 12 : 14,
                    compactVertical ? 8 : 10,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (!compactVertical) ...[
                        Row(
                          children: [
                            const Icon(
                              Icons.auto_awesome,
                              size: 15,
                              color: _gold,
                            ),
                            const SizedBox(width: 8),
                            const Text(
                              'FIELD COMMANDS',
                              style: TextStyle(
                                color: _gold,
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 2.1,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Divider(
                                color: _gold.withValues(alpha: 0.25),
                                height: 1,
                              ),
                            ),
                            if (!vertical) ...[
                              const SizedBox(width: 10),
                              Text(
                                modalOpen
                                    ? 'CLOSE THE OPEN PANEL ABOVE'
                                    : 'SHINOBI JOURNEY',
                                style: const TextStyle(
                                  color: _muted,
                                  fontSize: 9,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 1.15,
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 9),
                      ],
                      if (vertical)
                        Expanded(
                          child: compactVertical
                              ? SingleChildScrollView(
                                  child: Column(
                                    children: [
                                      for (
                                        var index = 0;
                                        index < _commands.length;
                                        index++
                                      ) ...[
                                        if (index > 0)
                                          const SizedBox(height: 8),
                                        SizedBox(
                                          height: 48,
                                          child: _CommandButton(
                                            vertical: true,
                                            label: _commands[index].label,
                                            icon: _commands[index].icon,
                                            selected:
                                                selectedCommand ==
                                                _commands[index].key,
                                            enabled: !modalOpen,
                                            onPressed: () => onActivate(
                                              _commands[index].key,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                )
                              : Column(
                                  children: [
                                    for (
                                      var index = 0;
                                      index < _commands.length;
                                      index++
                                    ) ...[
                                      if (index > 0) const SizedBox(height: 8),
                                      Expanded(
                                        child: _CommandButton(
                                          vertical: true,
                                          label: _commands[index].label,
                                          icon: _commands[index].icon,
                                          selected:
                                              selectedCommand ==
                                              _commands[index].key,
                                          enabled: !modalOpen,
                                          onPressed: () =>
                                              onActivate(_commands[index].key),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                        )
                      else
                        Row(
                          children: [
                            for (
                              var index = 0;
                              index < _commands.length;
                              index++
                            )
                              Expanded(
                                child: _CommandButton(
                                  label: _commands[index].label,
                                  icon: _commands[index].icon,
                                  selected:
                                      selectedCommand == _commands[index].key,
                                  enabled: !modalOpen,
                                  onPressed: () =>
                                      onActivate(_commands[index].key),
                                ),
                              ),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
            );
            return vertical ? panel : Center(child: panel);
          },
        ),
      ),
    );
  }
}

class _CommandButton extends StatelessWidget {
  const _CommandButton({
    this.vertical = false,
    required this.label,
    required this.icon,
    required this.selected,
    required this.enabled,
    required this.onPressed,
  });

  final bool vertical;
  final String label;
  final IconData icon;
  final bool selected;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final foreground = enabled
        ? TabletopCommandDeck._ink
        : TabletopCommandDeck._muted;
    return Semantics(
      button: true,
      selected: selected,
      enabled: enabled,
      label: label,
      child: Tooltip(
        message: label,
        child: Material(
          color: selected ? const Color(0x2EE6BB62) : Colors.transparent,
          borderRadius: BorderRadius.circular(13),
          child: InkWell(
            onTap: enabled ? onPressed : null,
            borderRadius: BorderRadius.circular(13),
            child: Container(
              constraints: BoxConstraints(minHeight: vertical ? 48 : 66),
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 7),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(13),
                border: Border.all(
                  color: selected
                      ? TabletopCommandDeck._gold
                      : const Color(0x334F5869),
                  width: selected ? 1.3 : 1,
                ),
              ),
              child: vertical
                  ? Row(
                      children: [
                        Icon(
                          icon,
                          size: 23,
                          color: selected
                              ? TabletopCommandDeck._gold
                              : foreground,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: selected
                                  ? TabletopCommandDeck._gold
                                  : foreground,
                              fontSize: 13,
                              fontWeight: selected
                                  ? FontWeight.w800
                                  : FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    )
                  : Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          icon,
                          size: 23,
                          color: selected
                              ? TabletopCommandDeck._gold
                              : foreground,
                        ),
                        const SizedBox(height: 3),
                        Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: selected
                                ? TabletopCommandDeck._gold
                                : foreground,
                            fontSize: 11,
                            fontWeight: selected
                                ? FontWeight.w800
                                : FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}
