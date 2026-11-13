import {runAgentTurn} from './agent/runtime.js';

// Preserve the existing SMS entry point for webhooks and integration callers.
export async function coordinateSms(options) {
  return runAgentTurn(options);
}
