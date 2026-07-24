/**
 * Xbox Bluetooth controller fallback for Chromium's WebHID API.
 *
 * Chrome's ordinary Gamepad API remains the primary path. This source exists
 * for installed macOS PWAs where Chrome's Apple GameController backend can
 * receive no reports while the app shim is frontmost. WebHID reaches the
 * controller through its HID reports instead and contributes the same digital
 * `Buttons` mask as every other device (CLAUDE.md, rule 4).
 */

import {
  Button,
  quantizeStick,
  type Buttons,
  type DigitalInputSource,
} from './input';

/**
 * Phase-one support is deliberately exact: the controller being repaired is
 * the Xbox One S Bluetooth device (045e:02fd, firmware 9.0.3). Newer Xbox
 * product IDs use different raw button layouts and must get their own decoder
 * before being added here.
 */
export const XBOX_BLUETOOTH_PRODUCT_IDS = [
  0x02fd,
] as const;

const MICROSOFT_VENDOR_ID = 0x045e;
const INPUT_REPORT_ID = 0x01;
const INPUT_REPORT_BYTES = 16;
const STICK_LOGICAL_MAX = 65535;
/** Chromium marks an analog GamepadButton pressed above 30 / 255. */
const TRIGGER_PRESSED = 121;

interface WebHidDeviceFilter {
  readonly vendorId?: number;
  readonly productId?: number;
  readonly usagePage?: number;
  readonly usage?: number;
}

interface WebHidRequestOptions {
  readonly filters: readonly WebHidDeviceFilter[];
}

/**
 * Narrow local WebHID declarations. TypeScript's DOM library does not yet ship
 * this API; keeping the shape local avoids a global declaration that could
 * collide when it eventually does.
 */
export interface WebHidDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
}

export interface WebHidApi extends EventTarget {
  getDevices(): Promise<readonly WebHidDevice[]>;
  requestDevice(options: WebHidRequestOptions): Promise<readonly WebHidDevice[]>;
}

interface WebHidConnectionEvent extends Event {
  readonly device: WebHidDevice;
}

interface WebHidInputReportEvent extends Event {
  readonly data: DataView;
  readonly device: WebHidDevice;
  readonly reportId: number;
}

export type XboxWebHidPhase =
  | 'idle'
  | 'selecting'
  | 'opening'
  | 'waiting'
  | 'ready'
  | 'disconnected'
  | 'error';

export interface XboxWebHidStatus {
  readonly phase: XboxWebHidPhase;
  readonly deviceName?: string;
  readonly error?: unknown;
}

export type XboxWebHidStatusListener = (status: XboxWebHidStatus) => void;

const XBOX_FILTERS: readonly WebHidDeviceFilter[] =
  XBOX_BLUETOOTH_PRODUCT_IDS.map((productId) => ({
    vendorId: MICROSOFT_VENDOR_ID,
    productId,
  }));

/** Return the browser API without installing speculative global DOM types. */
export function browserWebHid(): WebHidApi | undefined {
  return (navigator as Navigator & { readonly hid?: WebHidApi }).hid;
}

export function isXboxBluetoothDevice(device: WebHidDevice): boolean {
  return device.vendorId === MICROSOFT_VENDOR_ID
    && XBOX_BLUETOOTH_PRODUCT_IDS.some(
      (productId) => productId === device.productId,
    );
}

function normaliseStick(raw: number): number {
  return (2 * raw) / STICK_LOGICAL_MAX - 1;
}

function hatButtons(hat: number): Buttons {
  switch (hat) {
    case 1: return Button.Up;
    case 2: return Button.Up | Button.Right;
    case 3: return Button.Right;
    case 4: return Button.Right | Button.Down;
    case 5: return Button.Down;
    case 6: return Button.Down | Button.Left;
    case 7: return Button.Left;
    case 8: return Button.Left | Button.Up;
    default: return 0;
  }
}

/**
 * Decode report 1 from the Linux/Android-mode Bluetooth HID descriptor exposed
 * by the 045e:02fd controller. WebHID supplies `reportId` separately, so byte
 * zero here is the low byte of the left-stick X value rather than the report
 * ID.
 *
 * `undefined` means "not a controller-state report". It must not be treated as
 * neutral input: guide-button, battery, and vendor reports may arrive between
 * state reports and must not synthesize releases.
 */
export function decodeXboxBluetoothReport(
  reportId: number,
  data: DataView,
): Buttons | undefined {
  if (reportId !== INPUT_REPORT_ID || data.byteLength < INPUT_REPORT_BYTES) {
    return undefined;
  }

  const leftX = normaliseStick(data.getUint16(0, true));
  const leftY = normaliseStick(data.getUint16(2, true));
  const leftTrigger = data.getUint16(8, true) & 0x03ff;
  const rightTrigger = data.getUint16(10, true) & 0x03ff;
  const hat = data.getUint8(12) & 0x0f;
  const buttonsLow = data.getUint8(13);
  const buttonsHigh = data.getUint8(14);

  let mask = quantizeStick(leftX, leftY) | hatButtons(hat);

  if ((buttonsLow & 0x01) !== 0) mask |= Button.Shot; // A
  if ((buttonsLow & 0x02) !== 0) mask |= Button.Bomb; // B
  if ((buttonsLow & 0x08) !== 0) mask |= Button.Bomb; // X
  if ((buttonsLow & 0x40) !== 0) mask |= Button.Slow; // LB
  if ((buttonsLow & 0x80) !== 0) mask |= Button.Slow; // RB
  if ((buttonsHigh & 0x08) !== 0) mask |= Button.Start; // Menu
  if (leftTrigger >= TRIGGER_PRESSED) mask |= Button.Slow;
  if (rightTrigger >= TRIGGER_PRESSED) mask |= Button.Slow;

  return mask;
}

function errorName(error: unknown): string | undefined {
  if (
    typeof error !== 'object'
    || error === null
    || !('name' in error)
  ) {
    return undefined;
  }
  const name = (error as { readonly name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

/**
 * Event-fed source with a one-tick rising-edge latch.
 *
 * HID callbacks only update this private digital state. The simulation still
 * observes it exactly once through `Input.sample()` → `consume()`.
 */
export class XboxWebHidInput implements DigitalInputSource {
  readonly #hid: WebHidApi;
  readonly #onStatus: XboxWebHidStatusListener;
  #device: WebHidDevice | undefined;
  #held: Buttons = 0;
  #latched: Buttons = 0;
  #started = false;
  #receivedStateReport = false;
  #operationEpoch = 0;
  #activationEpoch = 0;
  #openingDevice: WebHidDevice | undefined;
  #openingPromise: Promise<void> | undefined;

  constructor(
    hid: WebHidApi,
    onStatus: XboxWebHidStatusListener = () => {},
  ) {
    this.#hid = hid;
    this.#onStatus = onStatus;
  }

  get connected(): boolean {
    return this.#device?.opened === true;
  }

  /**
   * Restore an origin-granted device without showing a chooser.
   * Failures are reported to the shell and never block game startup.
   */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#hid.addEventListener('connect', this.#onConnect);
    this.#hid.addEventListener('disconnect', this.#onDisconnect);
    const operation = ++this.#operationEpoch;

    try {
      const devices = await this.#hid.getDevices();
      if (!this.#started || operation !== this.#operationEpoch) return;
      const device = devices.find(isXboxBluetoothDevice);
      if (device === undefined) {
        this.#setStatus({ phase: 'idle' });
        return;
      }
      await this.#activate(device);
    } catch (error) {
      if (operation === this.#operationEpoch) this.#fail(error);
    }
  }

  /**
   * Show Chrome's device chooser.
   *
   * Keep `requestDevice()` as the first asynchronous browser call: callers
   * invoke this method directly from a click so the required user activation
   * has not expired.
   */
  async requestDevice(): Promise<void> {
    const operation = ++this.#operationEpoch;
    this.#setStatus({ phase: 'selecting' });

    try {
      const devices = await this.#hid.requestDevice({ filters: XBOX_FILTERS });
      if (operation !== this.#operationEpoch) return;
      const device = devices.find(isXboxBluetoothDevice);
      if (device === undefined) {
        this.#setStatus({ phase: 'idle' });
        return;
      }
      await this.#activate(device);
    } catch (error) {
      if (operation !== this.#operationEpoch) return;
      // Chrome reports a cancelled chooser as NotFoundError. Cancellation is
      // not a broken controller and should remain immediately retryable.
      if (errorName(error) === 'NotFoundError') {
        this.#setStatus({ phase: 'idle' });
      } else {
        this.#fail(error);
      }
    }
  }

  consume(): Buttons {
    const buttons = this.#held | this.#latched;
    this.#latched = 0;
    return buttons;
  }

  reset(): void {
    this.#held = 0;
    this.#latched = 0;
  }

  dispose(): void {
    this.#operationEpoch++;
    if (this.#started) {
      this.#started = false;
      this.#hid.removeEventListener('connect', this.#onConnect);
      this.#hid.removeEventListener('disconnect', this.#onDisconnect);
    }
    this.#detachDevice();
    this.reset();
  }

  #setStatus(status: XboxWebHidStatus): void {
    this.#onStatus(status);
  }

  #setButtons(buttons: Buttons): void {
    this.#latched |= buttons & ~this.#held;
    this.#held = buttons;
  }

  async #activate(device: WebHidDevice): Promise<void> {
    if (
      this.#openingDevice === device
      && this.#openingPromise !== undefined
    ) {
      await this.#openingPromise;
      return;
    }

    const opening = this.#openDevice(device);
    this.#openingDevice = device;
    this.#openingPromise = opening;
    await opening;
    if (this.#openingPromise === opening) {
      this.#openingDevice = undefined;
      this.#openingPromise = undefined;
    }
  }

  async #openDevice(device: WebHidDevice): Promise<void> {
    if (this.#device !== device) {
      this.#detachDevice();
      this.reset();
      this.#device = device;
      this.#receivedStateReport = false;
      device.addEventListener('inputreport', this.#onInputReport);
    }

    const activation = ++this.#activationEpoch;
    const deviceName = device.productName || 'Xbox controller';
    if (!device.opened) {
      this.#setStatus({ phase: 'opening', deviceName });
      try {
        await device.open();
      } catch (error) {
        if (
          activation === this.#activationEpoch
          && this.#device === device
        ) {
          this.#fail(error);
        }
        return;
      }
    }

    if (
      activation !== this.#activationEpoch
      || this.#device !== device
      || !device.opened
    ) {
      return;
    }
    this.#setStatus({ phase: 'waiting', deviceName });
  }

  #detachDevice(): void {
    this.#activationEpoch++;
    this.#device?.removeEventListener('inputreport', this.#onInputReport);
    this.#device = undefined;
    this.#receivedStateReport = false;
    this.#openingDevice = undefined;
    this.#openingPromise = undefined;
  }

  #fail(error: unknown): void {
    this.#detachDevice();
    this.reset();
    this.#setStatus({ phase: 'error', error });
  }

  #onInputReport = (event: Event): void => {
    const report = event as WebHidInputReportEvent;
    if (report.device !== this.#device) return;

    const buttons = decodeXboxBluetoothReport(report.reportId, report.data);
    if (buttons === undefined) return;

    this.#setButtons(buttons);
    if (!this.#receivedStateReport) {
      this.#receivedStateReport = true;
      this.#setStatus({
        phase: 'ready',
        deviceName: report.device.productName || 'Xbox controller',
      });
    }
  };

  #onConnect = (event: Event): void => {
    const device = (event as WebHidConnectionEvent).device;
    if (!isXboxBluetoothDevice(device) || this.#device !== undefined) return;
    const operation = ++this.#operationEpoch;
    void this.#activate(device).catch((error: unknown) => {
      if (operation === this.#operationEpoch) this.#fail(error);
    });
  };

  #onDisconnect = (event: Event): void => {
    const device = (event as WebHidConnectionEvent).device;
    if (device !== this.#device) return;

    this.#operationEpoch++;
    const deviceName = device.productName || 'Xbox controller';
    this.#detachDevice();
    this.reset();
    this.#setStatus({ phase: 'disconnected', deviceName });
  };
}
