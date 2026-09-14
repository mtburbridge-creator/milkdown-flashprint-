/// Counts the pages of a PDF produced by Chromium. Chromium writes one
/// uncompressed `/Type /Page` dictionary per page, so a scan of the raw
/// bytes is enough and avoids a PDF parser dependency.
export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString('latin1')
  return (text.match(/\/Type\s*\/Page(?![s])/g) ?? []).length
}
