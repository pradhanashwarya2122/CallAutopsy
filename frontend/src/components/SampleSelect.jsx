import { groupSamples, optionText } from '../lib/sampleGroups';

// One dropdown holding every demo call, grouped by category (core scenarios, stress tests, quick clips).
export default function SampleSelect({ samples, value, onChange, label = 'Demo call', className = 'pc-input', style }) {
  const groups = groupSamples(samples);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={className} style={style}>
      {groups.map(([heading, list]) => (
        <optgroup key={heading} label={`${heading} (${list.length})`}>
          {list.map((x) => <option key={x.id} value={x.id}>{optionText(x)}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
