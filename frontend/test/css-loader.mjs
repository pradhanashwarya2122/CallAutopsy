// Lets Node import components that `import './x.css'` (Vite handles that in the app; here the styles are irrelevant).
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };
  return nextLoad(url, context);
}
