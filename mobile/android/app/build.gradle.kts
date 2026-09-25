plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing. The upload keystore lives OUTSIDE the repo (next to the old
// Bubblewrap project), and its passwords arrive only as environment variables
// set by tools/build-release.ps1 — nothing secret is ever written to disk.
val releaseStoreFile = System.getenv("SJ_UPLOAD_STORE_FILE")
val releaseStorePassword = System.getenv("SJ_UPLOAD_STORE_PASSWORD")
val releaseKeyAlias = System.getenv("SJ_UPLOAD_KEY_ALIAS")
val releaseKeyPassword = System.getenv("SJ_UPLOAD_KEY_PASSWORD")
val hasReleaseSigning = listOf(releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword)
    .all { !it.isNullOrEmpty() }

android {
    // The Play listing's package. It can never change, so it is spelled out
    // here rather than derived from the Dart project name.
    namespace = "com.shinobijourney.app"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.shinobijourney.app"
        minSdk = flutter.minSdkVersion
        // Play requires API 36 for new submissions from 2026-08-31.
        targetSdk = 36
        // From pubspec.yaml `version: <name>+<code>`. The Play track already
        // holds versionCode 4 (the TWA), so the code must stay above it.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // Native symbols ride inside the bundle, so Play can symbolise native
        // crashes without a separate upload.
        ndk { debugSymbolLevel = "SYMBOL_TABLE" }
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("upload") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            // Without the upload key this falls back to debug signing, which is
            // enough to prove a release build compiles but can never be uploaded.
            signingConfig = if (hasReleaseSigning) signingConfigs.getByName("upload") else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
