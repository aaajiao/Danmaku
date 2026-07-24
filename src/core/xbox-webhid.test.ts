import { describe, expect, test } from 'bun:test';
import { Button } from './input';
import {
  XBOX_BLUETOOTH_PRODUCT_IDS,
  XboxWebHidInput,
  decodeXboxBluetoothReport,
  type WebHidApi,
  type WebHidDevice,
  type XboxWebHidStatus,
} from './xbox-webhid';

interface ReportValues {
  readonly leftX?: number;
  readonly leftY?: number;
  readonly leftTrigger?: number;
  readonly rightTrigger?: number;
  readonly hat?: number;
  readonly buttonsLow?: number;
  readonly buttonsHigh?: number;
}

function report(values: ReportValues = {}): DataView {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, values.leftX ?? 32768, true);
  view.setUint16(2, values.leftY ?? 32768, true);
  view.setUint16(4, 32768, true);
  view.setUint16(6, 32768, true);
  view.setUint16(8, values.leftTrigger ?? 0, true);
  view.setUint16(10, values.rightTrigger ?? 0, true);
  view.setUint8(12, values.hat ?? 0);
  view.setUint8(13, values.buttonsLow ?? 0);
  view.setUint8(14, values.buttonsHigh ?? 0);
  return view;
}

class FakeHidDevice extends EventTarget implements WebHidDevice {
  opened = false;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  openError: unknown;
  openWait: Promise<void> | undefined;
  openCalls = 0;
  closeCalls = 0;

  constructor({
    vendorId = 0x045e,
    productId = 0x02fd,
    productName = 'Xbox Wireless Controller',
  }: {
    readonly vendorId?: number;
    readonly productId?: number;
    readonly productName?: string;
  } = {}) {
    super();
    this.vendorId = vendorId;
    this.productId = productId;
    this.productName = productName;
  }

  async open(): Promise<void> {
    this.openCalls++;
    if (this.openWait !== undefined) await this.openWait;
    if (this.openError !== undefined) throw this.openError;
    this.opened = true;
  }

  async close(): Promise<void> {
    this.closeCalls++;
    this.opened = false;
  }

  input(data: DataView, reportId = 1): void {
    const event = new Event('inputreport');
    Object.assign(event, { data, device: this, reportId });
    this.dispatchEvent(event);
  }
}

class FakeHid extends EventTarget {
  granted: WebHidDevice[] = [];
  selected: WebHidDevice[] = [];
  grantedWait: Promise<readonly WebHidDevice[]> | undefined;
  requestError: unknown;
  lastRequest: unknown;

  async getDevices(): Promise<readonly WebHidDevice[]> {
    if (this.grantedWait !== undefined) return this.grantedWait;
    return this.granted;
  }

  async requestDevice(options: unknown): Promise<readonly WebHidDevice[]> {
    this.lastRequest = options;
    if (this.requestError !== undefined) throw this.requestError;
    return this.selected;
  }

  connection(type: 'connect' | 'disconnect', device: WebHidDevice): void {
    const event = new Event(type);
    Object.assign(event, { device });
    this.dispatchEvent(event);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function driver(hid: FakeHid) {
  const statuses: XboxWebHidStatus[] = [];
  const input = new XboxWebHidInput(
    hid as unknown as WebHidApi,
    (status) => statuses.push(status),
  );
  return { input, statuses };
}

describe('Xbox 045e:02fd report decoder', () => {
  test('neutral report maps to no buttons', () => {
    expect(decodeXboxBluetoothReport(1, report())).toBe(0);
  });

  test('left stick uses the fixed inclusive deadzone', () => {
    const inside = decodeXboxBluetoothReport(1, report({
      leftX: 49151,
      leftY: 16384,
    }))!;
    expect(inside & (Button.Left | Button.Right | Button.Up | Button.Down)).toBe(0);

    const outside = decodeXboxBluetoothReport(1, report({
      leftX: 49152,
      leftY: 16383,
    }))!;
    expect(outside & Button.Right).toBeTruthy();
    expect(outside & Button.Up).toBeTruthy();
  });

  test('hat switch maps cardinals and diagonals', () => {
    expect(decodeXboxBluetoothReport(1, report({ hat: 1 }))! & Button.Up)
      .toBeTruthy();
    const downLeft = decodeXboxBluetoothReport(1, report({ hat: 6 }))!;
    expect(downLeft & Button.Down).toBeTruthy();
    expect(downLeft & Button.Left).toBeTruthy();
    expect(downLeft & Button.Right).toBeFalsy();
  });

  test('face, shoulder, and menu bits use the 02fd raw layout', () => {
    const buttons = decodeXboxBluetoothReport(1, report({
      buttonsLow: 0x01 | 0x02 | 0x08 | 0x40 | 0x80,
      buttonsHigh: 0x08,
    }))!;
    expect(buttons & Button.Shot).toBeTruthy();
    expect(buttons & Button.Bomb).toBeTruthy();
    expect(buttons & Button.Slow).toBeTruthy();
    expect(buttons & Button.Start).toBeTruthy();
  });

  test('triggers cross Chromium pressed threshold at raw value 121', () => {
    expect(
      decodeXboxBluetoothReport(1, report({ leftTrigger: 120 }))! & Button.Slow,
    ).toBeFalsy();
    expect(
      decodeXboxBluetoothReport(1, report({ rightTrigger: 121 }))! & Button.Slow,
    ).toBeTruthy();
  });

  test('unrelated and truncated reports are ignored, not neutral', () => {
    expect(decodeXboxBluetoothReport(2, report())).toBeUndefined();
    expect(
      decodeXboxBluetoothReport(1, new DataView(new ArrayBuffer(15))),
    ).toBeUndefined();
  });
});

describe('Xbox WebHID device lifecycle', () => {
  test('support is scoped to the current 02fd controller layout', () => {
    expect(XBOX_BLUETOOTH_PRODUCT_IDS).toEqual([0x02fd]);
  });

  test('an already-granted controller opens without a chooser', async () => {
    const hid = new FakeHid();
    const device = new FakeHidDevice();
    hid.granted = [device];
    const { input, statuses } = driver(hid);

    await input.start();

    expect(device.openCalls).toBe(1);
    expect(input.connected).toBe(true);
    expect(statuses.map((status) => status.phase)).toEqual([
      'opening',
      'waiting',
    ]);
  });

  test('request uses an exact Microsoft 02fd gamepad filter', async () => {
    const hid = new FakeHid();
    const device = new FakeHidDevice();
    hid.selected = [device];
    const { input } = driver(hid);

    await input.requestDevice();

    expect(hid.lastRequest).toEqual({
      filters: [{
        vendorId: 0x045e,
        productId: 0x02fd,
      }],
    });
  });

  test('a press and release between ticks is latched for one tick', async () => {
    const hid = new FakeHid();
    const device = new FakeHidDevice();
    hid.granted = [device];
    const { input } = driver(hid);
    await input.start();

    device.input(report({ buttonsLow: 0x01 }));
    device.input(report());

    expect(input.consume() & Button.Shot).toBeTruthy();
    expect(input.consume() & Button.Shot).toBeFalsy();
  });

  test('held input persists and an unrelated report cannot clear it', async () => {
    const hid = new FakeHid();
    const device = new FakeHidDevice();
    hid.granted = [device];
    const { input } = driver(hid);
    await input.start();

    device.input(report({ buttonsLow: 0x02 }));
    expect(input.consume() & Button.Bomb).toBeTruthy();
    device.input(new DataView(new ArrayBuffer(1)), 4);
    expect(input.consume() & Button.Bomb).toBeTruthy();
  });

  test('first valid state report marks the controller ready', async () => {
    const hid = new FakeHid();
    const device = new FakeHidDevice();
    hid.granted = [device];
    const { input, statuses } = driver(hid);
    await input.start();

    device.input(report());
    device.input(report({ hat: 1 }));

    expect(statuses.map((status) => status.phase)).toEqual([
      'opening',
      'waiting',
      'ready',
    ]);
  });

  test('disconnect clears held and latched input', async () => {
    const hid = new FakeHid();
    const device = new FakeHidDevice();
    hid.granted = [device];
    const { input, statuses } = driver(hid);
    await input.start();

    device.input(report({ buttonsLow: 0x02 }));
    hid.connection('disconnect', device);

    expect(input.consume()).toBe(0);
    expect(statuses.at(-1)?.phase).toBe('disconnected');
  });

  test('a cancelled chooser is idle and immediately retryable', async () => {
    const hid = new FakeHid();
    hid.requestError = { name: 'NotFoundError' };
    const { input, statuses } = driver(hid);

    await input.requestDevice();

    expect(statuses.map((status) => status.phase)).toEqual([
      'selecting',
      'idle',
    ]);
  });

  test('open failure reports an error and contributes no input', async () => {
    const hid = new FakeHid();
    const device = new FakeHidDevice();
    device.openError = new Error('busy');
    hid.granted = [device];
    const { input, statuses } = driver(hid);

    await input.start();

    expect(input.connected).toBe(false);
    expect(input.consume()).toBe(0);
    expect(statuses.at(-1)?.phase).toBe('error');
  });

  test('a granted reconnect is opened after a disconnect', async () => {
    const hid = new FakeHid();
    const first = new FakeHidDevice();
    hid.granted = [first];
    const { input } = driver(hid);
    await input.start();
    hid.connection('disconnect', first);

    const reconnected = new FakeHidDevice();
    hid.connection('connect', reconnected);
    await Promise.resolve();
    await Promise.resolve();

    expect(reconnected.openCalls).toBe(1);
    expect(input.connected).toBe(true);
  });

  test('disconnect during open cannot overwrite disconnected with waiting', async () => {
    const hid = new FakeHid();
    const device = new FakeHidDevice();
    const opening = deferred<void>();
    device.openWait = opening.promise;
    hid.granted = [device];
    const { input, statuses } = driver(hid);

    const starting = input.start();
    await Promise.resolve();
    await Promise.resolve();
    hid.connection('disconnect', device);
    opening.resolve();
    await starting;

    expect(input.connected).toBe(false);
    expect(statuses.at(-1)?.phase).toBe('disconnected');
  });

  test('a stale open rejection cannot detach a reconnected device', async () => {
    const hid = new FakeHid();
    const first = new FakeHidDevice();
    const opening = deferred<void>();
    first.openWait = opening.promise;
    first.openError = new Error('old device vanished');
    hid.granted = [first];
    const { input, statuses } = driver(hid);

    const starting = input.start();
    await Promise.resolve();
    await Promise.resolve();
    hid.connection('disconnect', first);
    const reconnected = new FakeHidDevice();
    hid.connection('connect', reconnected);
    await Promise.resolve();
    await Promise.resolve();

    opening.resolve();
    await starting;

    expect(input.connected).toBe(true);
    expect(reconnected.openCalls).toBe(1);
    expect(statuses.at(-1)?.phase).toBe('waiting');
  });

  test('a chooser result wins over a stale granted-device query', async () => {
    const hid = new FakeHid();
    const granted = new FakeHidDevice({ productName: 'stale grant' });
    const selected = new FakeHidDevice({ productName: 'selected device' });
    const grants = deferred<readonly WebHidDevice[]>();
    hid.grantedWait = grants.promise;
    hid.selected = [selected];
    const { input } = driver(hid);

    const starting = input.start();
    const requesting = input.requestDevice();
    await requesting;
    grants.resolve([granted]);
    await starting;

    expect(selected.openCalls).toBe(1);
    expect(granted.openCalls).toBe(0);
    expect(input.connected).toBe(true);
  });

  test('concurrent activation of the same device opens it only once', async () => {
    const hid = new FakeHid();
    const device = new FakeHidDevice();
    const opening = deferred<void>();
    device.openWait = opening.promise;
    hid.granted = [device];
    hid.selected = [device];
    const { input } = driver(hid);

    const starting = input.start();
    await Promise.resolve();
    await Promise.resolve();
    const requesting = input.requestDevice();
    await Promise.resolve();
    opening.resolve();
    await Promise.all([starting, requesting]);

    expect(device.openCalls).toBe(1);
    expect(input.connected).toBe(true);
  });
});
