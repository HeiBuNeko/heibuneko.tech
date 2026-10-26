/** Bundled Rhine assets live under the site's public/rhine directory. */
const RHINE_BASE = "/rhine/";

export const assetUrl = (path: string) =>
  `${RHINE_BASE}${path.replace(/^\//, "")}`;
