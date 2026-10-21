/** Sets the paper size and margins used by window.print(). Renders nothing visible. */
export default function PrintPage({ paper = 'A4', landscape = false, margin = '12mm' }) {
  const size = { A4: 'A4', Letter: 'letter', Legal: 'legal' }[paper] ?? 'A4'
  return <style>{`@page { size: ${size} ${landscape ? 'landscape' : 'portrait'}; margin: ${margin}; }`}</style>
}
