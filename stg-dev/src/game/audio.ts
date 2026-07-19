import {
  canonicalRunAssetRoom,
  canonicalRunFeedbackAudio,
  canonicalRunRoomBed,
} from "../assets/chapters/canonical-run-v4";
import type {V4RuntimeAsset} from "../assets/v4-runtime-asset";

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
    const assetRoom = canonicalRunAssetRoom(room);
    if (assetRoom === this.currentRoom) return;
    this.currentRoom = assetRoom;
    this.bed?.pause();
    const source = canonicalRunRoomBed(assetRoom);
    this.bed = new Audio(source.url);
    this.bed.loop = true;
    this.bed.volume = 0.16;
    if (this.enabled && this.unlocked) void this.bed.play().catch(() => undefined);
  }

  play(type: string): void {
    const source = canonicalRunFeedbackAudio(type);
    if (source === null) return;
    this.playAsset(source, type === "damage" ? 0.34 : 0.24);
  }

  playAsset(source: Readonly<V4RuntimeAsset>, volume = 0.24): void {
    if (!this.enabled || !this.unlocked) return;
    const sound = new Audio(source.url);
    sound.volume = volume;
    void sound.play().catch(() => undefined);
  }
}
