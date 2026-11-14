import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';

describe('installed jsPDF runtime compatibility', () => {
  it('embeds a valid PNG on the questionnaire custom page and produces a real PDF blob', () => {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [612, 4356], compress: true, precision: 16 });
    // A valid one-pixel RGBA PNG, including matching chunk CRCs. This exercises
    // the actual image decoder/output API instead of the DOM-template mocks.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNISfn/HwAFvgLHsgXPGQAAAABJRU5ErkJggg==';
    pdf.addImage(png, 'PNG', 0, 0, 612, 4356, undefined, 'FAST');
    const bytes = pdf.output('arraybuffer');
    const blob = pdf.output('blob');
    expect(new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5))).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(1000);
    expect(pdf.internal.pageSize.getWidth()).toBe(612);
    expect(pdf.internal.pageSize.getHeight()).toBe(4356);
    expect(pdf.getNumberOfPages()).toBe(1);
  });
});
