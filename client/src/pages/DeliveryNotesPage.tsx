import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDate, formatQuantity } from "@/utils/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { ColumnHeader, TableControlsBar } from "@/components/ui/table-controls";
import { useTableControls } from "@/hooks/use-table-controls";
import { usePermissions } from "@/hooks/use-permissions";
import { CheckCircle2, Plus, Printer } from "lucide-react";
import { DeliveryNoteFormDialog } from "@/components/SalesOrders/DeliveryNoteFormDialog";
import { DeliveryNotePrintDialog } from "@/components/SalesOrders/DeliveryNotePrint";

interface DeliveryNoteItem {
  id: number;
  productCode: string;
  description: string;
  orderedQuantity: number;
  deliveredQuantity: number;
}

interface DeliveryNoteRow {
  id: number;
  deliveryNoteNumber: string;
  deliveryDate: string;
  customerName: string;
  companyName?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  deliveryAddress?: string | null;
  customerConfirmed: boolean;
  remarks?: string | null;
  status: string;
  salesOrder?: {
    id: number;
    orderNumber: string;
    customerName: string;
    status: string;
  } | null;
  deliveredByUser?: { id: number; username: string } | null;
  items?: DeliveryNoteItem[] | null;
}

/** Units that physically left the warehouse on this note. */
function unitsOnNote(note: DeliveryNoteRow): number {
  return (note.items ?? []).reduce((sum, line) => sum + Number(line.deliveredQuantity || 0), 0);
}

/**
 * Delivery Notes - the goods-out paper trail (PDF page 2).
 *
 * Notes are issued from a sales order, never edited: once the customer has signed for the goods
 * the document is history, so this screen only lists, filters and reprints them. The "New"
 * button opens the same dialog the Sales Orders screen uses, so there is one issue path.
 */
function DeliveryNotesPage() {
  const { hasPermission } = usePermissions();
  const canIssue = hasPermission("orders", "update");

  const [searchTerm, setSearchTerm] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);

  const { data: notes = [], isLoading } = useQuery<DeliveryNoteRow[]>({
    queryKey: ["/api/delivery-notes"],
  });

  const notesTable = useTableControls(
    notes,
    {
      noteNumber: (note) => note.deliveryNoteNumber,
      salesOrder: (note) => note.salesOrder?.orderNumber ?? "",
      customer: (note) => note.customerName,
      deliveryDate: (note) => (note.deliveryDate ? new Date(note.deliveryDate) : null),
      units: (note) => unitsOnNote(note),
    },
    {
      filter: (note) => {
        const needle = searchTerm.toLowerCase();
        return (
          note.deliveryNoteNumber.toLowerCase().includes(needle) ||
          (note.salesOrder?.orderNumber ?? "").toLowerCase().includes(needle) ||
          note.customerName.toLowerCase().includes(needle) ||
          (note.contactPerson ?? "").toLowerCase().includes(needle) ||
          (note.remarks ?? "").toLowerCase().includes(needle)
        );
      },
    }
  );

  const visibleNotes = notesTable.rows;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Delivery Notes</h1>
          <p className="text-muted-foreground">
            What actually left the warehouse, signed off by the customer.
          </p>
        </div>
        {canIssue && (
          <Button onClick={() => setIssueOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Delivery Note
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Delivery Note List</CardTitle>
            <p className="text-caption text-muted-foreground">
              {visibleNotes.length} note{visibleNotes.length === 1 ? "" : "s"}
            </p>
          </div>
          <SearchInput
            containerClassName="w-full max-w-sm"
            placeholder="Search note no., order no., customer..."
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-6 text-center text-muted-foreground">Loading delivery notes...</div>
          ) : notes.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-muted-foreground">
                No delivery notes yet. Issue one from a sales order once the goods ship.
              </p>
              {canIssue && (
                <Button variant="outline" className="mt-3" onClick={() => setIssueOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Issue a delivery note
                </Button>
              )}
            </div>
          ) : (
            <>
              <TableControlsBar controls={notesTable} noun="delivery notes" />
              <Table className="table-actions-sticky min-w-[1000px]">
                <TableHeader>
                  <TableRow>
                    <ColumnHeader controls={notesTable} columnKey="noteNumber" label="Note No." filterPlaceholder="Filter note no." />
                    <ColumnHeader controls={notesTable} columnKey="salesOrder" label="Sales Order" filterPlaceholder="Filter order no." />
                    <ColumnHeader controls={notesTable} columnKey="customer" label="Customer" filterPlaceholder="Filter customer" />
                    <ColumnHeader controls={notesTable} columnKey="deliveryDate" label="Delivered On" filterPlaceholder="Filter date" />
                    <ColumnHeader controls={notesTable} columnKey="units" label="Units" filterPlaceholder="Filter units" />
                    <TableHead className="align-top">Customer Sign-off</TableHead>
                    <TableHead className="text-right align-top">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleNotes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        No delivery notes match the current search.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleNotes.map((note) => (
                      <TableRow key={note.id}>
                        <TableCell className="font-medium">{note.deliveryNoteNumber}</TableCell>
                        <TableCell>
                          <div>{note.salesOrder?.orderNumber ?? "-"}</div>
                          {note.salesOrder?.status === "partially_delivered" && (
                            <div className="text-caption text-muted-foreground">
                              Partially delivered
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{note.customerName}</TableCell>
                        <TableCell>{formatDate(note.deliveryDate)}</TableCell>
                        <TableCell className="text-right">
                          {formatQuantity(unitsOnNote(note))}
                        </TableCell>
                        <TableCell>
                          {note.customerConfirmed ? (
                            <Badge variant="success">
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              Confirmed
                            </Badge>
                          ) : (
                            <Badge variant="warning">Awaiting signature</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <DeliveryNotePrintDialog note={note}>
                            <Button variant="ghost" size="sm" title="Print delivery note">
                              <Printer className="h-4 w-4" />
                              <span className="sr-only">
                                Print {note.deliveryNoteNumber}
                              </span>
                            </Button>
                          </DeliveryNotePrintDialog>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <DeliveryNoteFormDialog open={issueOpen} onOpenChange={setIssueOpen} />
    </div>
  );
}

export default DeliveryNotesPage;

