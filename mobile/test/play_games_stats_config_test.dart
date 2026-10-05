import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

List<List<String>> _csv(String path) => File(path)
    .readAsStringSync()
    .replaceAll('\r\n', '\n')
    .trim()
    .split('\n')
    .map((line) => line.split(','))
    .toList();

void main() {
  test('Game Stats draft schemas match the native bridge resource keys', () {
    final events = _csv('play-games/stats-upload/PlayerGameEvent.csv');
    expect(events.first, ['Event Name', 'Property Name', 'Property Type']);
    final eventProperties = <String, Map<String, String>>{};
    for (final row in events.skip(1)) {
      expect(row, hasLength(3));
      eventProperties.putIfAbsent(row[0], () => {})[row[1]] = row[2];
    }
    expect(eventProperties, {
      'mission_completed': {'completion': 'STRING'},
      'pvp_match_completed': {'result': 'STRING'},
      'ai_victory': {'result': 'STRING'},
      'pet_match_completed': {'result': 'STRING'},
      'story_chapter_completed': {'chapter': 'INT64'},
      'progressUpdate': {'currentProgress': 'INT64'},
    });

    final stats = _csv('play-games/stats-upload/RepetitiveStatsConfig.csv');
    expect(stats.first, [
      'Stat Id',
      'Event Name',
      'Event Property Name',
      'Aggregation Type',
      'Stat Display Name',
      'Stat Description',
      'Filter Property',
      'Filter Operator',
      'Filter Value',
      'Is Competitive',
      'Min limit',
      'Max limit',
      'Icon File Name',
      'Good value direction',
      'Unit',
    ]);
    expect(stats, hasLength(6));
    expect(stats.skip(1).map((row) => row[0]).toSet(), hasLength(5));
    for (final row in stats.skip(1)) {
      expect(row, hasLength(15));
      expect(eventProperties[row[1]]?.containsKey(row[2]), isTrue,
          reason: '${row[0]} must use a declared event property');
      expect(row[3], 'COUNT');
      expect(row[12].endsWith('.png'), isTrue);
    }
    final competitive = stats.skip(1).where((row) => row[9] == 'true').toList();
    expect(competitive, hasLength(1));
    expect(competitive.single[0], 'pvp_victories');
    expect(competitive.single[6], 'result');
    expect(competitive.single[7], '=');
    expect(competitive.single[8], 'win');
    expect(competitive.single[10], '0');
    expect(competitive.single[11], '1000000');

    final progression = _csv('play-games/stats-upload/ProgressionStatConfig.csv');
    expect(progression.first, [
      'Stat Id',
      'Event Property Name',
      'Stat Display Name',
      'Stat Description',
      'Icon File Name',
      'Good value direction',
      'Unit',
    ]);
    expect(progression, hasLength(2));
    expect(progression[1][0], 'shinobi_level');
    expect(eventProperties['progressUpdate']?.containsKey(progression[1][1]), isTrue);

    final resources = File('android/app/src/main/res/values/play_games.xml')
        .readAsStringSync();
    for (final eventName in eventProperties.keys.where((name) => name != 'progressUpdate')) {
      expect(resources, contains('name="pgs_event_$eventName"'));
    }
  });
}
