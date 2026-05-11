/**
 * Detects wallet-embedded in-app browsers that silently block programmatic
 * anchor downloads and file picker triggers. Detection is user-agent based.
 * The list covers the wallets we have confirmed block these APIs. The generic
 * WebView heuristic at the bottom catches unlisted wallets that expose a raw
 * Android WebView without a recognisable UA token.
 */
export function isRestrictedInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /Phantom/i.test(ua)        ||
    /CoinbaseWallet/i.test(ua) ||
    /WalletConnect/i.test(ua)  ||
    /MetaMaskMobile/i.test(ua) ||
    (/Mobile/i.test(ua) && /wv/i.test(ua) && !/Chrome\/[0-9]/.test(ua))
  );
}

/**
 * Returns true only when the Web Share API can actually share files on the
 * current device. navigator.share existing alone is not sufficient — iOS
 * Safari has navigator.share but does not always support file sharing, and
 * the canShare({ files }) probe is the only reliable check.
 */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined")        return false;
  if (typeof navigator.share    !== "function") return false;
  if (typeof navigator.canShare !== "function") return false;
  const probe = new File(["x"], "probe.json", { type: "application/json" });
  return navigator.canShare({ files: [probe] });
}
