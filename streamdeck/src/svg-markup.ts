// Pieces of the SVG the deck renders (with Qt's SVG module: rect, circle, path, text, image).
export const FONT = '-apple-system, Helvetica, Arial, sans-serif'

export function text(x: number, y: number, value: string, size: number, fill: string, weight = 500, anchor: 'start' | 'middle' = 'middle'): string {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(value)}</text>`
}

export function svgDataUri(width: number, height: number, body: string): string {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}\n</svg>`
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(markup)}`
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
}
