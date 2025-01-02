import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
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
import { Pencil, Search, Trash2 } from "lucide-react";

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

function CustomerProfilesPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<CustomerProfile | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: customerProfiles = [], isLoading, refetch } = useQuery<CustomerProfile[]>({
    queryKey: ['/api/customer-profiles'],
  });

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

  // Filter customer profiles based on search term
  const filteredProfiles = customerProfiles.filter(profile => {
    const searchLower = searchTerm.toLowerCase();
    return (
      profile.name.toLowerCase().includes(searchLower) ||
      profile.phoneNumber.toLowerCase().includes(searchLower) ||
      profile.email.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Customer Profiles</h1>
        <CreateCustomerProfileDialog />
      </div>

      <Card>
        <div className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone number, or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

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
                {filteredProfiles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-4">
                      {searchTerm ? "No matching customer profiles found" : "No customer profiles available"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProfiles.map((profile) => (
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
                              setIsEditOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
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
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      {selectedProfile && (
        <EditCustomerProfileDialog
          profile={selectedProfile}
          open={isEditOpen}
          onOpenChange={(open) => {
            setIsEditOpen(open);
            if (!open) setSelectedProfile(null);
          }}
        />
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