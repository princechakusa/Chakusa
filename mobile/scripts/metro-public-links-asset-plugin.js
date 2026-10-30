// Cloudflare Pages does not publish folders named node_modules, so fonts and
// images that Expo exports to /assets/node_modules/... returned 503 on the
// public-links site (icons rendered as empty boxes). For that web build only,
// serve them from /assets/nm/... instead; the bundle and the exported files
// both use httpServerLocation, so they stay in step.
module.exports = function publicLinksAssetPlugin(asset) {
  asset.httpServerLocation = asset.httpServerLocation.replace(/(^|\/)node_modules(\/|$)/g, '$1nm$2');
  return asset;
};
