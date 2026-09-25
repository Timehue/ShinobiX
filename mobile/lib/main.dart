import 'package:flutter/material.dart';

import 'src/shell_config.dart';
import 'src/shell_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ShinobiJourneyApp());
}

class ShinobiJourneyApp extends StatelessWidget {
  const ShinobiJourneyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Shinobi Journey',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: ShellConfig.background, brightness: Brightness.dark),
        scaffoldBackgroundColor: ShellConfig.background,
      ),
      home: const ShellPage(),
    );
  }
}
