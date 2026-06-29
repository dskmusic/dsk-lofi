plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.dskmusic.dsklofi"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.dskmusic.dsklofi"
        minSdk = 24
        targetSdk = 35
        versionCode = 57
        versionName = "1.57"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Versión real de NewPipeExtractor (una sola fuente: el version catalog).
        buildConfigField("String", "NEWPIPE_VERSION", "\"${libs.versions.newpipe.get()}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        isCoreLibraryDesugaringEnabled = true   // NewPipeExtractor usa java.time/java.nio (minSdk 24)
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

// Evita el error "Type androidx.annotation.experimental.R is defined multiple
// times": androidx.media:1.7.0 arrastra una annotation-experimental antigua
// que choca con la que piden material/appcompat. Forzamos una sola versión.
configurations.all {
    resolutionStrategy {
        force("androidx.annotation:annotation-experimental:1.4.1")
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.constraintlayout)

    implementation(libs.onnxruntime.android)
    implementation(libs.jtransforms)

    // Notificación de reproducción (MediaSessionCompat + MediaStyle)
    implementation("androidx.media:media:1.7.0") {
        exclude(group = "androidx.annotation", module = "annotation-experimental")
    }

    // Búsqueda/scraping de letras (LRCLIB + Genius) — LyricsBridge
    implementation(libs.jsoup)

    // YouTube en el dispositivo (búsqueda + audio) — YoutubeBridge
    implementation(libs.newpipe)
    implementation(libs.okhttp)
    implementation(libs.jaudiotagger)
    coreLibraryDesugaring(libs.desugar)

    implementation("androidx.annotation:annotation-experimental:1.4.1")

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}