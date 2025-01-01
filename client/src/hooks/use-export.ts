import { useCallback } from 'react';
import { ExportableData, exportToPDF, exportToCSV } from '@/lib/export';
import { useToast } from '@/hooks/use-toast';

type ExportFormat = 'pdf' | 'csv';

export function useExport() {
  const { toast } = useToast();

  const exportData = useCallback((
    data: ExportableData,
    title: string,
    format: ExportFormat
  ) => {
    try {
      if (format === 'pdf') {
        exportToPDF(data, title);
      } else {
        exportToCSV(data, title);
      }
      
      toast({
        title: "Export Successful",
        description: `${title} has been exported as ${format.toUpperCase()}`,
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: "Export Failed",
        description: "There was an error exporting your data. Please try again.",
        variant: "destructive",
      });
    }
  }, [toast]);

  return { exportData };
}
