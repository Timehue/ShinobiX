import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shinobi_app/src/tabletop_command_deck.dart';

void main() {
  testWidgets('tabletop commands retain the five existing game destinations', (
    tester,
  ) async {
    final activated = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 820,
            height: 240,
            child: TabletopCommandDeck(
              selectedCommand: 'village',
              modalOpen: false,
              onActivate: activated.add,
            ),
          ),
        ),
      ),
    );

    for (final label in ['You', 'Travel', 'Village', 'Items', 'Menu']) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('FIELD COMMANDS'), findsOneWidget);
    expect(TabletopCommandDeck.commandKeys, [
      'you',
      'travel',
      'village',
      'items',
      'menu',
    ]);
    await tester.tap(find.text('Travel'));
    expect(activated, ['travel']);
  });

  testWidgets('an open WebView modal disables the lower-pane command deck', (
    tester,
  ) async {
    var activationCount = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 820,
            height: 240,
            child: TabletopCommandDeck(
              selectedCommand: null,
              modalOpen: true,
              onActivate: (_) => activationCount++,
            ),
          ),
        ),
      ),
    );

    expect(find.text('CLOSE THE OPEN PANEL ABOVE'), findsOneWidget);
    await tester.tap(find.text('Village'));
    expect(activationCount, 0);
  });

  testWidgets('book posture uses a vertical command rail in the second pane', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(420, 820);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final activated = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 420,
            height: 820,
            child: TabletopCommandDeck(
              axis: Axis.vertical,
              selectedCommand: 'you',
              modalOpen: false,
              onActivate: activated.add,
            ),
          ),
        ),
      ),
    );

    for (final label in ['You', 'Travel', 'Village', 'Items', 'Menu']) {
      expect(find.text(label), findsOneWidget);
    }
    await tester.tap(find.text('Items'));
    expect(activated, ['items']);
  });

  testWidgets('short book panes keep commands scrollable without overflow', (
    tester,
  ) async {
    final activated = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 420,
            height: 260,
            child: TabletopCommandDeck(
              axis: Axis.vertical,
              selectedCommand: null,
              modalOpen: false,
              onActivate: activated.add,
            ),
          ),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('Menu'));
    await tester.tap(find.text('Menu'));
    expect(activated, ['menu']);
    expect(tester.takeException(), isNull);
  });
}
