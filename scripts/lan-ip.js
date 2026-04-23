const os = require('os');

function isPrivateIpv4(address) {
  return (
    /^192\.168\./.test(address) ||
    /^10\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function isIgnoredInterface(name) {
  return /loopback|vmware|virtualbox|vbox|hyper-v|vethernet|wsl|tailscale|zerotier|bluetooth|docker|npcap/i.test(
    name
  );
}

// Picks the most likely LAN IPv4 address for Expo Go and device-to-backend access.
function getPreferredLanIp() {
  const override = process.env.VOLCRE_LAN_IP?.trim();
  if (override) {
    return override;
  }

  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) {
      continue;
    }

    for (const address of addresses) {
      if (address.family !== 'IPv4' || address.internal) {
        continue;
      }

      candidates.push({
        interfaceName: name,
        address: address.address,
        ignored: isIgnoredInterface(name),
        private: isPrivateIpv4(address.address),
      });
    }
  }

  const preferredCandidate =
    candidates.find(candidate => candidate.private && !candidate.ignored) ||
    candidates.find(candidate => candidate.private) ||
    candidates.find(candidate => !candidate.ignored) ||
    candidates[0];

  return preferredCandidate?.address || '127.0.0.1';
}

module.exports = {
  getPreferredLanIp,
};
