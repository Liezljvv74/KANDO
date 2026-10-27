// Monorepo: Metro watches the whole repo (the @kando/* packages are TypeScript sources, not built) and finds
// dependencies in the app's own node_modules first, then in the hoisted root node_modules.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [monorepoRoot]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(monorepoRoot, 'node_modules')]

module.exports = config
