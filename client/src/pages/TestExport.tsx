import { Button } from "@/components/ui/button";
import { useExport } from "@/hooks/use-export";

export default function TestExport() {
  const { exportData } = useExport();

  const sampleData = {
    headers: ['Name', 'Age', 'City'],
    rows: [
      ['John Doe', 30, 'New York'],
      ['Jane Smith', 25, 'Los Angeles'],
      ['Bob Johnson', 35, 'Chicago'],
    ],
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Test Export Functionality</h1>
      <div className="space-x-4">
        <Button
          onClick={() => exportData(sampleData, 'Sample Report', 'pdf')}
        >
          Export as PDF
        </Button>
        <Button
          onClick={() => exportData(sampleData, 'Sample Report', 'csv')}
        >
          Export as CSV
        </Button>
      </div>
    </div>
  );
}
