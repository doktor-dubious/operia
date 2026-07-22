import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Release-signering: læses fra android/keystore.properties (gitignored — symlink til
// ~/Android/keystores/operia-keystore.properties på byggemaskinen). Mangler filen,
// bygges release usigneret; kun byggemaskinen med nøglen kan udgive.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.dcalogic.operia"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.dcalogic.operia"
        minSdk = 26 // håndterminaler (Zebra/Honeywell m.fl.) kører typisk ældre Android
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        // Supabase-forbindelse — anon key er offentlig by design (RLS beskytter data).
        // Overstyr i en build-variant hvis der kommer separate dev/prod-projekter.
        buildConfigField("String", "SUPABASE_URL", "\"https://rjlxmdfmktucunxehtqz.supabase.co\"")
        buildConfigField(
            "String",
            "SUPABASE_ANON_KEY",
            "\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqbHhtZGZta3R1Y3VueGVodHF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MzY4OTEsImV4cCI6MjA5OTIxMjg5MX0.6Br86Xx4x4q6084I3rq6adoh9X_bRbxWjCkuEu5fvTQ\"",
        )
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            val missing = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
                .filter { keystoreProps.getProperty(it).isNullOrBlank() }
            if (missing.isNotEmpty()) {
                error("keystore.properties findes, men mangler nøglerne: $missing")
            }
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystoreProps.isNotEmpty()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)

    implementation(platform(libs.supabase.bom))
    implementation(libs.supabase.auth)
    implementation(libs.supabase.postgrest)
    implementation(libs.supabase.storage)
    implementation(libs.supabase.functions)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.kotlinx.serialization.json)

    debugImplementation(libs.androidx.ui.tooling)
}
