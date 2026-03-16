const os = require('os');

function getLanIp() {
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) continue;

    for (const address of addresses) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }

  return '127.0.0.1';
}

module.exports = () => {
  const apiBaseUrl =
    process.env.VOLCRE_API_BASE_URL || `http://${getLanIp()}:8000`;

  return {
    expo: {
      name: 'Volcre',
      slug: 'volcre',
      version: '1.0.0',
      orientation: 'portrait',
      assetBundlePatterns: ['**/*'],
      ios: {
        supportsTablet: true,
      },
      android: {
        adaptiveIcon: {
          backgroundColor: '#ffffff',
        },
      },
      scheme: 'volcre',
      extra: {
        apiBaseUrl,
      },
      plugins: ['expo-font'],
    },
  };
};
