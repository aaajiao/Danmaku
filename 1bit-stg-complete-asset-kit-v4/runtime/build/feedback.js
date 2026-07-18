"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFERENCE_FEEDBACK_BINDINGS = exports.FeedbackRouter = exports.ACCESSIBILITY_PRESETS = void 0;
exports.ACCESSIBILITY_PRESETS = Object.freeze({
    full: Object.freeze({
        motion: "full",
        flashing: "full",
        contrast: "room-authored",
        notch: "standard",
        binaural: "spatial",
        haptics: "full",
    }),
    reducedMotion: Object.freeze({
        motion: "reduced",
        flashing: "full",
        contrast: "room-authored",
        notch: "standard",
        binaural: "spatial",
        haptics: "full",
    }),
    flashOff: Object.freeze({
        motion: "full",
        flashing: "off",
        contrast: "room-authored",
        notch: "standard",
        binaural: "spatial",
        haptics: "full",
    }),
    maximumLegibility: Object.freeze({
        motion: "reduced",
        flashing: "off",
        contrast: "high-separation",
        notch: "reinforced",
        binaural: "mono",
        haptics: "reduced",
    }),
});
/** One-way sink: accepts an immutable gameplay event and returns presentation cues only. */
class FeedbackRouter {
    bindings;
    constructor(bindings) {
        this.bindings = bindings;
        const ids = new Set();
        for (const binding of bindings) {
            if (ids.has(binding.id))
                throw new Error(`duplicate feedback binding id: ${binding.id}`);
            ids.add(binding.id);
            if (!binding.cueId)
                throw new Error(`feedback binding ${binding.id} has no cue`);
            if (binding.gameplayCritical
                && (binding.motionSensitive || binding.usesFlashing || binding.binaural)
                && !binding.fallbackCueId) {
                throw new Error(`critical conditional binding ${binding.id} requires a fallback cue`);
            }
        }
    }
    route(event, profile) {
        return this.bindings
            .filter((binding) => binding.eventId === event.id)
            .flatMap((binding) => this.resolveBinding(binding, profile));
    }
    resolveBinding(binding, profile) {
        if (binding.modality === "haptic" && profile.haptics === "off")
            return [];
        let cueId = binding.cueId;
        let substituted = false;
        if (binding.motionSensitive && profile.motion === "reduced") {
            cueId = binding.fallbackCueId ?? binding.cueId;
            substituted = true;
        }
        if (binding.usesFlashing && profile.flashing === "off") {
            cueId = binding.fallbackCueId ?? binding.cueId;
            substituted = true;
        }
        if (binding.binaural && profile.binaural === "mono") {
            cueId = binding.fallbackCueId ?? binding.cueId;
            substituted = true;
        }
        const parameters = {
            substituted,
            contrast: profile.contrast,
            notch: profile.notch,
        };
        if (binding.modality === "visual") {
            parameters.motion = profile.motion;
            parameters.flashing = profile.flashing;
            if (binding.usesFlashing && profile.flashing === "reduced")
                parameters.flashRateCapHz = 2;
        }
        if (binding.modality === "audio")
            parameters.binaural = profile.binaural;
        if (binding.modality === "haptic")
            parameters.haptics = profile.haptics;
        return [Object.freeze({
                bindingId: binding.id,
                eventId: binding.eventId,
                modality: binding.modality,
                cueId,
                parameters: Object.freeze(parameters),
            })];
    }
}
exports.FeedbackRouter = FeedbackRouter;
exports.REFERENCE_FEEDBACK_BINDINGS = Object.freeze([
    {
        id: "player-collision-off-visual",
        eventId: "player.collision.off",
        modality: "visual",
        cueId: "player.hitbox-disabled-steady",
        gameplayCritical: true,
    },
    {
        id: "gaze-clamp-visual",
        eventId: "gaze.clamp.commit",
        modality: "visual",
        cueId: "gaze.contrast-clamp.animated",
        fallbackCueId: "gaze.contrast-clamp.steady",
        gameplayCritical: true,
        motionSensitive: true,
    },
    {
        id: "gaze-clamp-audio",
        eventId: "gaze.clamp.commit",
        modality: "audio",
        cueId: "gaze.lowpass.commit",
        gameplayCritical: false,
    },
    {
        id: "gaze-acquire-visual",
        eventId: "gaze.acquire.begin",
        modality: "visual",
        cueId: "gaze.horizon-threshold-steady",
        gameplayCritical: false,
    },
    {
        id: "gaze-clamp-haptic",
        eventId: "gaze.clamp.commit",
        modality: "haptic",
        cueId: "gaze.single-pulse",
        gameplayCritical: false,
    },
    {
        id: "gaze-release-visual",
        eventId: "gaze.clamp.release",
        modality: "visual",
        cueId: "gaze.release-boundary-steady",
        gameplayCritical: true,
    },
    {
        id: "graze-visual",
        eventId: "projectile.graze.commit",
        modality: "visual",
        cueId: "graze.notch-pulse",
        fallbackCueId: "graze.notch-steady",
        gameplayCritical: true,
        usesFlashing: true,
    },
    {
        id: "graze-audio",
        eventId: "projectile.graze.commit",
        modality: "audio",
        cueId: "graze.evidence-tick",
        gameplayCritical: false,
    },
    {
        id: "override-open-visual",
        eventId: "player.override.local_void.open",
        modality: "visual",
        cueId: "override.directional-tear.flash",
        fallbackCueId: "override.directional-tear.steady",
        gameplayCritical: true,
        motionSensitive: true,
        usesFlashing: true,
    },
    {
        id: "override-open-audio",
        eventId: "player.override.local_void.open",
        modality: "audio",
        cueId: "override.digital-tear",
        gameplayCritical: false,
    },
    {
        id: "override-open-haptic",
        eventId: "player.override.local_void.open",
        modality: "haptic",
        cueId: "override.directional-double-pulse",
        gameplayCritical: false,
    },
    {
        id: "override-close-visual",
        eventId: "player.override.local_void.close",
        modality: "visual",
        cueId: "override.boundary-collapse-steady",
        gameplayCritical: true,
    },
    {
        id: "scar-write-visual",
        eventId: "cross_run.scar.write.commit",
        modality: "visual",
        cueId: "material.override-scar-write",
        gameplayCritical: false,
    },
    {
        id: "projectile-arm-visual",
        eventId: "projectile.arm.begin",
        modality: "visual",
        cueId: "projectile.telegraph.motion",
        fallbackCueId: "projectile.telegraph.steady",
        gameplayCritical: true,
        motionSensitive: true,
    },
    {
        id: "projectile-live-visual",
        eventId: "projectile.collision.on",
        modality: "visual",
        cueId: "projectile.live-notch-steady",
        gameplayCritical: true,
    },
    {
        id: "player-damage-audio",
        eventId: "player.damage.commit",
        modality: "audio",
        cueId: "player.damage-material-click",
        gameplayCritical: false,
    },
    {
        id: "boss-phase-visual",
        eventId: "boss.phase.swap",
        modality: "visual",
        cueId: "boss.topology-phase-boundary",
        fallbackCueId: "boss.topology-phase-boundary.steady",
        gameplayCritical: true,
        motionSensitive: true,
    },
    {
        id: "boss-resolve-ui",
        eventId: "boss.encounter.resolve",
        modality: "ui",
        cueId: "boss.resolution-fact",
        gameplayCritical: true,
    },
    {
        id: "weather-omen-visual",
        eventId: "weather.omen.begin",
        modality: "visual",
        cueId: "weather.omen-world-space",
        fallbackCueId: "weather.omen-boundary-steady",
        gameplayCritical: true,
        motionSensitive: true,
    },
    {
        id: "weather-active-visual",
        eventId: "weather.active.begin",
        modality: "visual",
        cueId: "weather.body-world-space",
        fallbackCueId: "weather.body-steady-mask",
        gameplayCritical: true,
        motionSensitive: true,
        usesFlashing: true,
    },
    {
        id: "snapshot-begin-ui",
        eventId: "snapshot.begin",
        modality: "ui",
        cueId: "snapshot.observational-frame",
        gameplayCritical: true,
    },
    {
        id: "cross-run-restore-ui",
        eventId: "cross_run.restore.begin",
        modality: "ui",
        cueId: "cross-run.restore-order-marker",
        gameplayCritical: true,
    },
    {
        id: "override-scar-rehydrate-visual",
        eventId: "overrideScar.rehydrate",
        modality: "visual",
        cueId: "material.override-scar-rehydrate-steady",
        gameplayCritical: true,
    },
    {
        id: "death-trace-rehydrate-visual",
        eventId: "deathTrace.rehydrate",
        modality: "visual",
        cueId: "material.death-trace-rehydrate-steady",
        gameplayCritical: true,
    },
    {
        id: "burn-in-rehydrate-visual",
        eventId: "burnIn.rehydrate",
        modality: "visual",
        cueId: "material.burn-in-rehydrate-steady",
        gameplayCritical: true,
    },
    {
        id: "ghost-replay-begin-visual",
        eventId: "ghost.replay.begin",
        modality: "visual",
        cueId: "ghost.actual-route-linear",
        fallbackCueId: "ghost.actual-route-event-pins",
        gameplayCritical: true,
        motionSensitive: true,
    },
    {
        id: "ghost-replay-complete-visual",
        eventId: "ghost.replay.complete",
        modality: "visual",
        cueId: "ghost.burnout-oldest-to-newest",
        fallbackCueId: "ghost.burnout-final-point-steady",
        gameplayCritical: true,
        motionSensitive: true,
    },
    {
        id: "ghost-residue-write-visual",
        eventId: "ghost.residue.write",
        modality: "visual",
        cueId: "material.ghost-residue-write-steady",
        gameplayCritical: true,
    },
    {
        id: "witness-turn-visual",
        eventId: "witness.turn",
        modality: "visual",
        cueId: "witness.fact-directed-turn",
        fallbackCueId: "witness.fact-directed-facing-steady",
        gameplayCritical: true,
        motionSensitive: true,
    },
    {
        id: "room-transition-visual",
        eventId: "room.transition.begin",
        modality: "visual",
        cueId: "room.threshold-motion",
        fallbackCueId: "room.threshold-steady",
        gameplayCritical: true,
        motionSensitive: true,
    },
    {
        id: "room-transition-audio",
        eventId: "room.transition.begin",
        modality: "audio",
        cueId: "room.crossfade-spatial",
        fallbackCueId: "room.crossfade-mono",
        gameplayCritical: false,
        binaural: true,
    },
    {
        id: "player-collision-on-visual",
        eventId: "player.collision.on",
        modality: "visual",
        cueId: "player.hitbox-ready-steady",
        gameplayCritical: true,
    },
    {
        id: "cross-run-input-ui",
        eventId: "returnInput",
        modality: "ui",
        cueId: "cross-run.input-return-marker",
        gameplayCritical: true,
    },
    {
        id: "room-world-swap-visual",
        eventId: "room.transition.world_swap.commit",
        modality: "visual",
        cueId: "room.world-swap-boundary-steady",
        gameplayCritical: true,
    },
]);
