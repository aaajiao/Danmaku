/**
 * Asset imports resolve to their bundled URL.
 *
 * `import BULLETS_URL from './assets/bullets.png'` is how real art enters the
 * game — the bundler copies the file into `dist/` and rewrites the specifier to
 * the emitted URL (verified: the production build emits the PNG and points at
 * it). Without these declarations TypeScript has no type for a `.png` or `.wav`
 * import and the line needs an `@ts-expect-error`; with them the swap the docs
 * describe is a plain import.
 *
 * See `docs/assets.md` §5 and `docs/audio.md`.
 */
declare module '*.png' {
  const url: string;
  export default url;
}

declare module '*.wav' {
  const url: string;
  export default url;
}

declare module '*.ogg' {
  const url: string;
  export default url;
}
