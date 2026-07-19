export const V4_CONTENT_IDENTITY = Object.freeze({
  contentAuthoritySchemaVersion: "4.0.0-content-authority",
  packageId: "1bit-stg-complete-asset-kit-v4",
  packageSchemaVersion: "4.0.0",
  packageManifestSha256: "d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70",
  contentDigestSha256: "f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2",
} as const);

export type V4ContentIdentity = typeof V4_CONTENT_IDENTITY;
