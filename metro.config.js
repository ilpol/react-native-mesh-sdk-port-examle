const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

/**
 * Default Metro config. react-native-mesh-sdk is resolved from node_modules like
 * any package (its JS entry is `src/`). We only exclude the library's vendored
 * native trees (android/*.kt, ios/*.swift) from Metro's file map — they are not
 * part of the JS bundle.
 */
const config = {
  resolver: {
    blockList: exclusionList([
      /node_modules[/\\]react-native-mesh-sdk[/\\]android[/\\].*/,
      /node_modules[/\\]react-native-mesh-sdk[/\\]ios[/\\].*/,
    ]),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
