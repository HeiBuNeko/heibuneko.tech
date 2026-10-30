const RHINE_BASE = "/rhine-bangumi/";

export const assetUrl = (path: string) =>
  `${RHINE_BASE}${path.replace(/^\//, "")}`;
