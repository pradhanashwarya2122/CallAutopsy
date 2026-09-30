// Demo-call categories, shared by every page that offers a choice of demo call.
export const CATEGORY_LABEL = {
  healthy: 'Healthy baseline', noisy: 'Noisy audio', mumbled: 'Unclear speech', long: 'Long conversation', multi_intent: 'Multi-intent',
  clear: 'Clean baseline', hesitant: 'Hesitant speech', noisy_slow: 'Slow + noisy', interruptions: 'Interruptions',
  telephone: 'Phone quality', cafe: 'Café noise', corrections: 'Self-corrections', ambiguity: 'Ambiguity', maximum: 'Maximum stress',
};
export const GROUP_LABEL = [['core', 'Core scenarios'], ['stress', 'Stress tests'], ['quick', 'Quick clips']];

// [[heading, samples], ...] in display order, skipping empty groups.
export function groupSamples(samples) {
  return GROUP_LABEL
    .map(([g, label]) => [label, (samples || []).filter((x) => (x.group || 'quick') === g)])
    .filter(([, list]) => list.length);
}

export const optionText = (s) => `${s.label}${s.category ? ` · ${CATEGORY_LABEL[s.category] || s.category}` : ''}${s.duration_s ? ` (${Math.round(s.duration_s)}s)` : ''}`;
