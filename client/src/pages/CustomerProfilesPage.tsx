import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { ColumnHeader, TableControlsBar } from "@/components/ui/table-controls";
import { useTableControls } from "@/hooks/use-table-controls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreateCustomerProfileDialog } from "@/components/CustomerProfiles/CreateCustomerProfileDialog";
import { EditCustomerProfileDialog } from "@/components/CustomerProfiles/EditCustomerProfileDialog";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { Pencil, Trash2, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CustomerProfile {
  id: number;
  mobileNumber: string;
  companyName?: string | null;
  contactPerson: string;
  email: string;
  address: string;
  photo?: string;
  landLineNumber?: string | null;
  customerType: 'B2B' | 'B2C';
}

// The dropdown stores the short code; the details view spells it out.
const CUSTOMER_TYPE_LABELS: Record<CustomerProfile['customerType'], string> = {
  B2B: 'B2B - Business',
  B2C: 'B2C - Consumer',
};

// View Customer Profile Dialog Component
function ViewCustomerProfileDialog({
  profile,
  open,
  onOpenChange
}: {
  profile: CustomerProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!profile) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Taller than a short window when a photo is present, so cap the height and scroll the
          body instead of pushing the header off-screen. */}
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customer Profile Details</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Company Name</label>
            <p className="mt-1 text-sm text-foreground">{profile.companyName || 'Not specified'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              {profile.customerType === 'B2C' ? 'Customer Name' : 'Contact Person'}
            </label>
            <p className="mt-1 text-sm text-foreground">{profile.contactPerson}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Mobile Number</label>
            <p className="mt-1 text-sm text-foreground">{profile.mobileNumber}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Email</label>
            <p className="mt-1 text-sm text-foreground">{profile.email}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Customer Type</label>
            <p className="mt-1 text-sm text-foreground">
              {CUSTOMER_TYPE_LABELS[profile.customerType] ?? profile.customerType}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Land Line Number</label>
            <p className="mt-1 text-sm text-foreground">
              {profile.landLineNumber || 'Not specified'}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Photo</label>
            <div className="mt-2">
              {profile.photo ? (
                <img
                  src={profile.photo}
                  alt={`${profile.contactPerson}'s photo`}
                  className="h-32 w-32 rounded-lg border object-cover"
                />
              ) : (
                <p className="mt-1 text-sm text-foreground">Not specified</p>
              )}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-muted-foreground">Address</label>
            <p className="mt-1 text-sm text-foreground">{profile.address || 'Not specified'}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CustomerProfilesPage() {
  const [search, setSearch] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<CustomerProfile | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();

  const { data: customerProfiles = [], isLoading, refetch } = useQuery<CustomerProfile[]>({
    queryKey: ['/api/customer-profiles'],
  });

  const canCreate = hasPermission('customerProfiles', 'create');
  const canUpdate = hasPermission('customerProfiles', 'update');
  const canDelete = hasPermission('customerProfiles', 'delete');

  // Header controls: click a column header to sort it (asc -> desc -> none) and
  // use the small input under a header to filter that single column.
  const profilesTable = useTableControls(
    customerProfiles,
    {
      companyName: (profile) => profile.companyName,
      contactPerson: (profile) => profile.contactPerson,
      mobileNumber: (profile) => profile.mobileNumber,
      email: (profile) => profile.email,
      customerType: (profile) => profile.customerType,
      landLineNumber: (profile) => profile.landLineNumber,
    },
    {
      // The page level search box stays the primary, whole row search.
      filter: (profile) =>
        (profile.companyName?.toLowerCase() || "").includes(search.toLowerCase()) ||
        profile.contactPerson.toLowerCase().includes(search.toLowerCase()) ||
        profile.mobileNumber.toLowerCase().includes(search.toLowerCase()) ||
        profile.email.toLowerCase().includes(search.toLowerCase()) ||
        profile.customerType.toLowerCase().includes(search.toLowerCase()) ||
        (profile.landLineNumber?.toLowerCase() || "").includes(search.toLowerCase()) ||
        (profile.address?.toLowerCase() || "").includes(search.toLowerCase()),
    }
  );

  // Rows currently visible (search + column filters + sorting).
  const filteredProfiles = profilesTable.rows;

  const handleDelete = async (id: number) => {
    try {
      const response = await fetch(`/api/customer-profiles/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      toast({
        title: "Success",
        description: "Customer profile deleted successfully",
        variant: "success",
      });

      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete customer profile",
        variant: "destructive",
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setSelectedProfile(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Customer Profiles</h1>
        {canCreate && <CreateCustomerProfileDialog />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customer Profile List</CardTitle>
          <div className="flex items-center gap-4">
            <SearchInput
              containerClassName="flex-1 max-w-sm"
              placeholder="Search customers..."
              value={search}
              onValueChange={setSearch}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-4">Loading customer profiles...</div>
          ) : (
            <>
            <TableControlsBar controls={profilesTable} noun="customer profiles" />
            <Table className="table-actions-sticky min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <ColumnHeader controls={profilesTable} columnKey="companyName" label="Company Name" filterPlaceholder="Filter company" />
                  <ColumnHeader controls={profilesTable} columnKey="contactPerson" label="Customer/Contact" filterPlaceholder="Filter customer/contact" />
                  <ColumnHeader controls={profilesTable} columnKey="mobileNumber" label="Mobile Number" filterPlaceholder="Filter mobile" />
                  <ColumnHeader controls={profilesTable} columnKey="email" label="Email" filterPlaceholder="Filter email" />
                  <ColumnHeader controls={profilesTable} columnKey="customerType" label="Customer Type" filterPlaceholder="Filter customer type" />
                  <ColumnHeader controls={profilesTable} columnKey="landLineNumber" label="Land Line Number" filterPlaceholder="Filter land line" />
                  <TableHead className="align-top">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProfiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell>{profile.companyName || '-'}</TableCell>
                    <TableCell>{profile.contactPerson}</TableCell>
                    <TableCell>{profile.mobileNumber}</TableCell>
                    <TableCell>{profile.email}</TableCell>
                    <TableCell>{profile.customerType}</TableCell>
                    <TableCell>{profile.landLineNumber || '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            setSelectedProfile(profile);
                            setIsViewOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canUpdate && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              setSelectedProfile(profile);
                              setIsEditOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              setSelectedProfile(profile);
                              setIsDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>

      {selectedProfile && (
        <>
          <EditCustomerProfileDialog
            profile={selectedProfile}
            open={isEditOpen}
            onOpenChange={(open) => {
              setIsEditOpen(open);
              if (!open) setSelectedProfile(null);
            }}
          />
          <ViewCustomerProfileDialog
            profile={selectedProfile}
            open={isViewOpen}
            onOpenChange={(open) => {
              setIsViewOpen(open);
              if (!open) setSelectedProfile(null);
            }}
          />
        </>
      )}

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the customer profile
              for {selectedProfile?.companyName || selectedProfile?.contactPerson}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedProfile(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedProfile && handleDelete(selectedProfile.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default CustomerProfilesPage;
