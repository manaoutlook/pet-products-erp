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
import { formatDate } from "@/lib/utils";
import { CreateCustomerProfileDialog } from "@/components/CustomerProfiles/CreateCustomerProfileDialog";

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

  const { data: customerProfiles = [], isLoading } = useQuery<CustomerProfile[]>({
    queryKey: ['/api/customer-profiles'],
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Customer Profiles</h1>
        <CreateCustomerProfileDialog />
      </div>

      <Card>
        <div className="p-6">
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {customerProfiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell>{profile.phoneNumber}</TableCell>
                    <TableCell>{profile.name}</TableCell>
                    <TableCell>{profile.email}</TableCell>
                    <TableCell className="capitalize">{profile.petType.toLowerCase()}</TableCell>
                    <TableCell>{profile.petBirthday ? formatDate(profile.petBirthday) : '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}

export default CustomerProfilesPage;
