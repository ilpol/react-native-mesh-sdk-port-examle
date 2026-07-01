const path = require('path');

/**
 * Point React Native autolinking at the SDK in the SIBLING repo, so the example
 * consumes the library in-place (no publish / no npm link needed). Clone
 * react-native-mesh-sdk next to this project. JS resolution is handled
 * separately by metro.config.js.
 */
module.exports = {
  dependencies: {
    'react-native-mesh-sdk': {
      root: path.resolve(__dirname, '../react-native-mesh-sdk'),
    },
  },
};
