/* eslint-disable */
// Design Toolbar — Driver registry.
//
// Maps an Agent name to its Driver. This is the whole seam: adding an agent is
// one new Driver module plus one entry here — the Bridge, wire protocol, and
// client never change.
import { claude } from './claude.mjs';
import { codex } from './codex.mjs';
import { cursor } from './cursor.mjs';

export const DRIVERS = { claude, codex, cursor };
export const getDriver = (name) => (name && DRIVERS[name]) || null;
