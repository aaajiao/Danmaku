import informationBedUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/rooms/information-bed.wav?url";
import forcedBedUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/rooms/forced-alignment-bed.wav?url";
import betweenBedUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/rooms/in-between-bed.wav?url";
import polarizedBedUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/rooms/polarized-bed.wav?url";
import grazeUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/sfx/graze-evidence.wav?url";
import damageUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/sfx/player-damage.wav?url";
import overrideUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/sfx/override-tear.wav?url";
import deniedUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/sfx/override-charge.wav?url";
import protocolUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/sfx/protocol-withdraw.wav?url";

const ROOM_BEDS: Record<string, string> = {
  INFORMATION: informationBedUrl,
  FORCED_ALIGNMENT: forcedBedUrl,
  IN_BETWEEN: betweenBedUrl,
  POLARIZED: polarizedBedUrl,
  COMMON: informationBedUrl,
  TRANSITION: betweenBedUrl,
};

const SFX: Record<string, string> = {
  graze: grazeUrl,
  damage: damageUrl,
  override: overrideUrl,
  "override-denied": deniedUrl,
  protocol: protocolUrl,
};

export class AudioTrace {
  private enabled = true;
  private unlocked = false;
  private currentRoom = "";
  private bed: HTMLAudioElement | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.bed?.pause();
    else if (this.unlocked) void this.bed?.play().catch(() => undefined);
  }

  async unlock(room: string): Promise<void> {
    this.unlocked = true;
    this.setRoom(room);
    if (this.enabled) await this.bed?.play().catch(() => undefined);
  }

  setRoom(room: string): void {
    if (room === this.currentRoom) return;
    this.currentRoom = room;
    this.bed?.pause();
    const source = ROOM_BEDS[room] ?? ROOM_BEDS.INFORMATION;
    if (!source) return;
    this.bed = new Audio(source);
    this.bed.loop = true;
    this.bed.volume = 0.16;
    if (this.enabled && this.unlocked) void this.bed.play().catch(() => undefined);
  }

  play(type: string): void {
    if (!this.enabled || !this.unlocked) return;
    const source = SFX[type];
    if (!source) return;
    const sound = new Audio(source);
    sound.volume = type === "damage" ? 0.34 : 0.24;
    void sound.play().catch(() => undefined);
  }
}
