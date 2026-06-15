pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }   // NewPipeExtractor
        maven { url = uri("https://maven.aliyun.com/repository/jitpack") }   // espejo de respaldo si JitPack da 403
    }
}

rootProject.name = "DSK•LoFi"
include(":app")