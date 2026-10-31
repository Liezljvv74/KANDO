const { withAppBuildGradle } = require('expo/config-plugins')

// The iOS permission texts in locales/*.json are also written into Android's values-b+xx/strings.xml,
// where lint (release builds) rejects them as ExtraTranslation. Switch off only that rule.
module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes("disable 'ExtraTranslation'")) {
      c.modResults.contents += "\nandroid {\n    lint {\n        disable 'ExtraTranslation'\n    }\n}\n"
    }
    return c
  })
