/**
 * Public game release identity.
 *
 * This is separate from pack, campaign, replay and PWA cache versions: those
 * are compatibility/content identities and must not move with a UI release.
 * Keep the authored value here so the shell has one source for every surface
 * that may expose the human-facing release.
 */
export const GAME_VERSION = '0.17';
export const GAME_VERSION_LABEL = `v${GAME_VERSION}`;
