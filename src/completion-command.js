// Completion is an explicit staff command, never a model-inferred status.
export function parseCompletionCommand(text='') {
  const match=String(text).trim().match(/^DONE(?:[ \t]+#([1-9]\d*))?$/);
  return match?{jobNumber:match[1] || null}:null;
}

export function looksLikeCompletionCommand(text='') {
  return /^(?:done|finished|complete(?:d)?|fixed|resolved|all set)(?:\b|(?=[0-9_]))|^(?:(?:job|request)\s+)?#?\d+[ \t]+(?:is[ \t]+)?(?:done|finished|complete(?:d)?|fixed|resolved)(?:\b|(?=[0-9_]))/i.test(String(text).trim());
}
