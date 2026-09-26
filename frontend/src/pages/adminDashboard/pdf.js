function getJsPDF() {
  return (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
}

export function createPdfDoc() {
  const JsPDFCtor = getJsPDF();
  return new JsPDFCtor();
}

export function pdfTitle(doc, title, subtitle) {
  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text(title, 14, 18);
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  doc.setTextColor(100);
  doc.text(subtitle, 14, 25);
  doc.setTextColor(0);
}

export function pdfTable(doc, head, body, startY) {
  doc.autoTable({
    head: [head],
    body,
    startY: startY || 30,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 23, 42] }
  });
  return doc.lastAutoTable.finalY + 10;
}
