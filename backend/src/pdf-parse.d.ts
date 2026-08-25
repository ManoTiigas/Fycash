declare module 'pdf-parse/lib/pdf-parse.js' {
  type PdfResult = { text: string };
  function pdf(buffer: Buffer): Promise<PdfResult>;
  export default pdf;
}
