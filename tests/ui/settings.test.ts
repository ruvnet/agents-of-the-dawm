import { describe, expect, it } from 'vitest';
import { defaultSettings, mergeSettings, rebind, settingsErrors, validateSettings } from '../../src/ui/settings';

describe('settings validation for untrusted stored settings', () => {
  it('defaults validate', () => {
    expect(settingsErrors(defaultSettings())).toEqual([]);
    const v = validateSettings(defaultSettings());
    expect(v.ok).toBe(true);
  });

  it.each([
    null, undefined, 42, 'settings', [], {}, { version: 2 },
    { ...defaultSettings(), textScale: 3 },
    { ...defaultSettings(), quality: 'ultra' },
    { ...defaultSettings(), renderer: 'vulkan' },
    { ...defaultSettings(), lookSensitivity: Infinity },
    { ...defaultSettings(), audio: { ...defaultSettings().audio, master: 2 } },
    { ...defaultSettings(), camera: { ...defaultSettings().camera, fovDeg: 170 } },
    { ...defaultSettings(), bindings: { keyboard: { forward: ['<script>'] }, gamepad: {} } },
    { ...defaultSettings(), bindings: { ...defaultSettings().bindings, gamepad: { jump: [99] } } },
    { ...defaultSettings(), bindings: { ...defaultSettings().bindings, gamepad: { fly: [0] } } },
    { ...defaultSettings(), locale: 'xx' },
  ])('rejects garbage %#', (raw) => {
    const v = validateSettings(raw);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.length).toBeGreaterThan(0);
  });

  it('mergeSettings keeps valid fields and drops invalid ones', () => {
    const m = mergeSettings({
      textScale: 2, captions: false, quality: 'ultra', lookSensitivity: -4,
      audio: { master: 0.5, music: 'loud' }, bindings: { keyboard: { jump: ['KeyZ'], pulse: [1, 2] } },
      __proto__: { polluted: true },
    });
    const d = defaultSettings();
    expect(m.textScale).toBe(2);
    expect(m.captions).toBe(false);
    expect(m.quality).toBe(d.quality);
    expect(m.lookSensitivity).toBe(d.lookSensitivity);
    expect(m.audio.master).toBe(0.5);
    expect(m.audio.music).toBe(d.audio.music);
    expect(m.bindings.keyboard.jump).toEqual(['KeyZ']);
    expect(m.bindings.keyboard.pulse).toEqual(d.bindings.keyboard.pulse);
    expect(settingsErrors(m)).toEqual([]);
    expect((m as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('mergeSettings of garbage gives defaults and never throws', () => {
    for (const g of [null, 1, 'x', [], { camera: 5, audio: [], bindings: 'no' }]) {
      expect(mergeSettings(g)).toEqual(defaultSettings());
    }
  });

  it('validateSettings returns a copy, not the input object', () => {
    const d = defaultSettings();
    const v = validateSettings(d);
    expect(v.ok && v.value !== d && v.value.bindings !== d.bindings).toBe(true);
  });

  it('rebind rejects invalid inputs and never shares one input between actions', () => {
    const b = defaultSettings().bindings;
    expect(rebind(b, 'keyboard', 'jump', '<bad>')).toEqual(b);
    expect(rebind(b, 'gamepad', 'jump', 42)).toEqual(b);
    const r = rebind(b, 'keyboard', 'interact', 'KeyF');
    expect(r.keyboard.interact[0]).toBe('KeyF');
    expect(r.keyboard.shift).not.toContain('KeyF');
  });
});
