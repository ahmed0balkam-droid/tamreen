// Test helper: pretend it's 12:00 in Istanbul so test sessions never cross midnight.
const real = Date.now;
const d = new Date(real() + 3 * 3600e3); d.setUTCHours(12, 0, 0, 0);
const SHIFT = d.getTime() - 3 * 3600e3 - real();
process.env.SHIFT_MS = String(SHIFT);
const RD = Date;
global.Date = class extends RD { constructor(...a) { if (a.length === 0) super(real() + SHIFT); else super(...a); } static now() { return real() + SHIFT; } };
