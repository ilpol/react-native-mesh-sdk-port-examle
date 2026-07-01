const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

// The library lives in a SIBLING repo. Clone `react-native-mesh-sdk` next to
// this project (same parent folder) so this relative path resolves.
const root = path.resolve(__dirname, '../react-native-mesh-sdk');
const esc = (p) => p.replace(/[/\\]/g, '[/\\\\]');

/**
 * Metro config that lets the example consume the library JS source directly from
 * the sibling folder (so edits to react-native-mesh-sdk/src hot-reload).
 */
const config = {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(root, 'node_modules'),
    ],
    extraNodeModules: {
      'react-native-mesh-sdk': root,
    },
    // Only the library's `src/` is JS. Keep Metro from crawling/watching the
    // vendored native Core (hundreds of .kt/.swift under android/ + ios/) and
    // any build output.
    blockList: exclusionList([
      new RegExp(`${esc(root)}[/\\\\]android[/\\\\].*`),
      new RegExp(`${esc(root)}[/\\\\]ios[/\\\\].*`),
      /.*[/\\]android[/\\]build[/\\].*/,
    ]),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
