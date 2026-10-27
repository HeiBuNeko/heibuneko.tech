/** Bundled Rhine assets live under the site's public/rhine-bangumi directory. */
const RHINE_BASE = "/rhine-bangumi/";

export const assetUrl = (path: string) =>
  `${RHINE_BASE}${path.replace(/^\//, "")}`;
