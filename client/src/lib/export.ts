import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

export type ExportableData = {
  headers: string[];
  rows: (string | number)[][];
};

export function exportToPDF(data: ExportableData, title: string) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Add title
  doc.setFontSize(16);
  doc.text(title, pageWidth/2, 20, { align: 'center' });

  // Add date
  doc.setFontSize(12);
  doc.text(new Date().toLocaleDateString(), pageWidth/2, 30, { align: 'center' });

  // Add table
  (doc as any).autoTable({
    head: [data.headers],
    body: data.rows,
    startY: 40,
    styles: {
      fontSize: 10,
      cellPadding: 3,
    },
    headStyles: {
      fillColor: [66, 66, 66],
    },
  });

  // Download the PDF
  doc.save(`${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`);
}

export function exportToCSV(data: ExportableData, title: string) {
  // Convert data to CSV format
  const csvContent = [
    data.headers.join(','),
    ...data.rows.map(row => 
      row.map(cell => 
        typeof cell === 'string' && cell.includes(',') 
          ? `"${cell}"`
          : cell
      ).join(',')
    )
  ].join('\n');

  // Create a Blob containing the CSV data
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  // Create a link element to trigger the download
  const link = document.createElement('a');
  if (window.navigator.msSaveOrOpenBlob) {
    // IE10+
    window.navigator.msSaveOrOpenBlob(blob, `${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`);
  } else {
    // Other browsers
    link.href = URL.createObjectURL(blob);
    link.download = `${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`;

    // Append to body, click, and remove
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Helper function to format date for export
export function formatDateForExport(date: Date): string {
  return date.toLocaleDateString();
}

// Helper function to format currency for export
export function formatCurrencyForExport(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}