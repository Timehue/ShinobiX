import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shinobi_app/src/book_welcome_deck.dart';

void main() {
  testWidgets('book landing pane offers the existing entry actions', (
    tester,
  ) async {
    final actions = <String>[];
    tester.view.physicalSize = const Size(420, 820);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: BookWelcomeDeck(onActivate: actions.add)),
      ),
    );

    expect(find.text('THE VILLAGE GATES ARE OPEN'), findsOneWidget);
    expect(find.text('Enter the World'), findsOneWidget);
    expect(find.text('Explore Gameplay'), findsOneWidget);
    expect(find.text('Log In'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Enter the World'));
    await tester.tap(find.text('Explore Gameplay'));
    await tester.tap(find.text('Log In'));
    expect(actions, ['begin', 'explore', 'login']);
  });

  testWidgets('book landing pane scrolls cleanly in a short split window', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 520);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: BookWelcomeDeck(onActivate: _ignoreAction)),
      ),
    );

    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('Log In'));
    expect(find.text('Log In'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'book sign-in companion offers a safe return to the welcome page',
    (tester) async {
      final actions = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BookWelcomeDeck(signIn: true, onActivate: actions.add),
          ),
        ),
      );

      expect(find.text('SIGN IN ON THE OTHER PANE'), findsOneWidget);
      expect(find.text('Return to Welcome'), findsOneWidget);
      expect(find.text('Enter the World'), findsNothing);
      await tester.tap(find.text('Return to Welcome'));
      expect(actions, ['back']);
    },
  );

  testWidgets('book creator companion mirrors the active creator step', (
    tester,
  ) async {
    final actions = <String>[];
    tester.view.physicalSize = const Size(360, 520);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BookWelcomeDeck(
            creator: true,
            creatorStep: 'Village',
            creatorNextLabel: 'Choose Bloodline',
            creatorBackLabel: 'Back to Gate',
            onActivate: actions.add,
          ),
        ),
      ),
    );

    expect(find.text('CURRENT STEP  ·  VILLAGE'), findsOneWidget);
    expect(find.text('Choose Bloodline'), findsOneWidget);
    expect(find.text('Back to Gate'), findsOneWidget);
    expect(find.text('Enter the World'), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.ensureVisible(find.text('Back to Gate'));
    await tester.tap(find.text('Choose Bloodline'));
    await tester.tap(find.text('Back to Gate'));
    expect(actions, ['creatorNext', 'creatorBack']);
    expect(tester.takeException(), isNull);
  });
}

void _ignoreAction(String _) {}
