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
import { Input } from "@/components/ui/input";
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
import { formatDate } from "@/lib/utils";
import { CreateCustomerProfileDialog } from "@/components/CustomerProfiles/CreateCustomerProfileDialog";
import { EditCustomerProfileDialog } from "@/components/CustomerProfiles/EditCustomerProfileDialog";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { Pencil, Trash2, Search, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CustomerProfile {
  id: number;
  phoneNumber: string;
  name: string;
  email: string;
  address: string;
  photo?: string;
  petBirthday?: string;
  petType: 'CAT' | 'DOG';
}

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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Customer Profile Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500">Phone Number</label>
              <p className="mt-1 text-sm text-gray-900">{profile.phoneNumber}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Name</label>
              <p className="mt-1 text-sm text-gray-900">{profile.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Email</label>
              <p className="mt-1 text-sm text-gray-900">{profile.email}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Pet Type</label>
              <p className="mt-1 text-sm text-gray-900 capitalize">{profile.petType.toLowerCase()}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Pet Birthday</label>
              <p className="mt-1 text-sm text-gray-900">
                {profile.petBirthday ? formatDate(profile.petBirthday) : 'Not specified'}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Address</label>
              <p className="mt-1 text-sm text-gray-900">{profile.address || 'Not specified'}</p>
            </div>
          </div>
          {profile.photo && (
            <div>
              <label className="text-sm font-medium text-gray-500">Photo</label>
              <div className="mt-2">
                <img
                  src={profile.photo}
                  alt={`${profile.name}'s photo`}
                  className="w-32 h-32 object-cover rounded-lg border"
                />
              </div>
            </div>
          )}
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

  const filteredProfiles = customerProfiles.filter(profile =>
    profile.phoneNumber.toLowerCase().includes(search.toLowerCase()) ||
    profile.name.toLowerCase().includes(search.toLowerCase()) ||
    profile.email.toLowerCase().includes(search.toLowerCase()) ||
    profile.petType.toLowerCase().includes(search.toLowerCase()) ||
    (profile.address?.toLowerCase() || "").includes(search.toLowerCase())
  );

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
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search customers..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-4">Loading customer profiles...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Pet Type</TableHead>
                  <TableHead>Pet Birthday</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProfiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell>{profile.phoneNumber}</TableCell>
                    <TableCell>{profile.name}</TableCell>
                    <TableCell>{profile.email}</TableCell>
                    <TableCell className="capitalize">{profile.petType.toLowerCase()}</TableCell>
                    <TableCell>{profile.petBirthday ? formatDate(profile.petBirthday) : '-'}</TableCell>
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
              for {selectedProfile?.name}.
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
